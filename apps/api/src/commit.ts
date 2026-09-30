// commit(): every commit happens once (decision 23 rule 25), in one audited transaction.
//
// The prompt mints a key per attempt. The server, under the key's advisory lock:
//   1. reads commit_outcome for the key:
//        a receipt with the same input        -> the stored receipt, marked replayed, whatever
//                                                password or code was typed again;
//        a receipt with another input         -> commit-key-reused (nothing runs);
//        a refusal with the same input hash   -> the stored refusal, marked replayed (a network
//                                                retry of a failed signing is not counted twice);
//        a refusal with other input or secrets -> the corrected attempt runs;
//   2. runs the command's body in a savepoint (AuditedTx.attempt);
//   3. a Receipt keeps the savepoint and stores the outcome; a Refusal rolls the savepoint back,
//      then the rows that must survive it (auth failures, the used TOTP step, spec gaps) are
//      written as svc:auth and the refusal is stored; one COMMIT ends either;
//   4. a bug (an error no refusal maps) also rolls the savepoint back and keeps the survivors, so
//      a code spent before it stays spent; it stores no outcome and is rethrown after COMMIT.
// Nothing leaves this function between the effect and its outcome row, so a crash anywhere
// leaves no outcome and the retry runs once.

import { createHmac } from 'node:crypto';
import type { Insertable, Kysely } from 'kysely';
import { COMPANY_LEDGER, SERVICE, ledgerOf, runAudited, type AuditContext, type AuditedTx, type DB, type Scope } from '@lims/db';
import type { Alert, AuthEvent, TotpStepUsed } from '@lims/db';
import type { CommitKey, LabId, PersonId, SessionId } from '@lims/domain/ids';
import { refuse, specGapsOf, type Refusal } from '@lims/domain/refusal';
import { actingLab, holdsRole, primaryRole, scopeOf, SERVICE_COMMANDS, type Requester } from './actor.ts';
import type { AnyCommandDef, CookieAction, Receipt } from './doors.ts';
import type { KindRegistry } from './records/kinds.ts';
import type { FileTokens } from './files.ts';
import type { DataClass } from './config.ts';
import { records, type Records } from './records/index.ts';

export type Deps = {
  readonly db: Kysely<DB>;
  readonly release: string;
  readonly pepper: Buffer;
  readonly totpKey: Buffer;
  readonly commitInputKey: Buffer;
  readonly kinds: KindRegistry;
  readonly reportStore: string;
  readonly fileTokens: FileTokens;
  readonly dataClass: DataClass;
};

/** A row that must outlive a refusal: written now, and again after the savepoint rolls back. */
export type Survivor =
  | { readonly table: 'auth_event'; readonly row: Insertable<AuthEvent> }
  | { readonly table: 'totp_step_used'; readonly row: Insertable<TotpStepUsed> }
  | { readonly table: 'alert'; readonly row: Insertable<Alert> };

/** What a command body receives: the write handle, who is asking, the records machinery, and the survivors channel. */
export type CommandTx = AuditedTx & {
  readonly actor: Requester;
  readonly deps: Deps;
  readonly records: Records;
  /** Writes the row as svc:auth, and again after a refusal's rollback. */
  readonly survive: (s: Survivor) => Promise<void>;
  /** True when the survivor was inserted (a TOTP step never used before), false on a conflict. */
  readonly surviveOnce: (s: Extract<Survivor, { table: 'totp_step_used' }>) => Promise<boolean>;
};

/** JSON a detail column takes. */
export type Detail = { readonly [k: string]: string | number | boolean | null };

export type StoredReceipt = { readonly summary: string; readonly at: string; readonly act: 'audited' | 'signed'; readonly data: unknown };

export type Outcome =
  | { readonly kind: 'receipt'; readonly receipt: StoredReceipt; readonly once?: Receipt['once']; readonly replayed?: true }
  | { readonly kind: 'refusal'; readonly refusal: Refusal; readonly replayed?: true };

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x);

/** The input fields, at any depth, that authenticate the person rather than say what they ask for. */
const SECRET_FIELDS: ReadonlySet<string> = new Set(['password', 'totp']);

function splitSecrets(v: unknown): { readonly open: unknown; readonly secret: Record<string, unknown> | null } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { open: v ?? null, secret: null };
  const open: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_FIELDS.has(k)) {
      secret[k] = x;
      continue;
    }
    const inner = splitSecrets(x);
    open[k] = inner.open;
    if (inner.secret) secret[k] = inner.secret;
  }
  return { open, secret: Object.keys(secret).length ? secret : null };
}

const mac = (key: Buffer, part: 'input' | 'secrets', v: unknown): Buffer => createHmac('sha256', key).update(`${part}\0${stableJson(v)}`).digest();
const INPUT_MAC_BYTES = 32;

/**
 * commit_outcome.input_hash: an HMAC of the input with its secrets removed, followed, when it has
 * any, by an HMAC of the secrets. Both are keyed by the server, so the table is no offline verifier
 * for a password or code; the first part alone says whether a retry asks for the same thing.
 */
export function inputHash(key: Buffer, input: unknown): Buffer {
  const { open, secret } = splitSecrets(input);
  return secret ? Buffer.concat([mac(key, 'input', open), mac(key, 'secrets', secret)]) : mac(key, 'input', open);
}

const sameRequest = (a: Buffer, b: Buffer): boolean => a.subarray(0, INPUT_MAC_BYTES).equals(b.subarray(0, INPUT_MAC_BYTES));

type Acted = { readonly person: PersonId; readonly role: string; readonly lab: LabId | null; readonly customer: string | null; readonly session: SessionId | null; readonly scope: Scope };

/** Who the audit context names for this command, or why the requester may not run it. */
function resolveActing(def: AnyCommandDef, who: Requester, input: never): Acted | Refusal {
  const asAuth = (scope: Scope): Acted => ({ person: SERVICE.auth.person, role: SERVICE.auth.role, lab: null, customer: null, session: null, scope });
  const a = def.acting;
  if (a.as === 'nobody') return asAuth({ kind: 'company' });
  if (a.as === 'locked-session') {
    if (who.kind === 'locked') return asAuth({ kind: 'company' });
    return who.kind === 'nobody' ? refuse.session('none') : { kind: 'not-permitted', message: 'This acts on a locked session.' };
  }
  if (who.kind === 'nobody') return refuse.session('none');
  if (who.kind === 'locked') return refuse.session('locked');
  if (who.kind === 'service') {
    if (!SERVICE_COMMANDS[who.identity].has(def.name)) return { kind: 'not-permitted', message: `${who.identity} does not run ${def.name}.` };
    return { person: who.person, role: who.identity, lab: actingLab(who), customer: null, session: null, scope: scopeOf(who) };
  }
  const role = a.as === 'session' ? primaryRole(who) : a.as === 'role' ? a.role : a.role(input);
  if (!holdsRole(who, role)) return { kind: 'not-permitted', message: `This needs the ${role} role${who.kind === 'staff' ? ' in this Lab' : ''}.` };
  return {
    person: who.person,
    role,
    lab: actingLab(who),
    customer: who.kind === 'customer' ? who.customer : null,
    session: who.session,
    scope: scopeOf(who),
  };
}

/** Database refusals the pipeline turns into values; anything else is a bug and stays thrown. */
const DB_REFUSALS: Readonly<Record<string, (message: string) => Refusal>> = {
  LI001: () => ({ kind: 'not-permitted', message: 'An Admin never also holds a business role, so this grant is refused.' }),
  LR001: () => ({ kind: 'transition', message: 'This record is locked by a Released Test Report.' }),
  LS001: () => ({ kind: 'not-permitted', message: 'Nobody approves a change they proposed.' }),
  LS002: () => ({ kind: 'not-permitted', message: 'The Verified signer entered a version of this value, so someone else must verify it.' }),
};

/** An error no refusal maps: its survivors are committed, then it is rethrown. */
type Bug = { readonly kind: 'bug'; readonly error: unknown };

const sqlState = (e: unknown): string | null => (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null);

/** `input` was parsed by `def.input` at the door or by the in-process caller. */
export async function commit(deps: Deps, who: Requester, key: CommitKey | string, def: AnyCommandDef, parsedInput: unknown): Promise<Outcome> {
  const input = parsedInput as never;
  const acted = resolveActing(def, who, input);
  if ('kind' in acted) return { kind: 'refusal', refusal: acted };
  const hash = inputHash(deps.commitInputKey, input);
  const labLedgers = def.ledgers(input, who);
  const ctx: AuditContext = {
    person: acted.person,
    role: acted.role,
    actingLab: acted.lab,
    customer: acted.customer as AuditContext['customer'],
    action: def.name,
    reason: typeof def.reason === 'function' ? def.reason(input) : def.reason,
    appRelease: deps.release,
    session: acted.session,
    commitKey: key as CommitKey,
    ledgers: [...new Set([...labLedgers, ...(acted.lab ? [ledgerOf(acted.lab)] : []), COMPANY_LEDGER])],
  };
  const svcAuth: AuditContext = { ...ctx, person: SERVICE.auth.person, role: SERVICE.auth.role, actingLab: null, customer: null, session: null, ledgers: [COMPANY_LEDGER] };

  const scope = def.scope ? def.scope(input, who) : acted.scope;
  const out = await runAudited(deps.db, ctx, scope, async (tx): Promise<{ commit: Outcome | Bug } | { rollback: Outcome }> => {
    const prior = await tx.db.selectFrom('commit_outcome').select(['input_hash', 'outcome', 'body']).where('commit_key', '=', key).execute();
    const receipt = prior.find((p) => p.outcome === 'receipt');
    if (receipt) {
      return sameRequest(receipt.input_hash, hash)
        ? { rollback: { kind: 'receipt', receipt: receipt.body as StoredReceipt, replayed: true } }
        : { rollback: { kind: 'refusal', refusal: refuse.commitKeyReused() } };
    }
    const sameRefusal = prior.find((p) => p.input_hash.equals(hash));
    if (sameRefusal) return { rollback: { kind: 'refusal', refusal: sameRefusal.body as Refusal, replayed: true } };

    const survivors: Survivor[] = [];
    const write = (s: Survivor) => tx.withContext(svcAuth, async () => {
      switch (s.table) {
        case 'auth_event': await tx.db.insertInto('auth_event').values(s.row).execute(); break;
        case 'totp_step_used': await tx.db.insertInto('totp_step_used').values(s.row).execute(); break;
        case 'alert': await tx.db.insertInto('alert').values(s.row).execute(); break;
      }
    });
    const ctxTx: CommandTx = {
      ...tx,
      actor: who,
      deps,
      records: records(tx, deps, acted),
      survive: async (s) => { survivors.push(s); await write(s); },
      surviveOnce: async (s) => {
        let inserted = false;
        await tx.withContext(svcAuth, async () => {
          const r = await tx.db.insertInto('totp_step_used').values(s.row).onConflict((oc) => oc.columns(['person_id', 'step']).doNothing()).returning('step').executeTakeFirst();
          inserted = r !== undefined;
        });
        if (inserted) survivors.push(s);
        return inserted;
      },
    };

    let result: { commit: Receipt<unknown> } | { rollback: Refusal };
    try {
      result = await tx.attempt<Receipt<unknown>, Refusal>(async () => {
        const r = await def.run(ctxTx, input);
        return 'kind' in r ? { rollback: r } : { commit: r };
      });
    } catch (e) {
      const code = sqlState(e);
      const toRefusal = code ? DB_REFUSALS[code] : undefined;
      if (!toRefusal) {
        for (const s of survivors) await write(s);
        return { commit: { kind: 'bug', error: e } };
      }
      result = { rollback: toRefusal((e as Error).message) };
    }

    const at = tx.dbNow.toISOString();
    if ('commit' in result) {
      const { once, ...stored } = result.commit;
      const body: StoredReceipt = { summary: stored.summary, at, act: stored.act, data: stored.data };
      await tx.db.insertInto('commit_outcome').values({ commit_key: key, session_id: acted.session, command: def.name, input_hash: hash, outcome: 'receipt', body: body as never }).execute();
      return { commit: { kind: 'receipt', receipt: body, ...(once ? { once } : {}) } };
    }
    const refusal = result.rollback;
    for (const s of survivors) await write(s);
    const gaps = specGapsOf(refusal);
    if (gaps.length) {
      await tx.withContext(svcAuth, async () => {
        for (const feature of gaps) {
          await tx.db.insertInto('spec_gap').values({ feature, command: def.name, person_id: acted.person, detail: { message: refusal.message } }).execute();
        }
      });
    }
    await tx.db.insertInto('commit_outcome').values({ commit_key: key, session_id: acted.session, command: def.name, input_hash: hash, outcome: 'refusal', body: refusal as never }).execute();
    return { commit: { kind: 'refusal', refusal } };
  });
  const settled = 'commit' in out ? out.commit : out.rollback;
  if (settled.kind === 'bug') throw settled.error;
  return settled;
}

/** Builds the Receipt a command returns. */
export const receipt = <D = null>(summary: string, act: Receipt['act'] = 'audited', data: D = null as D, once?: Receipt['once']): Receipt<D> =>
  ({ summary, act, data, ...(once ? { once } : {}) });

export type { CookieAction };
