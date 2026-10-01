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
type LabTable = Exclude<keyof DB, CompanyTable | 'audit_entry' | 'session'>;

export function refuse(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

function inLab(q: Kysely<DB>, labId: string) {
  const ofLab = (table: LabTable) => sql<boolean>`${sql.ref(`${table}.lab_id`)} = ${labId}`;
  return {
    from: <T extends LabTable>(table: T) =>
      (q.selectFrom(table) as unknown as SelectQueryBuilder<DB, T, {}>).where(ofLab(table)),
    insert: <T extends LabTable>(table: T, values: Omit<Insertable<DB[T]>, 'lab_id'>) =>
      q.insertInto(table).values({ ...values, lab_id: labId } as unknown as Insertable<DB[T]>),
    update: <T extends LabTable>(table: T) =>
      (q.updateTable(table) as unknown as UpdateQueryBuilder<DB, T, T, UpdateResult>).where(ofLab(table)),
    // Typed without the Lab tables, so a Lab row can only be reached through the filtered builders above.
    company: q as unknown as Kysely<Pick<DB, CompanyTable>>,
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
    auditTrail: () => db.selectFrom('audit_entry').where('chain', '=', labId),
    verifyChain: async (chain: 'lab' | 'company') =>
      (
        await db
          .selectNoFrom(sql<string | null>`lims.verify_chain(${chain === 'lab' ? labId : 'company'})`.as('broken'))
          .executeTakeFirstOrThrow()
      ).broken,
    write: <R>(reason: string, role: Role, fn: (q: LabQueries) => Promise<R>) =>
      audited(db, { actor: `person:${ctx.person.username}`, role, reason }, (tx) => fn(inLab(tx, labId))),
  };
}

export type Scope = ReturnType<typeof labScope>;
