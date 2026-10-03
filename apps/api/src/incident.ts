import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { audited, type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type ChainBreakFound,
  incidentStepNames,
  incidentStepRoute,
  type IncidentState,
  referencePattern,
  routes,
  stepNames,
  stepRoute,
} from '@lims/domain';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { type Insertable, type InsertObject, type Kysely, sql } from 'kysely';
import { type Static, type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';
import type { RecordedBreak } from './scope.ts';

const INCIDENT_SERVICE = { actor: 'svc:incident', role: 'system', reason: 'Open a System Incident' };
const RAISE_SERVICE = { ...INCIDENT_SERVICE, reason: 'Raise an unwritten System Incident from the API log' };
const UNWRITTEN = 'unwritten System Incident';

const INCIDENT_WRITE_LIMIT = '3s';
const READ_ALOUD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A reference a person can read aloud: eight Crockford base32 characters, one from each of the first eight bytes. */
export function referenceOf(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 8), (byte) => READ_ALOUD.charAt(byte % 32)).join('');
}

const STEP_OF_ROUTE = new Map<string, string>([
  ...Object.entries(routes).map(([name, route]): [string, string] => [`${route.method} ${route.url}`, name]),
  ...stepNames.map((name): [string, string] => [`POST ${stepRoute(name).url}`, name]),
  ...incidentStepNames.map((name): [string, string] => [`POST ${incidentStepRoute(name).url}`, name]),
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

type Incident = Insertable<DB['systemIncident']>;

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
  { additionalProperties: true },
);
/** Pino stamps `time` in epoch milliseconds from the API host's clock. */
const unwrittenLine = Type.Object({
  time: Type.Integer(),
  msg: Type.Literal(UNWRITTEN),
  unwrittenSystemIncident: unwrittenIncident,
});

function factsOf(error: Error) {
  const fault = postgresFault(error);
  return {
    kind: 'UnexpectedFailure',
    errorClass: error.constructor.name,
    sqlstate: fault?.sqlstate ?? null,
    constraintName: fault?.constraint ?? null,
  } as const;
}

async function write(db: Kysely<DB>, log: FastifyBaseLogger, incident: Incident): Promise<void> {
  try {
    await audited(db, INCIDENT_SERVICE, async (tx) => {
      await sql`select set_config('statement_timeout', ${INCIDENT_WRITE_LIMIT}, true)`.execute(tx);
      await tx.insertInto('systemIncident').values(incident).execute();
    });
  } catch (unwritten) {
    log.error({ err: unwritten, unwrittenSystemIncident: incident }, UNWRITTEN);
  }
}

/** Opens a System Incident for an unexpected failure under the reference the person is shown; when the database cannot write it, the log line holds it instead. */
export async function openSystemIncident(db: Kysely<DB>, req: FastifyRequest, error: Error): Promise<void> {
  await write(db, req.log, {
    ...factsOf(error),
    reference: req.id,
    requestedBy: req.requester?.person.id ?? null,
    sessionLabId: req.requester?.lab.id ?? null,
    step: stepOf(req),
    recordId: recordIdOf(req),
  });
}

/** Opens a System Incident for a failure of a job that no request started, such as the expiry sweep; when the database cannot write it, the log line holds it instead. */
export async function openJobIncident(
  db: Kysely<DB>,
  log: FastifyBaseLogger,
  job: { reference: string; step: string },
  error: Error,
): Promise<void> {
  await write(db, log, { ...factsOf(error), ...job });
}

const ALARM = 'System Incident alarm';

/**
 * Opens, in one transaction, one System Incident for each recorded break that chain verification found in a chain,
 * naming the chain as the Audit Trail does, the break's first and last entries, how many breaks it is, their
 * fingerprint and every break it covers, with the person whose verification found them as the requesting person, and
 * raises the alarm once for each incident it opened, after they are written. A break verified before, unchanged,
 * answers its incident, in whatever state it is now, and opens no other and raises no alarm; a break tampered with
 * again has a new fingerprint and opens its own. A failure to write them fails the verification, whose 500 opens a
 * System Incident of its own, so a break is never shown without a record.
 */
export async function openChainIncidents(
  db: Kysely<DB>,
  log: FastifyBaseLogger,
  requester: ActorContext,
  chain: string,
  breaks: RecordedBreak[],
): Promise<ChainBreakFound[]> {
  if (breaks.length === 0) return [];
  const column = <K extends keyof RecordedBreak>(key: K) => breaks.map((b) => b[key]);
  const references = breaks.map(() => referenceOf(randomBytes(8)));
  const { opened, found } = await audited(db, INCIDENT_SERVICE, async (tx) => {
    await sql`select set_config('statement_timeout', ${INCIDENT_WRITE_LIMIT}, true)`.execute(tx);
    const { rows: opened } = await sql<{ reference: string; entry: string }>`
      insert into lims.system_incident
        (kind, reference, requested_by, session_lab_id, chain, first_failure, last_failure, break_count, fingerprint,
         breaks)
      select 'ChainVerifyFailure', t.reference, ${requester.person.id}, ${requester.lab.id}, ${chain}, t.entry,
        t.through, t.breaks, decode(t.fingerprint, 'hex'), t.covered::jsonb
      from unnest(${references}::text[], ${column('entry')}::bigint[], ${column('through')}::bigint[],
        ${column('breaks')}::int[], ${column('fingerprint')}::text[], ${breaks.map((b) => JSON.stringify(b.covered))}::text[])
        as t(reference, entry, through, breaks, fingerprint, covered)
      on conflict (chain, first_failure, fingerprint) do nothing
      returning reference, first_failure::text as entry`.execute(tx);
    const { rows: found } = await sql<{ key: string; reference: string; state: IncidentState }>`
      select i.first_failure::text || ':' || encode(i.fingerprint, 'hex') as key, i.reference, i.state
      from lims.system_incident i
      join unnest(${column('entry')}::bigint[], ${column('fingerprint')}::text[]) as t(entry, fingerprint)
        on i.first_failure = t.entry and i.fingerprint = decode(t.fingerprint, 'hex')
      where i.chain = ${chain}`.execute(tx);
    return { opened, found };
  });
  for (const { reference, entry } of opened)
    log.error({ alarm: { reference, kind: 'ChainVerifyFailure', chain, entry } }, ALARM);
  const byBreak = new Map(found.map((f) => [f.key, f]));
  return breaks.map(({ entry, kind, through, breaks: count, fingerprint }) => {
    const incident = byBreak.get(`${entry}:${fingerprint}`);
    if (incident === undefined) throw new Error(`no System Incident records the break at entry ${entry}`);
    return { entry, kind, through, breaks: count, incident: incident.reference, incidentState: incident.state };
  });
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

type Unraisable = {
  errorClass: 'UnreadableLine' | 'RefusedValues' | 'ReferenceTaken';
  sqlstate?: string;
  constraintName?: string | null;
};

function insertOnce(db: Kysely<DB>, incident: InsertObject<DB, 'systemIncident'>) {
  return audited(db, RAISE_SERVICE, async (tx) => {
    await sql`select set_config('statement_timeout', ${INCIDENT_WRITE_LIMIT}, true)`.execute(tx);
    const { numInsertedOrUpdatedRows } = await tx
      .insertInto('systemIncident')
      .values(incident)
      .onConflict((conflict) => conflict.column('reference').doNothing())
      .executeTakeFirstOrThrow();
    return numInsertedOrUpdatedRows ? 'raised' : 'written';
  });
}

async function raise(db: Kysely<DB>, { time, unwrittenSystemIncident: logged }: Static<typeof unwrittenLine>) {
  const { kind, reference, requestedBy, sessionLabId, step, recordId, errorClass, sqlstate, constraintName } = logged;
  const facts = { kind, reference, requestedBy, sessionLabId, step, recordId, errorClass, sqlstate, constraintName };
  let outcome: 'raised' | 'written';
  try {
    outcome = await insertOnce(db, { ...facts, loggedAt: sql<Date>`to_timestamp(${time}::double precision / 1000)` });
  } catch (error) {
    const fault = postgresFault(error);
    if (!fault || !REFUSED_VALUES.test(fault.sqlstate)) throw error;
    return {
      errorClass: 'RefusedValues',
      sqlstate: fault.sqlstate,
      constraintName: fault.constraint,
    } satisfies Unraisable;
  }
  if (outcome === 'raised') return outcome;
  const same = await db
    .selectFrom('systemIncident')
    .select('reference')
    .where('reference', '=', reference)
    .where('kind', '=', kind)
    .where('step', '=', step)
    .where('errorClass', '=', errorClass)
    .where('requestedBy', 'is not distinct from', requestedBy)
    .where('sessionLabId', 'is not distinct from', sessionLabId)
    .where('recordId', 'is not distinct from', recordId)
    .where('sqlstate', 'is not distinct from', sqlstate)
    .where('constraintName', 'is not distinct from', constraintName)
    .executeTakeFirst();
  return same ? outcome : ({ errorClass: 'ReferenceTaken' } satisfies Unraisable);
}

/** A line that cannot be raised is itself a System Incident, under a reference taken from the line's bytes, so it too is written once. */
function raiseUnraisable(db: Kysely<DB>, line: string, { errorClass, sqlstate, constraintName }: Unraisable) {
  return insertOnce(db, {
    kind: 'UnraisableLogLine',
    reference: referenceOf(createHash('sha256').update(line).digest()),
    step: 'raiseUnwrittenIncidents',
    errorClass,
    sqlstate: sqlstate ?? null,
    constraintName: constraintName ?? null,
  });
}

/**
 * Writes each unwritten System Incident on the API log file whose reference has no System Incident yet, with the
 * instant its line was logged; a line it cannot raise is written as an UnraisableLogLine System Incident instead.
 */
export async function raiseUnwrittenIncidents(db: Kysely<DB>, file: string, log: FastifyBaseLogger): Promise<void> {
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    lineNumber += 1;
    const unwritten = unwrittenOn(line);
    if (unwritten === null) continue;
    const outcome =
      unwritten === 'unreadable' ? ({ errorClass: 'UnreadableLine' } as const) : await raise(db, unwritten);
    if (outcome === 'raised') log.info({ file, line: lineNumber }, `raised ${UNWRITTEN}`);
    if (typeof outcome === 'object' && (await raiseUnraisable(db, line, outcome)) === 'raised')
      log.error({ file, line: lineNumber, errorClass: outcome.errorClass }, `unraisable ${UNWRITTEN} line`);
  }
}
