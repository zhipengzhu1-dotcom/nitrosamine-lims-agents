import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type ChangeStepBody,
  type ChangeStepName,
  changeRefusal,
  changeStepRoute,
  changeSteps,
  routes,
} from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope } from './scope.ts';
import { proveReauthentication, signRecord } from './signing.ts';
import { changeFactsFor, seenVersion } from './steps.ts';

/**
 * The database's own refusals of a proposal or decision (LA017, and a second decision on one change) reach the bench as
 * refusals; any other failure is thrown with its cause.
 */
function changeRefused(error: unknown): never {
  const fault = postgresFault(error);
  if (fault?.sqlstate === '23505') refuse('stale', 'The Critical Data Change has moved on. Reload the Test.');
  if (fault?.sqlstate === 'LA017' && error instanceof Error)
    refuse('guard', `The Critical Data Change was refused: ${error.message}.`);
  throw new Error('the Critical Data Change step failed in the database', { cause: error });
}

/** Reads the Test and its pending change, and refuses the step by the registry before anything is written. */
async function prepare(
  db: Kysely<DB>,
  name: ChangeStepName,
  { actor, body }: { actor: ActorContext; body: { testId: string; changeId?: string } },
) {
  const scope = labScope(db, actor);
  const test =
    (await scope.from('test').select(['id', 'state', 'assigneeId']).where('id', '=', body.testId).executeTakeFirst()) ??
    refuse('notFound', 'This Lab has no such Test.');
  const { facts, pending } = await changeFactsFor(scope, actor, test);
  const refused = changeRefusal(name, facts, actor.roles);
  if (refused) refuse(refused.kind, refused.message);
  if (body.changeId !== undefined && body.changeId !== pending?.id)
    refuse('stale', 'The Critical Data Change has moved on. Reload the Test.');
  return { scope, test };
}

/** `POST /api/change-steps/:step`, one route per registry entry, and `GET /api/reasons/:step`. */
export function changeRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  app.route({
    ...routes.reasons,
    handler: async (req) =>
      labScope(db, req.actor)
        .company.selectFrom('picklistReason')
        .select(['id', 'label', 'needsText'])
        .where('step', '=', req.params.step)
        .orderBy('position')
        .execute(),
  });

  const propose = changeStepRoute('proposeChange');
  app.post<{ Body: ChangeStepBody<'proposeChange'> }>(propose.url, { schema: propose.schema }, async (req) => {
    const { actor, body } = req;
    const { scope, test } = await prepare(db, 'proposeChange', req);
    const result = await scope
      .from('result')
      .select(['id', 'value'])
      .where('testId', '=', test.id)
      .executeTakeFirstOrThrow();
    if (result.value === body.newValue) refuse('guard', 'The new value is the value already saved.');
    const changeId = await scope.write('proposeChange', changeSteps.proposeChange.role, async (q) => {
      // Kysely's insert type requires proposed_on_version, which only the propose trigger may write.
      const { rows } = await sql<{ id: string }>`insert into lims.critical_data_change
          (lab_id, test_id, result_id, field, old_value, new_value, reason_id, reason_text)
        values (${actor.lab.id}, ${test.id}, ${result.id}, 'value', ${result.value}, ${body.newValue},
                ${body.reasonId}, ${body.reasonText ?? null})
        returning id`
        .execute(q.company)
        .catch(changeRefused);
      const [proposed] = rows;
      if (!proposed) throw new Error('the Critical Data Change insert returned no id');
      return proposed.id;
    });
    req.log.info({ step: 'proposeChange', testId: test.id, changeId }, 'change step taken');
    return { changeId };
  });

  const approve = changeStepRoute('approveChange');
  app.post<{ Body: ChangeStepBody<'approveChange'> }>(approve.url, { schema: approve.schema }, async (req) => {
    const { actor, body } = req;
    const { scope, test } = await prepare(db, 'approveChange', req);
    const { signature, changeId } = body;
    const seen = await seenVersion(scope, 'critical_data_change', changeId, signature);
    const step = changeSteps.approveChange;
    const reauthenticated = await reauthenticate(
      db,
      credentials,
      { actor, session: req.sessionKey },
      { username: signature.username, password: signature.password, code: signature.code },
      step.role,
      sourceAddressOf(req),
      'ReauthenticationFailed',
    );
    const sessionId = req.sessionKey.id;
    await scope.write(
      'approveChange',
      step.role,
      async (q) => {
        const proof = await proveReauthentication(q, actor, sessionId, 'Approved', reauthenticated);
        const signatureId = await signRecord(q, {
          proof,
          sessionId,
          meaning: 'Approved',
          table: 'critical_data_change',
          recordId: changeId,
          seen,
          statementVersion: signature.statementVersion,
          release,
        });
        await q
          .insert('criticalDataChangeDecision', { changeId, testId: test.id, outcome: 'Approved', signatureId })
          .execute()
          .catch(changeRefused);
      },
      reauthenticated,
    );
    req.log.info({ step: 'approveChange', testId: test.id, changeId }, 'change step taken');
    return { changeId };
  });

  for (const [name, outcome] of [
    ['rejectChange', 'Rejected'],
    ['withdrawChange', 'Withdrawn'],
  ] as const) {
    const route = changeStepRoute(name);
    app.post<{ Body: ChangeStepBody<typeof name> }>(route.url, { schema: route.schema }, async (req) => {
      const { body } = req;
      const { scope, test } = await prepare(db, name, req);
      await scope.write(name, changeSteps[name].role, (q) =>
        q
          .insert('criticalDataChangeDecision', {
            changeId: body.changeId,
            testId: test.id,
            outcome,
            reasonId: body.reasonId,
            reasonText: body.reasonText ?? null,
          })
          .execute()
          .catch(changeRefused),
      );
      req.log.info({ step: name, testId: test.id, changeId: body.changeId }, 'change step taken');
      return { changeId: body.changeId };
    });
  }
}
