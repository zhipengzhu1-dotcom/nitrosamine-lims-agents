import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { audited, type DB, postgresFault } from '@lims/db';
import { referencePattern, routes, stepNames, stepRoute } from '@lims/domain';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { type Insertable, type Kysely, sql } from 'kysely';
import { type Static, type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';

const INCIDENT_SERVICE = { actor: 'svc:incident', role: 'system', reason: 'Open a System Incident' };
const RAISE_SERVICE = { ...INCIDENT_SERVICE, reason: 'Raise an unwritten System Incident from the API log' };
const UNWRITTEN = 'unwritten System Incident';

const INCIDENT_WRITE_LIMIT = '3s';

const STEP_OF_ROUTE = new Map<string, string>([
  ...Object.entries(routes).map(([name, route]): [string, string] => [`${route.method} ${route.url}`, name]),
  ...stepNames.map((name): [string, string] => [`POST ${stepRoute(name).url}`, name]),
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stepOf(req: FastifyRequest): string {
  const route = `${req.method === 'HEAD' ? 'GET' : req.method} ${req.routeOptions.url ?? 'unknown route'}`;
  return STEP_OF_ROUTE.get(route) ?? route;
}

function recordIdOf(req: FastifyRequest): string | null {
  for (const source of [req.params, req.body]) {
    if (typeof source !== 'object' || source === null) continue;
    const id = 'id' in source ? source.id : 'testId' in source ? source.testId : null;
    if (typeof id === 'string' && UUID.test(id)) return id;
  }
  return null;
}

const nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);
const unwrittenIncident = Type.Object(
  {
    kind: Type.Literal('UnexpectedFailure'),
    reference: Type.String({ pattern: `^${referencePattern}$` }),
    requestedBy: nullable(Type.String()),
    sessionLabId: nullable(Type.String()),
    step: Type.String(),
    recordId: nullable(Type.String()),
    errorClass: Type.String(),
    sqlstate: nullable(Type.String({ pattern: '^[0-9A-Z]{5}$' })),
    constraintName: nullable(Type.String()),
  },
  { additionalProperties: false },
);
/** Pino stamps `time` in epoch milliseconds from the API host's clock. */
const unwrittenLine = Type.Object({
  time: Type.Integer(),
  msg: Type.Literal(UNWRITTEN),
  unwrittenSystemIncident: unwrittenIncident,
});

/** Opens a System Incident for an unexpected failure under the reference the person is shown; when the database cannot write it, the log line holds it instead. */
export async function openSystemIncident(db: Kysely<DB>, req: FastifyRequest, error: Error): Promise<void> {
  const fault = postgresFault(error);
  const incident: Static<typeof unwrittenIncident> = {
    kind: 'UnexpectedFailure',
    reference: req.id,
    requestedBy: req.requester?.person.id ?? null,
    sessionLabId: req.requester?.lab.id ?? null,
    step: stepOf(req),
    recordId: recordIdOf(req),
    errorClass: error.constructor.name,
    sqlstate: fault?.sqlstate ?? null,
    constraintName: fault?.constraint ?? null,
  } satisfies Insertable<DB['systemIncident']>;
  try {
    await audited(db, INCIDENT_SERVICE, async (tx) => {
      await sql`select set_config('statement_timeout', ${INCIDENT_WRITE_LIMIT}, true)`.execute(tx);
      await tx.insertInto('systemIncident').values(incident).execute();
    });
  } catch (unwritten) {
    req.log.error({ err: unwritten, unwrittenSystemIncident: incident }, UNWRITTEN);
  }
}

function unwrittenOn(line: string): Static<typeof unwrittenLine> | 'unreadable' | null {
  if (!line.includes(UNWRITTEN)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return 'unreadable';
  }
  if (typeof parsed !== 'object' || parsed === null || !('msg' in parsed) || parsed.msg !== UNWRITTEN) return null;
  return Value.Check(unwrittenLine, parsed) ? parsed : 'unreadable';
}

/** A data exception (22) or integrity constraint violation (23): the database refused this line's values, not the write. */
const REFUSED_VALUES = /^2[23]/;

async function raise(db: Kysely<DB>, { time, unwrittenSystemIncident }: Static<typeof unwrittenLine>) {
  try {
    const { numInsertedOrUpdatedRows } = await audited(db, RAISE_SERVICE, async (tx) => {
      await sql`select set_config('statement_timeout', ${INCIDENT_WRITE_LIMIT}, true)`.execute(tx);
      return tx
        .insertInto('systemIncident')
        .values({ ...unwrittenSystemIncident, loggedAt: sql<Date>`to_timestamp(${time}::double precision / 1000)` })
        .onConflict((conflict) => conflict.column('reference').doNothing())
        .executeTakeFirstOrThrow();
    });
    return numInsertedOrUpdatedRows ? 'raised' : 'written';
  } catch (error) {
    if (REFUSED_VALUES.test(postgresFault(error)?.sqlstate ?? '')) return 'unreadable';
    throw error;
  }
}

/** Writes each unwritten System Incident on the API log file whose reference has no System Incident yet, with the instant its line was logged. */
export async function raiseUnwrittenIncidents(db: Kysely<DB>, file: string, log: FastifyBaseLogger): Promise<void> {
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    lineNumber += 1;
    const unwritten = unwrittenOn(line);
    if (unwritten === null) continue;
    const outcome = unwritten === 'unreadable' ? unwritten : await raise(db, unwritten);
    if (outcome === 'unreadable') log.error({ file, line: lineNumber }, `unreadable ${UNWRITTEN} line`);
    if (outcome === 'raised') log.info({ file, line: lineNumber }, `raised ${UNWRITTEN}`);
  }
}
