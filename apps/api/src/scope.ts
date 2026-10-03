import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type BreakKind,
  type ChainKind,
  type Instant,
  type NumberedKind,
  type NumberTaken,
  type Resumed,
  type Role,
  recordNumber,
} from '@lims/domain';
import {
  type Insertable,
  type Kysely,
  type SelectQueryBuilder,
  type RawBuilder,
  sql,
  type Transaction,
  type UpdateQueryBuilder,
  type UpdateResult,
} from 'kysely';
import { auditedAfterReauthentication, type Reauthenticated } from './auth.ts';

type CompanyTable =
  | 'customer'
  | 'person'
  | 'method'
  | 'submission'
  | 'lab'
  | 'identityVerification'
  | 'credentialLink'
  | 'enrolmentGrant'
  | 'signatureStatement'
  | 'systemIncident'
  | 'chainVerification';
type LabTable = Exclude<keyof DB, CompanyTable | 'accessEvent' | 'auditEntry' | 'session'>;

function inLab(q: Kysely<DB>, labId: string) {
  const ofLab = (table: LabTable) => sql<boolean>`${sql.ref(`${table}.labId`)} = ${labId}`;
  // Typed without the Lab tables, so a Lab row can only be reached through the filtered builders below.
  const company: Kysely<Pick<DB, CompanyTable>> = q;
  return {
    /**
     * Reads the Access Events this Lab sees: those of its sessions, a Lab Switch out of one of them, those of no
     * session, and every Lockout, which ends the person's sessions in every Lab.
     */
    accessEvents: () =>
      q
        .selectFrom('accessEvent')
        .where((eb) =>
          eb.or([
            eb('sessionLabId', '=', labId),
            eb('previousSessionLabId', '=', labId),
            eb('sessionLabId', 'is', null),
            eb('kind', '=', 'Lockout'),
          ]),
        ),
    /** Reads this Lab's sessions as `session`, without the token hash, so no reader can learn what proves one. */
    sessions: () =>
      q.selectFrom(
        q
          .selectFrom('session')
          .select(['id', 'personId', 'workstationId', 'createdAt', 'lastSeenAt', 'endedAt'])
          .where('labId', '=', labId)
          .as('session'),
      ),
    from: <T extends LabTable>(table: T) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Kysely cannot type a select from a generic Lab table; ofLab filters it
      (q.selectFrom(table) as unknown as SelectQueryBuilder<DB, T, {}>).where(ofLab(table)),
    insert: <T extends LabTable>(table: T, values: Omit<Insertable<DB[T]>, 'labId'>) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Kysely cannot see that values plus labId make a row of a generic Lab table
      q.insertInto(table).values({ ...values, labId } as unknown as Insertable<DB[T]>),
    update: <T extends LabTable>(table: T) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Kysely cannot type an update of a generic Lab table; ofLab filters it
      (q.updateTable(table) as unknown as UpdateQueryBuilder<DB, T, T, UpdateResult>).where(ofLab(table)),
    company,
  };
}

export type LabQueries = ReturnType<typeof inLab>;

/** The Lab's queries inside one audited transaction, which alone can take a number, so a rollback gives it back. */
function inWrite(tx: Transaction<DB>, labId: string) {
  return {
    ...inLab(tx, labId),
    /** Writes one Access Event in this write's transaction, so it commits with the record it witnesses. */
    accessEvent: (event: Insertable<DB['accessEvent']>) => tx.insertInto('accessEvent').values(event).execute(),
    takeNumber: async (kind: NumberedKind) => {
      const { rows } = await sql<Omit<NumberTaken, 'kind'>>`select * from lims.take_number(${kind}, ${labId})`.execute(
        tx,
      );
      const [taken] = rows;
      if (!taken) throw new Error(`lims.take_number returned no ${kind} number`);
      return recordNumber({ kind, ...taken });
    },
  };
}

export type WriteQueries = ReturnType<typeof inWrite>;

/**
 * How many breaks of a chain a verification records one by one. The breaks after them are recorded together, as one
 * `More` break with their count and a digest of their fingerprints, so a verification writes a bounded set of System
 * Incidents within the incident write limit however much of a chain is broken, and a change among them is still new.
 */
const BREAKS_ONE_BY_ONE = 100;

/** A break, or the breaks after the first ones taken together, as a verification records it. */
export type RecordedBreak = { entry: string; kind: BreakKind; through: string; breaks: number; fingerprint: string };

/**
 * How long one chain's recompute may run: a routine Verify chain, and Recompute every entry. Both chains of Recompute
 * every entry together stay under the 100 seconds Cloudflare's edge waits for a reply, so QA reads the refusal.
 */
export const VERIFY_READ_LIMIT_SECONDS = { routine: 30, everyEntry: 45 } as const;

export interface VerifyOptions {
  everyEntry?: boolean;
  readLimitSeconds?: number | undefined;
}

/** `at` rendered by the database as ISO 8601 UTC to the microsecond, so that no host clock formats it. */
export const inUtc = (at: RawBuilder<unknown>) =>
  sql<Instant>`to_char(${at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** A chain as the database recomputed it, before QA reads it. */
export type RecomputedChain = {
  chain: ChainKind;
  chainId: string;
  at: Instant;
  lastEntry: string;
  head: string;
  breaks: RecordedBreak[];
} & Resumed;

/** A chain whose recompute the read limit stopped, with the database's error, so that a System Incident can record it. */
type TimedOut = { timedOut: ChainKind; withinSeconds: number; error: Error };
export type VerifiedChains = { at: Instant; chains: RecomputedChain[] } | TimedOut;
type Recomputed = Omit<RecomputedChain, 'chain' | 'chainId'>;

async function recompute(tx: Kysely<DB>, chain: string, everyEntry: boolean): Promise<Recomputed> {
  const zero = sql`decode(repeat('00', 32), 'hex')`;
  const { rows } = await sql<Recomputed>`
    with resume as (
      select coalesce(c.through, 0) as through,
             coalesce(c.head, ${zero}) as head,
             case when c.through is not null then json_build_object(
               'through', c.through::text,
               'at', ${inUtc(sql`c.verified_at`)},
               'by', p.display_name) end as verified_before
      from (select) as one
      left join lateral (select * from lims.latest_chain_verification(${chain}) where not ${everyEntry}) as c on true
      left join lims.person as p on p.id = c.verified_by
    ), found as (
      select b.*, row_number() over (order by b.seq, b.kind) as n
      from (select w.seq, w.kind, w.through, w.fingerprint
            from resume, lims.chain_breaks(${chain}, resume.through, resume.head) as w
            union all
            select v.seq, v.kind, v.through, v.fingerprint
            from resume, lims.chain_verification_breaks(${chain}, resume.through) as v) as b
    ), recorded as (
      select seq, kind, through, 1 as breaks, fingerprint from found where n <= ${BREAKS_ONE_BY_ONE}
      union all
      select min(seq), 'More', max(through), count(*)::int,
        sha256(string_agg(int8send(seq) || sha256(fingerprint), ''::bytea order by seq))
      from found where n > ${BREAKS_ONE_BY_ONE} having count(*) > 0
    )
    select ${inUtc(sql`now()`)} as at,
      coalesce(chain_now.seq, 0)::text as last_entry,
      encode(coalesce(chain_now.head, ${zero}), 'hex') as head,
      (resume.through + 1)::text as recomputed_from,
      resume.verified_before,
      coalesce((
        select json_agg(json_build_object(
          'entry', r.seq::text, 'kind', r.kind, 'through', r.through::text, 'breaks', r.breaks,
          'fingerprint', encode(r.fingerprint, 'hex')
        ) order by r.seq, r.kind)
        from recorded as r
      ), '[]') as breaks
    from resume left join lims.audit_chain as chain_now on chain_now.chain = ${chain}`.execute(tx);
  const [found] = rows;
  if (!found) throw new Error(`the recompute of chain ${chain} returned no row`);
  return found;
}

/** The one lab-scoped seam: every read and write after login goes through it, filtered to the context's Lab. */
export function labScope(db: Kysely<DB>, ctx: ActorContext) {
  const labId = ctx.lab.id;
  if (!labId) throw new Error('a lab-scoped query needs the Lab of the ActorContext');
  return {
    ctx,
    ...inLab(db, labId),
    /** Reaches only this Lab's chain and the company chain. */
    trail: () => db.selectFrom('auditEntry').where('chain', 'in', [labId, 'company']),
    /**
     * Recomputes this Lab's chain and the company chain from one snapshot, each from its latest Chain Verification
     * unless `everyEntry` asks for the whole chain, and each within `readLimitSeconds`: the first chain that overruns it is
     * answered as `timedOut`, with the error, for the caller to record and refuse.
     */
    verifyAuditTrail: async ({
      everyEntry = false,
      readLimitSeconds = VERIFY_READ_LIMIT_SECONDS.routine,
    }: VerifyOptions = {}) => {
      const read = async (tx: Kysely<DB>): Promise<VerifiedChains> => {
        await sql`select set_config('statement_timeout', ${`${Math.round(readLimitSeconds * 1000)}ms`}, true)`.execute(
          tx,
        );
        const chains: RecomputedChain[] = [];
        for (const [chain, chainId] of [
          ['lab', labId],
          ['company', 'company'],
        ] as const) {
          const found = await recompute(tx, chainId, everyEntry).catch((error: unknown): TimedOut => {
            if (error instanceof Error && postgresFault(error)?.sqlstate === '57014')
              return { timedOut: chain, withinSeconds: readLimitSeconds, error };
            throw new Error(`Verify chain could not recompute the ${chain} chain`, { cause: error });
          });
          if ('timedOut' in found) return found;
          chains.push({ chain, chainId, ...found });
        }
        await sql`select set_config(name, reset_val, true) from pg_settings where name = 'statement_timeout'`.execute(
          tx,
        );
        const [first] = chains;
        if (!first) throw new Error('Verify chain recomputed no chain');
        return { at: first.at, chains };
      };
      return db.isTransaction
        ? read(db)
        : db.transaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute(read);
    },
    /** One audited transaction; a write a re-authentication enables holds that person's row before anything else. */
    write: <R>(reason: string, role: Role, fn: (q: WriteQueries) => Promise<R>, reauthenticated?: Reauthenticated) =>
      auditedAfterReauthentication(
        db,
        { actor: `person:${ctx.person.username}`, role, reason },
        reauthenticated,
        (tx) => fn(inWrite(tx, labId)),
      ),
  };
}

export type Scope = ReturnType<typeof labScope>;
