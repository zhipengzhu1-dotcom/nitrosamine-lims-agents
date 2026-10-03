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
  | 'signatureStatement'
  | 'chainVerification';
type LabTable = Exclude<keyof DB, CompanyTable | 'accessEvent' | 'auditEntry' | 'session' | 'systemIncident'>;

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

export const VERIFY_READ_LIMIT_SECONDS = 30;
const VERIFY_READ_LIMIT = `${VERIFY_READ_LIMIT_SECONDS}s`;

export interface VerifyOptions {
  everyEntry?: boolean;
  /** A PostgreSQL interval such as `30s`. */
  readLimit?: string | undefined;
}

/** A chain as the database recomputed it, before QA reads it. */
export type RecomputedChain = {
  chain: ChainKind;
  chainId: string;
  at: Instant;
  lastEntry: string;
  head: string;
  breaks: RecordedBreak[];
} & Resumed;

export type VerifiedChains = { at: Instant; chains: RecomputedChain[] } | { timedOut: ChainKind };

async function recompute(
  tx: Kysely<DB>,
  chain: string,
  everyEntry: boolean,
): Promise<Omit<RecomputedChain, 'chain' | 'chainId'>> {
  const zero = sql`decode(repeat('00', 32), 'hex')`;
  const { rows } = await sql<Omit<RecomputedChain, 'chain' | 'chainId'>>`
    with resume as (
      select case when ${everyEntry} then 0 else coalesce(c.through, 0) end as through,
             case when ${everyEntry} then ${zero} else coalesce(c.head, ${zero}) end as head,
             case when ${everyEntry} or c.through is null then null else json_build_object(
               'through', c.through::text,
               'at', to_char(c.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'by', p.display_name) end as verified_before
      from (select) as one
      left join lims.latest_chain_verification(${chain}) as c on true
      left join lims.person as p on p.id = c.verified_by
    ), found as (
      select b.*, row_number() over (order by b.seq) as n
      from resume, lims.chain_breaks(${chain}, resume.through, resume.head) as b
    ), recorded as (
      select seq, kind, through, 1 as breaks, fingerprint from found where n <= ${BREAKS_ONE_BY_ONE}
      union all
      select min(seq), 'More', max(through), count(*)::int,
        sha256(string_agg(int8send(seq) || sha256(fingerprint), ''::bytea order by seq))
      from found where n > ${BREAKS_ONE_BY_ONE} having count(*) > 0
    )
    select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
      coalesce((select seq from lims.audit_chain where chain = ${chain}), 0)::text as last_entry,
      encode(coalesce((select head from lims.audit_chain where chain = ${chain}), ${zero}), 'hex') as head,
      (resume.through + 1)::text as recomputed_from,
      resume.verified_before,
      coalesce((
        select json_agg(json_build_object(
          'entry', r.seq::text, 'kind', r.kind, 'through', r.through::text, 'breaks', r.breaks,
          'fingerprint', encode(r.fingerprint, 'hex')
        ) order by r.seq)
        from recorded as r
      ), '[]') as breaks
    from resume`.execute(tx);
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
     * unless `everyEntry` asks for the whole chain, and each within `readLimit`: the first chain that overruns it is
     * answered as `timedOut` instead of a failure.
     */
    verifyAuditTrail: async ({ everyEntry = false, readLimit = VERIFY_READ_LIMIT }: VerifyOptions = {}) => {
      const read = async (tx: Kysely<DB>): Promise<VerifiedChains> => {
        await sql`select set_config('statement_timeout', ${readLimit}, true)`.execute(tx);
        const chains: RecomputedChain[] = [];
        for (const [chain, chainId] of [
          ['lab', labId],
          ['company', 'company'],
        ] as const) {
          const found = await recompute(tx, chainId, everyEntry).catch((error: unknown) => {
            if (postgresFault(error)?.sqlstate === '57014') return chain;
            throw new Error(`Verify chain could not recompute the ${chain} chain`, { cause: error });
          });
          if (typeof found === 'string') return { timedOut: found };
          chains.push({ chain, chainId, ...found });
        }
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
