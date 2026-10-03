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
import { openChainIncidents } from './incident.ts';
import { refuse } from './refuse.ts';
import { labScope } from './scope.ts';
import { proveReauthentication, signingRefused, signRecord, statementInForce } from './signing.ts';
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
      'signature.meaning',
      'signature.printedName as signer',
      'signature.username',
      'signature.role',
      'signature.signedAt',
      onWallClock(sql.ref<Date>('signature.signed_at'), sql.ref('lab.time_zone')).as('signedAtLab'),
      'recordVersion.version',
      'recordVersion.canonicalForm',
      sql<string>`encode(record_version.content_hash, 'hex')`.as('contentHash'),
      sql<boolean>`record_version.content_hash <> lims.incident_content_hash(record_version.record_id)`.as('unsigned'),
    ])
    .where('recordVersion.recordTable', '=', 'system_incident')
    .where('recordVersion.recordId', '=', row.id)
    .where('signature.meaning', '=', 'Acknowledged')
    .orderBy('signature.signedAt')
    .executeTakeFirst()
    .then((signed) => {
      if (!signed) return null;
      const { version, canonicalForm, contentHash, ...signature } = signed;
      return { ...signature, record: 'System Incident', recordVersion: { version, canonicalForm, contentHash } };
    });
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
    acknowledged,
  };
  return { id, view };
}

type Change = UpdateObject<DB, 'systemIncident'>;
type Recorded = 'impactAnswer' | 'immediateAction' | 'correctiveAction';

/**
 * What each step writes on the incident, and the column that must still be null for the write to land, so that of two
 * presses at once the second changes nothing and is refused as stale. Who recorded each of the three and when, the
 * database stamps from the acting person and its clock; the state moves are what its trigger allows and nothing else.
 */
const changes: { [K in IncidentStepName]: { set: (input: IncidentStepInputs[K]) => Change; unrecorded: Recorded[] } } =
  {
    answerImpact: { set: (input) => ({ impactAnswer: input.answer }), unrecorded: ['impactAnswer'] },
    recordImmediateAction: { set: (input) => ({ immediateAction: input.text }), unrecorded: ['immediateAction'] },
    recordCorrectiveAction: { set: (input) => ({ correctiveAction: input.text }), unrecorded: ['correctiveAction'] },
    acknowledge: { set: () => ({ state: 'Acknowledged' }), unrecorded: [] },
    close: { set: () => ({ state: 'Closed' }), unrecorded: [] },
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
    const { set, unrecorded } = changes[name];
    await scope.write(
      name,
      step.role,
      async (q) => {
        if (step.signs !== null && signature) {
          // lock_chain (LA004) wants the company chain declared before this Lab's, which the Signature writes to.
          await sql`select lims.lock_chains('company', ${actor.lab.id})`.execute(q.company);
          const proof = await proveReauthentication(q, actor, sessionId, step.signs);
          const { rows } = await sql<{ id: string }>`select lims.version_system_incident(${proof}, ${id}) as id`
            .execute(q.company)
            .catch(signingRefused);
          const [latest] = rows;
          if (!latest) throw new Error('lims.version_system_incident returned no version');
          await signRecord(q, {
            proof,
            sessionId,
            meaning: step.signs,
            table: 'system_incident',
            recordId: id,
            seen: { id: latest.id, contentHash: signature.recordVersion.contentHash },
            statementVersion: signature.statementVersion,
            release,
          });
        } else {
          await sql`select lims.lock_chains('company')`.execute(q.company);
        }
        const moved = await q.company
          .updateTable('systemIncident')
          .set(set(body.input))
          .where('id', '=', id)
          .where('state', '=', view.state)
          .where((eb) => eb.and(unrecorded.map((column) => eb(column, 'is', null))))
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
  app.route({
    ...routes.incidentBreaks,
    handler: async (req) => {
      readableBy(req.actor);
      const { reference } = req.params;
      const incident =
        (await db
          .selectFrom('systemIncident')
          .select(['id', 'chain', 'firstFailure', 'lastFailure', 'fingerprint'])
          .where('reference', '=', reference)
          .executeTakeFirst()) ?? refuse('notFound', `No System Incident has the reference ${reference}.`);
      const { id, chain, firstFailure, lastFailure, fingerprint } = incident;
      if (chain === null || firstFailure === null)
        refuse('state', `System Incident ${reference} records no break in an Audit Trail chain.`);
      if (lastFailure === null || fingerprint === null)
        refuse(
          'state',
          `System Incident ${reference} was opened before the LIMS recorded a break's last entry. Verify the chain to record it again.`,
        );
      const scope = labScope(db, req.actor);
      const listed =
        (await scope.breaksWithin({ id, chain, first: firstFailure, last: lastFailure, fingerprint })) ??
        refuse(
          'role',
          `System Incident ${reference} records breaks in another Lab's chain. Switch to that Lab to list them.`,
        );
      // Recording a change is a verification, which is QA's: any other reader is told what is recorded already.
      if (listed.asRecorded || !req.actor.roles.includes('QA')) return { ...listed, opened: [] };
      const verified = (await scope.verifyAuditTrail()).chains.find((c) => c.chainId === chain);
      const found = verified ? await openChainIncidents(db, req.log, req.actor, chain, verified.breaks) : [];
      const inRange = found.filter(
        (b) =>
          b.incident !== reference &&
          BigInt(b.through) >= BigInt(firstFailure) &&
          BigInt(b.entry) <= BigInt(lastFailure),
      );
      return {
        ...listed,
        incidents: [...new Set(inRange.map((b) => b.incident))],
        opened: found.filter((b) => b.opened).map((b) => b.incident),
      };
    },
  });
  for (const name of incidentStepNames) registerIncidentStep(app, db, name, release);
}
