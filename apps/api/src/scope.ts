import { randomBytes } from 'node:crypto';
import { audited, type DB } from '@lims/db';
import type { ActorContext, RefusalKind, Role } from '@lims/domain';
import type { FastifyError, FastifyReply, FastifyRequest, FastifySchemaValidationError } from 'fastify';
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

/** Every kind's status, chosen here and nowhere else; the test harness checks every refused answer against it. */
export const STATUS: { readonly [K in RefusalKind]: number } = {
  unknownField: 400,
  malformed: 400,
  badCredentials: 401,
  noSession: 401,
  role: 403,
  guard: 403,
  notFound: 404,
  state: 409,
  stale: 409,
  accountLocked: 423,
  failure: 500,
};

/** A refusal in flight between a handler and `answerThrown`. It never leaves this module. */
class Refused extends Error {
  kind: RefusalKind;
  constructor(kind: RefusalKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** The one place a refusal becomes HTTP: `answerThrown` writes it as the route's 4xx body with its kind's status. */
export function refuse(kind: Exclude<RefusalKind, 'failure'>, message: string): never {
  throw new Refused(kind, message);
}

/** `instancePath` `/input` and the property `extra` name the field `input.extra`; a top-level field is its bare name. */
function fieldPath(first: FastifySchemaValidationError): string {
  return [...first.instancePath.split('/').filter(Boolean), String(first.params.additionalProperty)].join('.');
}

/**
 * What Fastify refused before the handler ran: a field outside the closed schema, any other request outside its
 * schema, unparseable JSON, a wrong media type, or any other 4xx it threw. Null for anything else.
 */
function refusedByFastify(error: FastifyError): Refused | null {
  const [first] = error.validation ?? [];
  if (first?.keyword === 'additionalProperties')
    return new Refused('unknownField', `the LIMS does not know the field ${fieldPath(first)}`);
  if (first || (typeof error.statusCode === 'number' && error.statusCode < 500))
    return new Refused('malformed', error.message);
  return null;
}

const READ_ALOUD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Eight Crockford base32 characters from 40 random bits, so a reference is unlikely to repeat, even across restarts of the API. */
export function requestReference(): string {
  return Array.from(randomBytes(8), (byte) => READ_ALOUD.charAt(byte % 32)).join('');
}

/** Every non-2xx body is written here: a refusal with its kind's status, or a failure logged with its cause and answered with a reference only. */
export function answerThrown(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  const refused = error instanceof Refused ? error : refusedByFastify(error);
  if (refused) return reply.code(STATUS[refused.kind]).send({ kind: refused.kind, message: refused.message });
  req.log.error({ err: error }, 'unexpected failure');
  return reply.code(STATUS.failure).send({
    kind: 'failure',
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
