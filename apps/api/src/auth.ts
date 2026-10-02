import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import cookie from '@fastify/cookie';
import { type AuditContext, audited, type DB, type Role, type SignInFailure } from '@lims/db';
import { hashPassword, verifyPassword } from '@lims/db/credentials';
import { type ActorContext, routes, SESSION_ENDED, type SessionClock } from '@lims/domain';
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import type { App } from './app.ts';
import { openJobIncident } from './incident.ts';
import { refuse, requestReference } from './refuse.ts';

export const LOCKOUT_AFTER_FAILURES = 20;
export const SESSION_COOKIE = 'lims_session';

/** How long a session lives: `idleMs` after its last request, and `absoluteMs` after sign-in at most. */
export interface SessionLimits {
  idleMs: number;
  absoluteMs: number;
}
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/**
 * The session limits of each login configuration. The demo's 8-hour idle limit stands under ADR 0002's demo-login
 * exception until the real-data gate (#102), which is to refuse `real` while the login is not `decided`.
 */
export const SESSION_LIMITS = {
  decided: { idleMs: 15 * MINUTE_MS, absoluteMs: 12 * HOUR_MS },
  demo: { idleMs: 8 * HOUR_MS, absoluteMs: 12 * HOUR_MS },
} as const satisfies Record<string, SessionLimits>;
export type Login = keyof typeof SESSION_LIMITS;

type AccessEvent = Insertable<DB['accessEvent']>;
export interface SessionKey {
  labId: string;
  id: string;
}
export interface SignedIn {
  actor: ActorContext;
  session: SessionKey;
  clock: SessionClock;
}

const SIGN_IN_SERVICE: AuditContext = { actor: 'svc:sign-in', role: 'system', reason: 'Sign in' };
const SWEEP_SERVICE: AuditContext = {
  actor: 'svc:session-sweep',
  role: 'system',
  reason: 'End sessions past their limit',
};

const TIMING_DECOY_HASH = await hashPassword(randomBytes(16).toString('base64url'));

const NEEDS_NO_ROLE = 'none';

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const notValid = () => refuse('badCredentials', 'the credentials are not valid');

const REFUSAL: { readonly [F in SignInFailure]: (labName?: string) => never } = {
  UnknownUserId: notValid,
  WrongPassword: notValid,
  WrongPasswordOnLockedAccount: notValid,
  OtherUserId: notValid,
  AccountLocked: () => refuse('accountLocked', 'this account is locked'),
  NoLab: () => refuse('role', 'this account belongs to no Lab'),
  NoLabChosen: () => refuse('labNotChosen', 'choose the Lab to work in'),
  NoMembership: (labName = 'that Lab') => refuse('role', `You hold no Membership in ${labName}. Choose another Lab.`),
  SessionEnded: () =>
    refuse('stale', 'this session has already moved to another Lab or ended; reload to see where you work'),
};

const record = (tx: Transaction<DB>, event: AccessEvent) => tx.insertInto('accessEvent').values(event).execute();

async function rolesIn(db: Kysely<DB>, personId: string, labId: string): Promise<Role[]> {
  const rows = await db
    .selectFrom('membership')
    .select('role')
    .where('labId', '=', labId)
    .where('personId', '=', personId)
    .orderBy('role')
    .execute();
  return rows.map((r) => r.role);
}

type LabChoice =
  | { labId: string; roles: Role[] }
  | {
      refused: Extract<SignInFailure, 'NoLab' | 'NoLabChosen' | 'NoMembership'>;
      roles: Role[];
      labName?: string | undefined;
    };

/**
 * The Lab a sign-in or a Lab switch opens: the one named, if the person holds a Membership there, and never a default.
 * A refused choice keeps the roles its Access Event records: those of the default Lab (the spec's earliest Membership;
 * a Membership has no date yet, so the lowest Lab ID stands in), or Customer for a person with no Membership.
 */
async function chooseLab(
  db: Kysely<DB>,
  person: { id: string; customerId: string | null },
  labId: string | undefined,
): Promise<LabChoice> {
  const held = await db
    .selectFrom('membership')
    .select(['labId', 'role'])
    .where('personId', '=', person.id)
    .orderBy('labId')
    .orderBy('role')
    .execute();
  const rolesOf = (lab: string) => held.filter((m) => m.labId === lab).map((m) => m.role);
  const chosen = labId === undefined ? [] : rolesOf(labId);
  if (labId !== undefined && chosen.length > 0) return { labId, roles: chosen };
  const [first] = held;
  if (!first) return { refused: 'NoLab', roles: person.customerId ? ['Customer'] : [] };
  if (labId === undefined) return { refused: 'NoLabChosen', roles: rolesOf(first.labId) };
  const named = await db.selectFrom('lab').select('name').where('labId', '=', labId).executeTakeFirst();
  return { refused: 'NoMembership', roles: rolesOf(first.labId), labName: named?.name };
}

async function countFailure(tx: Transaction<DB>, personId: string) {
  return tx
    .updateTable('person')
    .set({
      failedLogins: sql`failed_logins + 1`,
      lockedAt: sql`coalesce(locked_at, case when failed_logins + 1 >= ${LOCKOUT_AFTER_FAILURES} then clock_timestamp() end)`,
    })
    .where('id', '=', personId)
    .returning([
      sql<boolean>`old.locked_at is not null`.as('wasLocked'),
      sql<boolean>`old.locked_at is null and new.locked_at is not null`.as('lockedNow'),
    ])
    .executeTakeFirstOrThrow();
}

/** Counts a wrong credential toward the lockout and records it, with any Lockout it applies, in the caller's transaction. */
async function recordWrongCredential(
  tx: Transaction<DB>,
  kind: 'SignInFailed' | 'LabSwitchFailed',
  event: Omit<AccessEvent, 'kind' | 'failureReason'> & { subjectId: string },
  wrong: 'WrongPassword' | 'OtherUserId',
): Promise<SignInFailure> {
  const { wasLocked, lockedNow } = await countFailure(tx, event.subjectId);
  const reason = wrong === 'WrongPassword' && wasLocked ? 'WrongPasswordOnLockedAccount' : wrong;
  await record(tx, { ...event, kind, failureReason: reason });
  if (lockedNow) await record(tx, { ...event, kind: 'Lockout' });
  return reason;
}

/** Locks the person's row for the session about to open; answers true, and resets nothing, if a lock landed since the password was checked. */
async function resetFailuresUnlessLocked(tx: Transaction<DB>, personId: string): Promise<boolean> {
  const { lockedAt, failedLogins } = await tx
    .selectFrom('person')
    .select(['lockedAt', 'failedLogins'])
    .where('id', '=', personId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (lockedAt) return true;
  if (failedLogins > 0) await tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', personId).execute();
  return false;
}

async function openSession(tx: Transaction<DB>, personId: string, labId: string, token: string): Promise<SessionKey> {
  const { id } = await tx
    .insertInto('session')
    .values({ labId, personId, tokenHash: hashToken(token) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { labId, id };
}

/**
 * The request's source address as one Access Event key: a trusted proxy's forwarded value that is not an address
 * falls back to the peer, and an IPv4-mapped IPv6 address is the IPv4 address.
 */
export function sourceAddressOf(req: {
  ip: string;
  socket: { remoteAddress?: string | undefined };
  log: { warn: (message: string) => void };
}): string {
  if (!isIP(req.ip))
    req.log.warn('a trusted proxy forwarded a source address that is not an address; the peer is used');
  const address = (isIP(req.ip) ? req.ip : (req.socket.remoteAddress ?? '')).replace(/%.*$/, '');
  const mapped = /^::ffff:(.+)$/i.exec(address)?.[1];
  return mapped && isIP(mapped) === 4 ? mapped : address;
}

/** Proves the signer before a Signature is written: a wrong password refuses as badCredentials, counts toward lockout, and a lockout it applies is an Access Event. */
export async function reauthenticate(
  db: Kysely<DB>,
  { actor, session }: Pick<SignedIn, 'actor' | 'session'>,
  password: string,
  step: string,
  role: Role,
  sourceAddress: string,
): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', actor.person.id).executeTakeFirstOrThrow();
  const as = (reason: string) => ({ actor: `person:${person.username}`, role, reason });
  if (await verifyPassword(password, person.passwordHash)) {
    if (person.lockedAt) refuse('accountLocked', 'this account is locked');
    if (person.failedLogins > 0)
      await audited(db, as(`Re-authenticate to sign ${step}`), (tx) =>
        tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute(),
      );
    return;
  }
  await audited(db, as('Failed authentication'), async (tx) => {
    const { lockedNow } = await countFailure(tx, person.id);
    if (lockedNow)
      await record(tx, {
        kind: 'Lockout',
        subjectId: person.id,
        roles: actor.roles,
        sourceAddress,
        sessionLabId: session.labId,
        sessionId: session.id,
      });
  });
  notValid();
}

const interval = (ms: number) => sql<string>`${ms} * interval '1 millisecond'`;

/**
 * Builds the ActorContext from the session cookie, and counts the request as activity. A session past its end is
 * refused and left for the sweep, which records its expiry. Reads the session tables directly: no context exists yet
 * to scope by.
 */
export async function actorFor(db: Kysely<DB>, token: string | undefined, limits: SessionLimits): Promise<SignedIn> {
  const session =
    token &&
    (await db
      .selectFrom('session')
      .innerJoin('person', 'person.id', 'session.personId')
      .innerJoin('lab', 'lab.labId', 'session.labId')
      .select([
        'session.id',
        'session.endedAt',
        'person.lockedAt',
        'person.id as personId',
        'person.username',
        'person.displayName',
        'person.customerId',
        'lab.labId',
        'lab.code',
        'lab.name',
      ])
      .where('tokenHash', '=', hashToken(token))
      .executeTakeFirst());
  if (!session) return refuse('noSession', 'sign in first');
  if (session.endedAt) return refuse('noSession', SESSION_ENDED);
  const key = { labId: session.labId, id: session.id };
  const idle = interval(limits.idleMs);
  const absolute = interval(limits.absoluteMs);
  if (session.lockedAt) {
    await endSession(db, key, limits);
    return refuse('noSession', SESSION_ENDED);
  }
  const { rows } = await sql<{
    absoluteLeftMs: number | null;
  }>`select lims.touch_session(${key.labId}, ${key.id}, ${idle}, ${absolute}) as "absoluteLeftMs"`.execute(db);
  const absoluteLeftMs = rows[0]?.absoluteLeftMs ?? null;
  if (absoluteLeftMs === null) return refuse('noSession', SESSION_ENDED);
  return {
    actor: {
      person: {
        id: session.personId,
        username: session.username,
        displayName: session.displayName,
        customerId: session.customerId,
      },
      lab: { id: session.labId, code: session.code, name: session.name },
      roles: await rolesIn(db, session.personId, session.labId),
    },
    session: key,
    clock: { idleLimitMs: limits.idleMs, idleLeftMs: limits.idleMs, absoluteLeftMs },
  };
}

/** Ends every session past its idle or absolute limit, each with its expiry Access Event at the instant it ended. Running it again ends none twice. */
export async function endExpiredSessions(db: Kysely<DB>, limits: SessionLimits): Promise<void> {
  await audited(db, SWEEP_SERVICE, (tx) =>
    sql`select lims.end_expired_sessions(${interval(limits.idleMs)}, ${interval(limits.absoluteMs)})`.execute(tx),
  );
}

/** Ends a session that has not reached its end, and says whether it did; a session past its end is left to the sweep, which records its expiry. */
async function endSession(q: Kysely<DB>, key: SessionKey, limits: SessionLimits): Promise<boolean> {
  const { rows } = await sql<{
    ended: boolean;
  }>`select lims.end_session(${key.labId}, ${key.id}, ${interval(limits.idleMs)}, ${interval(limits.absoluteMs)}) as ended`.execute(
    q,
  );
  return rows[0]?.ended === true;
}

/**
 * Runs the expiry sweep every `everyMs` until the API closes. A failed sweep opens a System Incident and the next one
 * retries, writing the same record, since each expiry is stamped at its computed end. A tick skips while a sweep is
 * still running, and close waits for it.
 */
export function scheduleExpirySweep(app: App, db: Kysely<DB>, limits: SessionLimits, everyMs: number): void {
  let running: Promise<void> | null = null;
  const sweep = setInterval(() => {
    running ??= endExpiredSessions(db, limits)
      .catch((err: Error) => openJobIncident(db, app.log, { reference: requestReference(), step: 'expirySweep' }, err))
      .finally(() => {
        running = null;
      });
  }, everyMs);
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    await running;
  });
}

function typedUserIdDigest(key: Buffer, typed: string) {
  return { typedUserIdHmac: createHmac('sha256', key).update(typed).digest(), typedUserIdLength: typed.length };
}

/** The routes before a session: the Labs to choose from, sign-in, and how long a session has left without touching it. Every sign-in attempt, refused or not, writes its Access Event in a transaction of its own that commits. */
export function loginRoutes(
  app: App,
  db: Kysely<DB>,
  accessEventKey: Buffer,
  secureCookie: boolean,
  limits: SessionLimits,
): void {
  app.register(cookie, { parseOptions: { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie } });
  app.route({
    ...routes.labs,
    handler: () => db.selectFrom('lab').select(['labId as id', 'code', 'name']).orderBy('code').execute(),
  });
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const { username, password, labId } = req.body;
      const sourceAddress = sourceAddressOf(req);
      const person = await db.selectFrom('person').selectAll().where('username', '=', username).executeTakeFirst();
      if (!person) {
        await verifyPassword(password, TIMING_DECOY_HASH);
        await audited(db, SIGN_IN_SERVICE, (tx) =>
          record(tx, {
            kind: 'SignInFailed',
            failureReason: 'UnknownUserId',
            ...typedUserIdDigest(accessEventKey, username),
            roles: [],
            sourceAddress,
          }),
        );
        return notValid();
      }

      const proven = await verifyPassword(password, person.passwordHash);
      const choice = await chooseLab(db, person, labId);
      const subject = { subjectId: person.id, roles: choice.roles, sourceAddress };

      const refusal = person.lockedAt ? 'AccountLocked' : 'refused' in choice ? choice.refused : null;
      if (!proven || refusal || 'refused' in choice) {
        const failure = await audited(db, SIGN_IN_SERVICE, async (tx): Promise<SignInFailure> => {
          if (proven && refusal) {
            await record(tx, { kind: 'SignInFailed', failureReason: refusal, ...subject });
            return refusal;
          }
          return recordWrongCredential(tx, 'SignInFailed', subject, 'WrongPassword');
        });
        return REFUSAL[failure]('refused' in choice ? choice.labName : undefined);
      }

      const token = randomBytes(32).toString('base64url');
      const locked = await audited(db, SIGN_IN_SERVICE, async (tx) => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AccountLocked', ...subject });
          return true;
        }
        const session = await openSession(tx, person.id, choice.labId, token);
        await record(tx, { kind: 'SignInSucceeded', ...subject, sessionLabId: session.labId, sessionId: session.id });
        return false;
      });
      if (locked) return REFUSAL.AccountLocked();
      reply.setCookie(SESSION_COOKIE, token);
      const { actor, clock } = await actorFor(db, token, limits);
      return { ...actor, session: clock };
    },
  });
  app.route({
    ...routes.session,
    handler: async (req) => {
      const token = req.cookies[SESSION_COOKIE];
      if (!token) return refuse('noSession', 'sign in first');
      const idle = interval(limits.idleMs);
      const absolute = interval(limits.absoluteMs);
      const left = await db
        .selectFrom('session')
        .innerJoin('person', 'person.id', 'session.personId')
        .select([
          sql<number>`(extract(epoch from last_seen_at + ${idle} - now()) * 1000)::integer`.as('idleLeftMs'),
          sql<number>`(extract(epoch from created_at + ${absolute} - now()) * 1000)::integer`.as('absoluteLeftMs'),
        ])
        .where('tokenHash', '=', hashToken(token))
        .where('session.endedAt', 'is', null)
        .where('person.lockedAt', 'is', null)
        .where(sql<boolean>`lims.session_end(last_seen_at, created_at, ${idle}, ${absolute}) > now()`)
        .executeTakeFirst();
      return left ? { idleLimitMs: limits.idleMs, ...left } : refuse('noSession', SESSION_ENDED);
    },
  });
}

/** The routes that end or move the request's session, each written under the person whose session it is. */
export function sessionRoutes(app: App, db: Kysely<DB>, limits: SessionLimits): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      const { actor, sessionKey: session } = req;
      const as = { actor: `person:${actor.person.username}`, role: NEEDS_NO_ROLE, reason: 'Sign out' };
      await audited(db, as, async (tx) => {
        if (!(await endSession(tx, session, limits))) return;
        await record(tx, {
          kind: 'SignOut',
          subjectId: actor.person.id,
          roles: actor.roles,
          sourceAddress: sourceAddressOf(req),
          sessionLabId: session.labId,
          sessionId: session.id,
        });
      });
      reply.clearCookie(SESSION_COOKIE);
      return { ended: true } as const;
    },
  });

  app.route({
    ...routes.switchLab,
    handler: async (req, reply) => {
      const { actor, sessionKey: session } = req;
      const { username, password, labId } = req.body;
      if (labId === session.labId) refuse('state', `you already work in ${actor.lab.name}`);
      const person = await db
        .selectFrom('person')
        .selectAll()
        .where('id', '=', actor.person.id)
        .executeTakeFirstOrThrow();
      const as = { actor: `person:${person.username}`, role: NEEDS_NO_ROLE, reason: 'Switch Lab' };
      const sameUserId = username === person.username;
      const proven =
        (await verifyPassword(password, sameUserId ? person.passwordHash : TIMING_DECOY_HASH)) && sameUserId;
      const choice = await chooseLab(db, person, labId);
      const inSession = {
        subjectId: person.id,
        roles: actor.roles,
        sourceAddress: sourceAddressOf(req),
        sessionLabId: session.labId,
        sessionId: session.id,
      };

      if (!proven || 'refused' in choice) {
        const failure = await audited(db, as, async (tx): Promise<SignInFailure> => {
          if (proven && 'refused' in choice) {
            await record(tx, { kind: 'LabSwitchFailed', failureReason: choice.refused, ...inSession });
            return choice.refused;
          }
          return recordWrongCredential(tx, 'LabSwitchFailed', inSession, sameUserId ? 'WrongPassword' : 'OtherUserId');
        });
        return REFUSAL[failure]('refused' in choice ? choice.labName : undefined);
      }

      const token = randomBytes(32).toString('base64url');
      const outcome = await audited(db, as, async (tx): Promise<'AccountLocked' | 'SessionEnded' | 'Switched'> => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'LabSwitchFailed', failureReason: 'AccountLocked', ...inSession });
          return 'AccountLocked';
        }
        if (!(await endSession(tx, session, limits))) {
          await record(tx, { kind: 'LabSwitchFailed', failureReason: 'SessionEnded', ...inSession });
          return 'SessionEnded';
        }
        const opened = await openSession(tx, person.id, choice.labId, token);
        await record(tx, {
          kind: 'LabSwitch',
          subjectId: person.id,
          roles: choice.roles,
          sourceAddress: sourceAddressOf(req),
          sessionLabId: opened.labId,
          sessionId: opened.id,
          previousSessionLabId: session.labId,
          previousSessionId: session.id,
        });
        return 'Switched';
      });
      if (outcome !== 'Switched') return REFUSAL[outcome]();
      reply.setCookie(SESSION_COOKIE, token);
      const { actor: switched, clock } = await actorFor(db, token, limits);
      return { ...switched, session: clock };
    },
  });
}
