import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type IncidentStepBody,
  type IncidentStepInputs,
  type IncidentStepName,
  incidentRefusal,
  incidentStepNames,
  incidentStepRoute,
  incidentSteps,
  mayReadIncidents,
  routes,
} from '@lims/domain';
import { type Kysely, sql, type UpdateObject } from 'kysely';
import type { App } from './app.ts';
import { reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope } from './scope.ts';
import { signRecord, statementInForce } from './signing.ts';
import { onWallClock } from './trail.ts';

/** System Incidents are company records (map #1, lab-scope-incidents): Admin and QA of any Lab read and act on them. */
function readableBy(actor: ActorContext): void {
  if (!mayReadIncidents(actor.roles)) refuse('role', 'Reading a System Incident is an Admin or QA action.');
}

const contentHash = sql<string>`encode(lims.incident_content_hash(i.id), 'hex')`;

/** The version an Acknowledged signing from `labId` binds: the one that already holds this content, else the next. */
const versionIn = (labId: string) => sql<number>`coalesce(
  (select v.version from lims.record_version v
    where v.lab_id = ${labId} and v.record_table = 'system_incident' and v.record_id = i.id
      and v.content_hash = lims.incident_content_hash(i.id)),
  (select coalesce(max(v.version), 0) + 1 from lims.record_version v
    where v.lab_id = ${labId} and v.record_table = 'system_incident' and v.record_id = i.id))`;

const recorded = <T extends string>(
  text: T | null,
  username: string | null,
  displayName: string | null,
  at: Date | null,
) =>
  text === null || username === null || displayName === null || at === null
    ? null
    : { text, by: { username, displayName }, at };

/**
 * The System Incident as Admin and QA see it, with the Record Version a signing from this Lab would bind. The
 * Acknowledged Signature is read across Labs, because the incident is a company record and the owner may have signed
 * it from any Lab; it is reachable only through the incident it signs.
 */
async function readIncident(db: Kysely<DB>, labId: string, reference: string) {
  const row =
    (await db
      .selectFrom('systemIncident as i')
      .leftJoin('person as answerer', 'answerer.id', 'i.impactAnsweredBy')
      .leftJoin('person as immediate', 'immediate.id', 'i.immediateActionBy')
      .leftJoin('person as corrective', 'corrective.id', 'i.correctiveActionBy')
      .select([
        'i.id',
        'i.reference',
        'i.kind',
        'i.state',
        'i.step',
        'i.recordId',
        'i.requestedBy',
        'i.sessionLabId',
        'i.errorClass',
        'i.sqlstate',
        'i.constraintName',
        'i.subjectId',
        sql<string | null>`host(i.source_address)`.as('sourceAddress'),
        sql<string | null>`encode(i.typed_user_id_hmac, 'hex')`.as('typedUserIdHmac'),
        'i.chain',
        'i.firstFailure',
        'i.lastFailure',
        'i.breakCount',
        'i.openedAt',
        'i.loggedAt',
        'i.impactAnswer',
        'i.impactAnsweredAt',
        'answerer.username as answererUsername',
        'answerer.displayName as answererName',
        'i.immediateAction',
        'i.immediateActionAt',
        'immediate.username as immediateUsername',
        'immediate.displayName as immediateName',
        'i.correctiveAction',
        'i.correctiveActionAt',
        'corrective.username as correctiveUsername',
        'corrective.displayName as correctiveName',
        contentHash.as('contentHash'),
        versionIn(labId).as('version'),
      ])
      .where('i.reference', '=', reference)
      .executeTakeFirst()) ?? refuse('notFound', `No System Incident has the reference ${reference}.`);
  const acknowledged = await db
    .selectFrom('signature')
    .innerJoin('recordVersion', (j) =>
      j
        .onRef('recordVersion.labId', '=', 'signature.labId')
        .onRef('recordVersion.id', '=', 'signature.recordVersionId'),
    )
    .innerJoin('lab', 'lab.labId', 'signature.labId')
    .select([
      'signature.printedName as signer',
      'signature.username',
      'signature.role',
      'signature.signedAt',
      onWallClock(sql.ref<Date>('signature.signed_at'), sql.ref('lab.time_zone')).as('signedAtLab'),
    ])
    .where('recordVersion.recordTable', '=', 'system_incident')
    .where('recordVersion.recordId', '=', row.id)
    .where('signature.meaning', '=', 'Acknowledged')
    .executeTakeFirst();
  const {
    id,
    impactAnswer,
    impactAnsweredAt,
    answererUsername,
    answererName,
    immediateAction,
    immediateActionAt,
    immediateUsername,
    immediateName,
    correctiveAction,
    correctiveActionAt,
    correctiveUsername,
    correctiveName,
    contentHash: hash,
    version,
    ...facts
  } = row;
  const impact = recorded(impactAnswer, answererUsername, answererName, impactAnsweredAt);
  const view = {
    ...facts,
    impact: impact && { answer: impact.text, by: impact.by, at: impact.at },
    immediateAction: recorded(immediateAction, immediateUsername, immediateName, immediateActionAt),
    correctiveAction: recorded(correctiveAction, correctiveUsername, correctiveName, correctiveActionAt),
    recordVersion: { version, canonicalForm: 1, contentHash: hash },
    statement: await statementInForce(db),
    acknowledged: acknowledged ?? null,
  };
  return { id, view };
}

type Change = UpdateObject<DB, 'systemIncident'>;
const now = sql<Date>`clock_timestamp()`;

/** What each step writes on the incident; the state moves are what the database's trigger allows and nothing else. */
const changes: { [K in IncidentStepName]: (actor: ActorContext, input: IncidentStepInputs[K]) => Change } = {
  answerImpact: (actor, input) => ({
    impactAnswer: input.answer,
    impactAnsweredBy: actor.person.id,
    impactAnsweredAt: now,
  }),
  recordImmediateAction: (actor, input) => ({
    immediateAction: input.text,
    immediateActionBy: actor.person.id,
    immediateActionAt: now,
  }),
  recordCorrectiveAction: (actor, input) => ({
    correctiveAction: input.text,
    correctiveActionBy: actor.person.id,
    correctiveActionAt: now,
  }),
  acknowledge: () => ({ state: 'Acknowledged' }),
  close: () => ({ state: 'Closed' }),
};

/** The database's own refusal of a move (LA014) means another session changed the incident first; the bench reloads. */
function movedOn(error: unknown): never {
  const fault = postgresFault(error);
  if (fault?.sqlstate === 'LA014' && error instanceof Error)
    refuse('stale', `The System Incident has moved on: ${error.message}. Reload it.`);
  throw new Error('the System Incident step failed in the database', { cause: error });
}

function registerIncidentStep<K extends IncidentStepName>(app: App, db: Kysely<DB>, name: K, release: string): void {
  const step = incidentSteps[name];
  const route = incidentStepRoute(name);
  app.post<{ Body: IncidentStepBody<K> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    readableBy(actor);
    const sessionId = req.sessionKey.id;
    const scope = labScope(db, actor);
    const { id, view } = await readIncident(db, actor.lab.id, body.reference);
    const refused = incidentRefusal(name, view, actor.roles, body.input);
    if (refused) refuse(refused.kind, refused.message);
    const signature =
      step.signs === null
        ? null
        : (body.signature ?? refuse('malformed', `The ${name} step needs the signer's credentials.`));
    if (step.signs !== null && signature) {
      if (
        signature.recordVersion.version !== view.recordVersion.version ||
        signature.recordVersion.contentHash !== view.recordVersion.contentHash
      )
        refuse(
          'recordChanged',
          'The System Incident changed since this screen loaded it. Read it again before signing.',
        );
      if (view.statement.version !== signature.statementVersion)
        refuse(
          'signingRefused',
          'The Signature Statement changed since this screen loaded it. Read it again before signing.',
        );
    }
    const reauthenticated =
      step.signs !== null && signature
        ? await reauthenticate(
            db,
            { actor, session: req.sessionKey },
            { username: signature.username, password: signature.password },
            step.role,
            sourceAddressOf(req),
            'ReauthenticationFailed',
          )
        : undefined;
    await scope.write(
      name,
      step.role,
      async (q) => {
        // lock_chain (LA004) wants the company chain declared before this Lab's, which the Signature writes to.
        await sql`select lims.lock_chains('company', ${actor.lab.id})`.execute(q.company);
        if (step.signs !== null && signature) {
          const { rows } = await sql<{
            id: string;
          }>`select lims.version_system_incident(${actor.lab.id}, ${id}) as id`
            .execute(q.company)
            .catch(movedOn);
          const [latest] = rows;
          if (!latest) throw new Error('lims.version_system_incident returned no version');
          await signRecord(q, actor, sessionId, {
            meaning: step.signs,
            table: 'system_incident',
            recordId: id,
            seen: { id: latest.id, contentHash: signature.recordVersion.contentHash },
            statementVersion: signature.statementVersion,
            release,
          });
        }
        const moved = await q.company
          .updateTable('systemIncident')
          .set(changes[name](actor, body.input))
          .where('id', '=', id)
          .where('state', '=', view.state)
          .executeTakeFirstOrThrow()
          .catch(movedOn);
        if (!moved.numUpdatedRows) refuse('stale', 'The System Incident has moved on. Reload it.');
      },
      reauthenticated,
    );
    req.log.info({ step: name, reference: body.reference }, 'incident step taken');
    return (await readIncident(db, actor.lab.id, body.reference)).view;
  });
}

/** The System Incident list and view for Admin and QA, and `POST /api/incident-steps/:step`, one route per registry entry. */
export function incidentRoutes(app: App, db: Kysely<DB>, release: string): void {
  app.route({
    ...routes.incidents,
    handler: async (req) => {
      readableBy(req.actor);
      return db
        .selectFrom('systemIncident')
        .select(['reference', 'kind', 'state', 'openedAt', 'step', 'chain'])
        .where('state', '<>', 'Closed')
        .orderBy('openedAt', 'desc')
        .execute();
    },
  });
  app.route({
    ...routes.incident,
    handler: async (req) => {
      readableBy(req.actor);
      return (await readIncident(db, req.actor.lab.id, req.params.reference)).view;
    },
  });
  for (const name of incidentStepNames) registerIncidentStep(app, db, name, release);
}
