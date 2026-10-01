import { randomBytes } from 'node:crypto';
import { audited, type DB } from '@lims/db';
import type { ActorContext, Role } from '@lims/domain';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
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

/** The one place a refusal becomes an HTTP status: Fastify writes the thrown error as the route's 4xx body. */
export function refuse(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

const READ_ALOUD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Eight Crockford base32 characters from 40 random bits, so a reference is unlikely to repeat, even across restarts of the API. */
export function requestReference(): string {
  return Array.from(randomBytes(8), (byte) => READ_ALOUD.charAt(byte % 32)).join('');
}

/** A refusal keeps its own status and message; any other failure is logged with its cause and answered with a reference only. */
export function answerThrown(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (typeof error.statusCode === 'number' && error.statusCode < 500) throw error;
  req.log.error({ err: error }, 'unexpected failure');
  return reply.code(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: `the LIMS could not finish this request; reload to see what was saved, and give the Admin reference ${req.id}`,
  });
}

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
    auditTrail: () => db.selectFrom('auditEntry').where('chain', '=', labId),
    verifyAuditTrail: () =>
      db
        .selectNoFrom([
          sql<Date>`now()`.as('at'),
          sql<string | null>`lims.verify_chain(${labId})`.as('lab'),
          sql<string | null>`lims.verify_chain('company')`.as('company'),
        ])
        .executeTakeFirstOrThrow(),
    write: <R>(reason: string, role: Role, fn: (q: LabQueries) => Promise<R>) =>
      audited(db, { actor: `person:${ctx.person.username}`, role, reason }, (tx) => fn(inLab(tx, labId))),
  };
}

export type Scope = ReturnType<typeof labScope>;
