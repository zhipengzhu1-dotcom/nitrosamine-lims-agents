// The audited transaction: the one way anything is written.
//
//   BEGIN ISOLATION LEVEL READ COMMITTED
//   SELECT pg_advisory_xact_lock(hashtextextended(commit_key, 0))   duplicates of this attempt wait here
//   SELECT set_config('lims.ctx', <AuditContext json>, true)         person, role, Lab, Customer, reason, release
//   SELECT lims.lock_chains()  -> dbNow                              declared chain heads locked in id order
//   ... the command's writes (capture triggers append to the chains) ...
//   COMMIT, or ROLLBACK when fn returns { rollback }
//
// dbNow is the database clock read under the chain locks. Gates that ask "is it valid now?" use
// it, never Date.now().

import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from './generated.ts';
import { GENERATED_CLASSES, scopePlugin, type Scope, type TableClasses } from './scope.ts';
import type { CommitKey, CustomerId, LabId, LedgerId, PersonId, SessionId } from '@lims/domain/ids';

export type ReasonCode = 'transcription-error' | 'wrong-unit' | 'wrong-item-selected' | 'instrument-reprint' | 'other';

export type ReasonForChange =
  | { readonly kind: 'first_save' }
  | { readonly kind: 'action' }
  | { readonly kind: 'picklist'; readonly code: Exclude<ReasonCode, 'other'> }
  | { readonly kind: 'picklist'; readonly code: 'other'; readonly text: string };

export type AuditContext = {
  readonly person: PersonId;
  /** The role acted in; the database checks the person holds it in the acting Lab. */
  readonly role: string;
  readonly actingLab: LabId | null;
  readonly customer: CustomerId | null;
  /** The command name; also the audit entry's action. */
  readonly action: string;
  readonly reason: ReasonForChange;
  readonly appRelease: string;
  /** Null only for service identities. */
  readonly session: SessionId | null;
  readonly commitKey: CommitKey;
  /** Every ledger the transaction may write; a write to any other raises LA005. */
  readonly ledgers: readonly LedgerId[];
};

/** The row shape of the lims.ctx GUC, as lims.require_context() reads it. */
export function contextRow(ctx: AuditContext): Record<string, unknown> {
  const reason = ctx.reason;
  return {
    person_id: ctx.person,
    role: ctx.role,
    acting_lab_id: ctx.actingLab,
    customer_id: ctx.customer,
    action: ctx.action,
    reason_code: reason.kind === 'picklist' ? reason.code : reason.kind,
    reason_text: reason.kind === 'picklist' && reason.code === 'other' ? reason.text : null,
    app_release: ctx.appRelease,
    session_id: ctx.session,
    commit_key: ctx.commitKey,
    ledgers: ctx.ledgers,
  };
}

/** A write handle: scoped like a read handle, plus the database time read under the chain locks. */
export type AuditedTx = {
  readonly db: Kysely<DB>;
  /**
   * For comparisons only. A JS Date keeps milliseconds and Postgres keeps microseconds, so a
   * row timestamp written from this value can predate the transaction's own start. Stamp rows
   * with sql`clock_timestamp()` instead.
   */
  readonly dbNow: Date;
  readonly scope: Scope;
  readonly ctx: AuditContext;
  /**
   * Runs `fn` in a savepoint. A { rollback } result or a thrown error undoes fn's writes and
   * leaves the transaction usable; the error is rethrown. The commit pipeline runs a command's
   * body here, so a refusal's effect is undone while the rows that must survive it, and the
   * outcome, are written afterwards in the same transaction, still under the commit key's lock.
   */
  readonly attempt: <C, R>(fn: () => Promise<Attempt<C, R>>) => Promise<Attempt<C, R>>;
  /** Runs `fn` with the audit context switched to `ctx` (validated by the database like any other), then switches back. */
  readonly withContext: (ctx: AuditContext, fn: () => Promise<void>) => Promise<void>;
};

export type Attempt<C, R> = { readonly commit: C } | { readonly rollback: R };
export type TxOutcome<T> = Attempt<T, T>;

const unscopedOf = new WeakMap<AuditedTx, Transaction<DB>>();

/** The unscoped transaction behind a write handle. Only the door wrappers in doors.ts use it. */
export function unscoped(tx: AuditedTx): Transaction<DB> {
  const t = unscopedOf.get(tx);
  if (!t) throw new Error('not an audited transaction handle');
  return t;
}

/**
 * Runs `fn` in one audited transaction. `fn` returns { commit } to commit or { rollback } to roll
 * back (a refusal). A thrown error rolls back and rethrows. The commit key's advisory lock is
 * held for the whole transaction, so a concurrent duplicate waits and then sees the settled
 * outcome.
 */
export async function runAudited<T>(
  db: Kysely<DB>,
  ctx: AuditContext,
  scope: Scope,
  fn: (tx: AuditedTx) => Promise<TxOutcome<T>>,
  classes: TableClasses = GENERATED_CLASSES,
): Promise<TxOutcome<T>> {
  const trx = await db.startTransaction().setIsolationLevel('read committed').execute();
  let settled = false;
  try {
    await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.commitKey}, 0))`.execute(trx);
    await sql`select set_config('lims.ctx', ${JSON.stringify(contextRow(ctx))}, true)`.execute(trx);
    const { rows } = await sql<{ now: Date }>`select lims.lock_chains() as now`.execute(trx);
    const setContext = (c: AuditContext) => sql`select set_config('lims.ctx', ${JSON.stringify(contextRow(c))}, true)`.execute(trx);
    const tx: AuditedTx = {
      db: trx.withPlugin(scopePlugin(scope, classes)),
      dbNow: rows[0]!.now,
      scope,
      ctx,
      attempt: async (fn) => {
        await sql`savepoint attempt`.execute(trx);
        try {
          const out = await fn();
          await ('commit' in out ? sql`release savepoint attempt` : sql`rollback to savepoint attempt`).execute(trx);
          return out;
        } catch (e) {
          await sql`rollback to savepoint attempt`.execute(trx);
          throw e;
        }
      },
      // An error is not caught here: a database error has aborted the transaction, and the
      // savepoint or rollback that follows also restores the context (GUC changes are transactional).
      withContext: async (other, fn) => {
        await setContext(other);
        await fn();
        await setContext(ctx);
      },
    };
    unscopedOf.set(tx, trx);
    const out = await fn(tx);
    settled = true;
    if ('commit' in out) await trx.commit().execute();
    else await trx.rollback().execute();
    return out;
  } catch (e) {
    if (!settled) await trx.rollback().execute();
    throw e;
  }
}
