import { audited, type DB } from '@lims/db';
import {
  type ActorContext,
  type BreakKind,
  type NumberedKind,
  type NumberTaken,
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

type CompanyTable =
  | 'customer'
  | 'person'
  | 'method'
  | 'submission'
  | 'lab'
  | 'identityVerification'
  | 'credentialLink'
  | 'signatureStatement';
type LabTable = Exclude<keyof DB, CompanyTable | 'auditEntry' | 'session' | 'systemIncident'>;

function inLab(q: Kysely<DB>, labId: string) {
  const ofLab = (table: LabTable) => sql<boolean>`${sql.ref(`${table}.labId`)} = ${labId}`;
  // Typed without the Lab tables, so a Lab row can only be reached through the filtered builders below.
  const company: Kysely<Pick<DB, CompanyTable>> = q;
  return {
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

/** The one lab-scoped seam: every read and write after login goes through it, filtered to the context's Lab. */
export function labScope(db: Kysely<DB>, ctx: ActorContext) {
  const labId = ctx.lab.id;
  if (!labId) throw new Error('a lab-scoped query needs the Lab of the ActorContext');
  return {
    ctx,
    ...inLab(db, labId),
    /** Reaches only this Lab's chain and the company chain. */
    trail: () => db.selectFrom('auditEntry').where('chain', 'in', [labId, 'company']),
    /** Recomputes this Lab's chain and the company chain in one statement, so both are read from one snapshot. */
    verifyAuditTrail: async () => {
      const lastEntry = (chain: string) =>
        sql<string>`coalesce((select seq from lims.audit_chain where chain = ${chain}), 0)::text`;
      const breaks = (chain: string) =>
        sql<{ entry: string; kind: BreakKind; through: string }[]>`coalesce((
          select json_agg(
            json_build_object('entry', b.seq::text, 'kind', b.kind, 'through', b.through::text) order by b.seq
          )
          from lims.chain_breaks(${chain}) as b
        ), '[]')`;
      const found = await db
        .selectNoFrom([
          sql<Date>`now()`.as('at'),
          lastEntry(labId).as('labLast'),
          breaks(labId).as('labBreaks'),
          lastEntry('company').as('companyLast'),
          breaks('company').as('companyBreaks'),
        ])
        .executeTakeFirstOrThrow();
      return {
        at: found.at,
        chains: [
          { chain: 'lab' as const, chainId: labId, lastEntry: found.labLast, breaks: found.labBreaks },
          { chain: 'company' as const, chainId: 'company', lastEntry: found.companyLast, breaks: found.companyBreaks },
        ],
      };
    },
    write: <R>(reason: string, role: Role, fn: (q: WriteQueries) => Promise<R>) =>
      audited(db, { actor: `person:${ctx.person.username}`, role, reason }, (tx) => fn(inWrite(tx, labId))),
  };
}

export type Scope = ReturnType<typeof labScope>;
