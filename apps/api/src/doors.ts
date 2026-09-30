// Two doors, and only two.
//
//   GET  /api/views/:name?...      a View: READ ONLY transaction, scoped, returns a DTO.
//   POST /api/commands/:name       a Command: through commit(), with a commit key, audited.
//
// Plus the fixed session endpoints sessions.md names:
//   GET  /api/session              the session's derived state; every page load asks it first.
//   POST /api/session/activity     "the person touched the screen"; moves only session_activity.
//   GET  /files/:token             one stored file, for a 60-second single-use token an audited
//                                  command minted; reads the store and writes nothing.
// Login, lock, unlock, switch user, takeover and logout are Commands (session.*): audited.
//
// No other route is registered. So "no GET creates or changes anything" is structural: a View
// cannot write (its transaction is READ ONLY) and a mutation cannot be a GET.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { z } from 'zod';
import type { DB, CompanyRead, CustomerRead, LabRead, ReasonForChange, Scope } from '@lims/db';
import { openRead, readBlob } from '@lims/db';
import type { LedgerId } from '@lims/domain/ids';
import { refuse, type Refusal } from '@lims/domain/refusal';
import { COMMAND_HEADER, CommandEnvelope, SESSION_COOKIE } from '@lims/contract';
import type { SessionAnswer } from '@lims/contract/session';
import { readSession, scopeOf, type ActorContext, type CustomerRole, type Requester, type StaffRole } from './actor.ts';
import { commit, type CommandTx, type Deps, type Outcome } from './commit.ts';
import type { DataClass } from './config.ts';
import type { KindRegistry } from './records/kinds.ts';

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

export type CookieAction = { readonly set: string } | { readonly clear: true };

export type Receipt<D = null> = {
  /** What the rail's middle shows after a commit, e.g. "Assigned RD-S-2026-000123/T1 to J. Okafor". */
  readonly summary: string;
  /** "Audited, not signed" or "Signed Performed": what kind of act this was. */
  readonly act: 'audited' | 'signed';
  /** Stored with the outcome, so a replay returns it too. */
  readonly data: D;
  /** Delivered with the first answer only, never stored: a session cookie, a one-time link. */
  readonly once?: { readonly data?: unknown; readonly cookie?: CookieAction };
};

export const isRefusal = (r: Receipt<unknown> | Refusal): r is Refusal => 'kind' in r;

/**
 * Whom a command acts for. A service identity satisfies any active or role requirement, since
 * the seed drives every command in-process; the database still checks the service holds its role.
 */
export type Acting<In> =
  | { readonly as: 'nobody' } // login, enrolment: runs as svc:auth
  | { readonly as: 'locked-session' } // unlock, takeover: the cookie's session is locked; runs as svc:auth
  | { readonly as: 'session' } // any active session; audited under the person's primary role
  | { readonly as: 'role'; readonly role: StaffRole | CustomerRole | 'Admin' }
  | { readonly as: 'role-from-input'; readonly role: (input: In) => string };

export type CommandDef<In extends z.ZodType = z.ZodType, D = unknown> = {
  readonly name: string;
  readonly input: In; // zod: the wire boundary; parsed input is trusted
  readonly acting: Acting<z.infer<In>>;
  /** How the Reason for Change is set: fixed by the command, or chosen by the person in the input. */
  readonly reason: ReasonForChange | ((input: z.infer<In>) => ReasonForChange);
  /** Every Lab ledger the command may write; the company ledger is always declared too. */
  readonly ledgers: (input: z.infer<In>, actor: Requester) => readonly LedgerId[];
  /**
   * The read scope of the command's handle, when it is not the actor's own: a Customer's submit
   * writes Samples into the Lab that will test them. The audit context stays the actor's, and the
   * database admits only the Customer's own rows (LA006).
   */
  readonly scope?: (input: z.infer<In>, actor: Requester) => Scope;
  readonly run: (tx: CommandTx, input: z.infer<In>) => Promise<Receipt<D> | Refusal>;
};

export const defineCommand = <In extends z.ZodType, D>(d: CommandDef<In, D>): CommandDef<In, D> => d;

/**
 * A command as the registry holds it. Its input is parsed by its own schema before it runs, so
 * the registry's view of the input type is the bottom type: every CommandDef fits, and only the
 * pipeline, which just parsed the input with `def.input`, passes it on.
 */
export type AnyCommandDef = {
  readonly name: string;
  readonly input: z.ZodType;
  readonly acting: Acting<never>;
  readonly reason: ReasonForChange | ((input: never) => ReasonForChange);
  readonly ledgers: (input: never, actor: Requester) => readonly LedgerId[];
  readonly scope?: (input: never, actor: Requester) => Scope;
  readonly run: (tx: CommandTx, input: never) => Promise<Receipt<unknown> | Refusal>;
};

type ReadFor = { lab: LabRead; customer: CustomerRead; company: CompanyRead };

export type ViewDef<S extends keyof ReadFor = keyof ReadFor, In extends z.ZodType = z.ZodType, Out = unknown> = {
  readonly name: string;
  readonly input: In;
  /** Which actors may read it: staff (lab), Customer Users (customer), Admin and services (company). */
  readonly scope: S;
  /** The kind register, for labels and field names; a view reads through `q` only. */
  readonly read: (q: ReadFor[S], input: z.infer<In>, actor: ActorContext, kinds: KindRegistry) => Promise<Out>;
};

export const defineView = <S extends keyof ReadFor, In extends z.ZodType, Out>(d: ViewDef<S, In, Out>): ViewDef<S, In, Out> => d;

/** A view as the registry holds it (see AnyCommandDef). */
export type AnyViewDef = {
  readonly name: string;
  readonly input: z.ZodType;
  readonly scope: keyof ReadFor;
  readonly read: (q: never, input: never, actor: ActorContext, kinds: KindRegistry) => Promise<unknown>;
};

// ---------------------------------------------------------------------------------------------
// HTTP mapping
// ---------------------------------------------------------------------------------------------

const STATUS: { readonly [K in Refusal['kind']]: number } = {
  'session': 401,
  'not-permitted': 403,
  'gate': 409,
  'transition': 409,
  'stale-version': 409,
  'credentials': 401,
  'locked-out': 423,
  'totp-already-used': 409,
  'wrong-user': 403,
  'not-built': 409,
  'commit-key-reused': 409,
  'choose-place': 409,
};

export function statusOf(r: Refusal): number {
  if (r.kind === 'session') return r.state === 'locked' ? 423 : 401;
  return STATUS[r.kind];
}

const isLocalhost = (host: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

function applyCookie(req: FastifyRequest, reply: FastifyReply, action: CookieAction | undefined): void {
  if (!action) return;
  const opts = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: !isLocalhost(req.host) };
  if ('clear' in action) reply.clearCookie(SESSION_COOKIE, opts);
  else reply.setCookie(SESSION_COOKIE, action.set, opts);
}

export function sessionDto(s: Awaited<ReturnType<typeof readSession>>, dataClass: DataClass): SessionAnswer {
  switch (s.state) {
    case 'none':
    case 'ended':
      return { state: 'none', dataClass };
    case 'locked':
      return {
        state: 'locked',
        dataClass,
        owner: { printedName: s.locked.printedName, username: s.locked.username, nativeName: s.locked.nativeName, roles: s.locked.roles },
        lockReason: s.locked.lockReason,
        lockedAt: s.locked.lockedAt.toISOString(),
        zone: s.locked.zone,
        workstation: s.locked.workstation,
      };
    case 'active': {
      const a = s.actor;
      return {
        state: 'active',
        dataClass,
        person: { printedName: a.printedName, nativeName: s.nativeName, username: a.username },
        lab: a.kind === 'staff' ? { id: a.lab, code: a.labCode, zone: a.zone } : null,
        customer: a.kind === 'customer' ? { id: a.customer } : null,
        roles: a.kind === 'admin' ? ['Admin'] : [...a.roles],
        workstation: s.workstation,
        startedAt: s.startedAt.toISOString(),
        idleLockAt: s.idleLockAt.toISOString(),
        absoluteEndAt: s.absoluteEndAt.toISOString(),
        epoch: s.epoch,
      };
    }
  }
}

async function requester(db: Kysely<DB>, req: FastifyRequest): Promise<Requester | Extract<Refusal, { kind: 'session' }>> {
  const s = await readSession(db, req.cookies[SESSION_COOKIE]);
  switch (s.state) {
    case 'none': return { kind: 'nobody' };
    case 'ended': return refuse.session('ended') as Extract<Refusal, { kind: 'session' }>;
    case 'locked': return { kind: 'locked', locked: s.locked };
    case 'active': return s.actor;
  }
}

const outcomeBody = (o: Outcome): unknown =>
  o.kind === 'receipt'
    ? { kind: 'receipt', ...o.receipt, ...(o.once?.data !== undefined ? { once: o.once.data } : {}), ...(o.replayed ? { replayed: true } : {}) }
    : { kind: 'refusal', refusal: o.refusal, ...(o.replayed ? { replayed: true } : {}) };

export type Doors = { readonly commands: readonly AnyCommandDef[]; readonly views: readonly AnyViewDef[] };

export function registerDoors(app: FastifyInstance, deps: Deps, doors: Doors): void {
  const commands = new Map(doors.commands.map((c) => [c.name, c]));
  const views = new Map(doors.views.map((v) => [v.name, v]));

  app.get('/api/session', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return sessionDto(await readSession(deps.db, req.cookies[SESSION_COOKIE]), deps.dataClass);
  });

  app.post('/api/session/activity', async (req, reply) => {
    if (req.headers[COMMAND_HEADER] !== '1') return reply.code(403).send({ kind: 'refusal', refusal: refuse.notPermitted('Analyst') });
    const s = await readSession(deps.db, req.cookies[SESSION_COOKIE]);
    if (s.state !== 'active') return reply.code(s.state === 'locked' ? 423 : 401).send(sessionDto(s, deps.dataClass));
    await deps.db.insertInto('session_activity').values({ session_id: s.actor.session, last_activity_at: sql`clock_timestamp()` })
      .onConflict((oc) => oc.column('session_id').doUpdateSet({ last_activity_at: sql`clock_timestamp()` })).execute();
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>('/files/:token', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const grant = deps.fileTokens.consume(req.params.token);
    if (!grant) return reply.code(404).send({ kind: 'refusal', refusal: { kind: 'not-permitted', message: 'This download link has expired or was already used. Open the report again.' } });
    const bytes = await readBlob(deps.reportStore, grant.ledger, grant.sha256);
    if (!bytes) return reply.code(404).send({ kind: 'refusal', refusal: { kind: 'not-permitted', message: 'The file is not in the report store.' } });
    reply.header('content-type', grant.mediaType);
    reply.header('content-disposition', `attachment; filename="${grant.filename.replaceAll('"', '')}"`);
    reply.header('x-lims-sha256', grant.sha256);
    return reply.send(bytes);
  });

  app.get<{ Params: { name: string } }>('/api/views/:name', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const view = views.get(req.params.name);
    if (!view) return reply.code(404).send({ kind: 'refusal', refusal: { kind: 'unknown-view', message: `No view named ${req.params.name}.` } });
    const who = await requester(deps.db, req);
    if (who.kind === 'nobody') return reply.code(401).send({ kind: 'refusal', refusal: refuse.session('none') });
    if (who.kind === 'locked') return reply.code(423).send({ kind: 'refusal', refusal: refuse.session('locked') });
    if (who.kind === 'session') return reply.code(statusOf(who)).send({ kind: 'refusal', refusal: who });
    const parsed = view.input.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ kind: 'refusal', refusal: { kind: 'bad-input', message: 'The request is malformed.', issues: parsed.error.issues } });
    const scope = scopeOf(who);
    if (scope.kind !== view.scope) return reply.code(403).send({ kind: 'refusal', refusal: { kind: 'not-permitted', message: 'This view is not for this kind of user.' } });
    return openRead(deps.db, scope, (q) => view.read(q as never, parsed.data as never, who, deps.kinds));
  });

  app.post<{ Params: { name: string } }>('/api/commands/:name', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (req.headers[COMMAND_HEADER] !== '1') return reply.code(403).send({ kind: 'refusal', refusal: { kind: 'not-permitted', message: 'Commands need the X-LIMS-Command header.' } });
    const def = commands.get(req.params.name);
    if (!def) return reply.code(404).send({ kind: 'refusal', refusal: { kind: 'unknown-command', message: `No command named ${req.params.name}.` } });
    const envelope = CommandEnvelope.safeParse(req.body);
    if (!envelope.success) return reply.code(400).send({ kind: 'refusal', refusal: { kind: 'bad-input', message: 'The request is malformed.', issues: envelope.error.issues } });
    const input = def.input.safeParse(envelope.data.input);
    if (!input.success) return reply.code(400).send({ kind: 'refusal', refusal: { kind: 'bad-input', message: 'The request is malformed.', issues: input.error.issues } });
    const who = await requester(deps.db, req);
    if (who.kind === 'session') return reply.code(statusOf(who)).send({ kind: 'refusal', refusal: who });
    const out = await commit(deps, who, envelope.data.commitKey, def, input.data);
    if (out.kind === 'receipt') applyCookie(req, reply, out.once?.cookie);
    const status = out.kind === 'receipt' ? 200 : statusOf(out.refusal);
    return reply.code(status).send(outcomeBody(out));
  });
}
