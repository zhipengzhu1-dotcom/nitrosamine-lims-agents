import { audited, type DB } from '@lims/db';
import type { ActorContext, Role } from '@lims/domain';
import {
  type Insertable,
  type Kysely,
  type SelectQueryBuilder,
  sql,
  type UpdateQueryBuilder,
  type UpdateResult,
} from 'kysely';

type CompanyTable = 'customer' | 'person' | 'method' | 'submission' | 'lab';
type LabTable = Exclude<keyof DB, CompanyTable | 'auditEntry' | 'session'>;

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

/** The one lab-scoped seam: every read and write after login goes through it, filtered to the context's Lab. */
export function labScope(db: Kysely<DB>, ctx: ActorContext) {
  const labId = ctx.lab.id;
  if (!labId) throw new Error('a lab-scoped query needs the Lab of the ActorContext');
  return {
    ctx,
    ...inLab(db, labId),
    /** The entries of this Lab's chain and the company chain; another Lab's chain is out of reach. */
    trail: () => db.selectFrom('auditEntry').where('chain', 'in', [labId, 'company']),
    /** Recomputes this Lab's chain and the company chain: each one's last entry and the first entry that fails, or null. */
    verifyAuditTrail: async () => {
      const lastEntry = (chain: string) =>
        sql<string>`coalesce((select max(seq) from lims.audit_entry where chain = ${chain}), 0)::text`;
      const firstFailure = (chain: string) => sql<string | null>`lims.verify_chain(${chain})::text`;
      const found = await db
        .selectNoFrom([
          sql<Date>`now()`.as('at'),
          lastEntry(labId).as('labLast'),
          firstFailure(labId).as('labFailure'),
          lastEntry('company').as('companyLast'),
          firstFailure('company').as('companyFailure'),
        ])
        .executeTakeFirstOrThrow();
      return {
        at: found.at,
        chains: [
          { chain: 'lab' as const, lastEntry: found.labLast, firstFailure: found.labFailure },
          { chain: 'company' as const, lastEntry: found.companyLast, firstFailure: found.companyFailure },
        ],
      };
    },
    write: <R>(reason: string, role: Role, fn: (q: LabQueries) => Promise<R>) =>
      audited(db, { actor: `person:${ctx.person.username}`, role, reason }, (tx) => fn(inLab(tx, labId))),
  };
}

export type Scope = ReturnType<typeof labScope>;
