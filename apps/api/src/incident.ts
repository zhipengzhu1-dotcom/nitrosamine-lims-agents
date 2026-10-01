import { audited, type DB, postgresFault } from '@lims/db';
import { routes, stepNames, stepRoute } from '@lims/domain';
import type { FastifyRequest } from 'fastify';
import { type Insertable, type Kysely, sql } from 'kysely';

const INCIDENT_SERVICE = { actor: 'svc:incident', role: 'system', reason: 'Open a System Incident' };

const INCIDENT_WRITE_LIMIT = '3s';

const STEP_OF_ROUTE = new Map<string, string>([
  ...Object.entries(routes).map(([name, route]): [string, string] => [`${route.method} ${route.url}`, name]),
  ...stepNames.map((name): [string, string] => [`POST ${stepRoute(name).url}`, name]),
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stepOf(req: FastifyRequest): string {
  const route = `${req.method} ${req.routeOptions.url ?? 'unknown route'}`;
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

/** Opens a System Incident for an unexpected failure under the reference the person is shown; when the database cannot write it, the log line holds it instead. */
export async function openSystemIncident(db: Kysely<DB>, req: FastifyRequest, error: Error): Promise<void> {
  const fault = postgresFault(error);
  const incident = {
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
    req.log.error({ err: unwritten, unwrittenSystemIncident: incident }, 'unwritten System Incident');
  }
}
