import { createHash, randomUUID } from 'node:crypto';
import type { DB } from '@lims/db';
import {
  type ActorContext,
  type Meaning,
  type PersonId,
  pressText,
  type RouteReply,
  type SigningBody,
  refusal,
  type Step,
  type StepBody,
  type StepFacts,
  type StepInput,
  type StepName,
  type StepTaken,
  stepNames,
  stepRoute,
  steps,
} from '@lims/domain';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, type Reauthenticated, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { type LabQueries, labScope, type WriteQueries } from './scope.ts';
import { reviewToSign } from './checklists.ts';
import {
  latestVersion,
  proveReauthentication,
  type Seen,
  type Signable,
  signRecord,
  statementInForce,
} from './signing.ts';

interface Effect<I> {
  signedRecord?: 'test_report';
  /** The Test Review a Reviewed press signs instead of the Test, refused before the signer re-authenticates unless it may be signed. */
  review?: (scope: LabQueries, ctx: ActorContext, testId: string, input: I) => Promise<string>;
  assignee?: (input: I) => PersonId;
  write(q: WriteQueries, ctx: ActorContext, testId: string, input: I): Promise<unknown>;
}

/** What each step writes besides moving the Test's state. */
const effects: { [K in StepName]: Effect<StepInput<K>> } = {
  submit: {
    async write(q, ctx, testId, input) {
      const customerId = ctx.person.customerId ?? refuse('role', 'Only a Customer User makes a Submission.');
      const submission = await q.company
        .insertInto('submission')
        .values({ customerId, submittedBy: ctx.person.id, number: await q.takeNumber('Submission') })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await q
        .insert('sample', {
          submissionId: submission.id,
          description: input.description,
          number: await q.takeNumber('Sample'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await q.insert('test', { id: testId, sampleId: sample.id, methodId: input.methodId }).execute();
    },
  },
  receive: {
    write: (q, _ctx, testId) =>
      q
        .update('sample')
        .set({ receivedAt: sql`clock_timestamp()` })
        .where('id', 'in', q.from('test').select('sampleId').where('id', '=', testId))
        .execute(),
  },
  assign: {
    assignee: (input) => input.assigneeId,
    write: (q, _ctx, testId, input) =>
      q.update('test').set({ assigneeId: input.assigneeId }).where('id', '=', testId).execute(),
  },
  enterResult: {
    write: (q, ctx, testId, input) =>
      q
        .insert('result', {
          testId,
          analyte: input.analyte,
          value: input.value,
          unit: input.unit,
          injectionSequenceRef: input.injectionSequenceRef,
          notebookRef: input.notebookRef,
          performedOn: input.performedOn,
          enteredBy: ctx.person.id,
        })
        .execute(),
  },
  review: {
    review: async (scope, ctx, testId, input) => {
      await reviewToSign(scope, ctx, testId, input.review);
      return input.review;
    },
    write: async () => {},
  },
  release: {
    signedRecord: 'test_report',
    write: async (q, _ctx, testId) =>
      q.insert('testReport', { testId, number: await q.takeNumber('TestReport') }).execute(),
  },
};

type FactsTest = Pick<Selectable<DB['test']>, 'id' | 'assigneeId' | 'methodId'>;

export async function factsFor(
  q: LabQueries,
  ctx: ActorContext,
  test: FactsTest | null,
  assigneeId?: string,
): Promise<StepFacts> {
  const signatures = test
    ? await signedVersions(q)
        .select(['signature.meaning', 'signature.personId'])
        .where((eb) =>
          eb.or([
            eb('recordVersion.recordId', '=', test.id),
            eb('recordVersion.recordId', 'in', q.from('testReview').select('id').where('testId', '=', test.id)),
          ]),
        )
        .execute()
    : [];
  const assignee = assigneeId ?? test?.assigneeId ?? null;
  const trained =
    assignee &&
    test &&
    (await q
      .from('trainingRecord')
      .innerJoin('membership', (j) =>
        j
          .onRef('membership.labId', '=', 'trainingRecord.labId')
          .onRef('membership.personId', '=', 'trainingRecord.personId'),
      )
      .select('trainingRecord.personId')
      .where('membership.role', '=', 'Analyst')
      .where('trainingRecord.personId', '=', assignee)
      .where('trainingRecord.methodId', '=', test.methodId)
      .executeTakeFirst());
  return {
    actor: ctx.person.id,
    assignee,
    assigneeTrained: Boolean(trained),
    signers: Object.fromEntries(signatures.map((s) => [s.meaning, s.personId])),
  };
}

/** Every Signature of the Lab joined to the Record Version it was given on. */
export function signedVersions(q: LabQueries) {
  return q
    .from('signature')
    .innerJoin('recordVersion', (j) =>
      j
        .onRef('recordVersion.labId', '=', 'signature.labId')
        .onRef('recordVersion.id', '=', 'signature.recordVersionId'),
    );
}

interface Signing {
  reauthenticated: Reauthenticated;
  meaning: Meaning;
  table: Signable;
  testId: string;
  /** The signed record when the press names it, as a Reviewed press names its Test Review. */
  recordId: string | null;
  seen: Seen;
  statementVersion: number;
  release: string;
}

/** Signs the Test, the Test Review the press names, or the Test Report this step issued on the Test. */
async function sign(q: WriteQueries, ctx: ActorContext, sessionId: string, signing: Signing) {
  const { reauthenticated, meaning, table, testId, seen, statementVersion, release } = signing;
  const recordId =
    signing.recordId ??
    (table === 'test'
      ? testId
      : (await q.from('testReport').select('id').where('testId', '=', testId).executeTakeFirstOrThrow()).id);
  const proof = await proveReauthentication(q, ctx, sessionId, meaning, reauthenticated);
  await signRecord(q, { proof, sessionId, meaning, table, recordId, seen, statementVersion, release });
}

async function seenVersion(
  scope: LabQueries,
  [table, recordId]: ['test' | 'test_review', string],
  signature: SigningBody,
): Promise<Seen> {
  const latest = await latestVersion(scope, table, recordId);
  if (latest.version !== signature.recordVersion.version || latest.contentHash !== signature.recordVersion.contentHash)
    refuse(
      'recordChanged',
      table === 'test'
        ? 'The Test changed since this screen loaded it. Read it again before signing.'
        : 'The Test changed since its Test Review was saved. Tick the checklist again before signing.',
    );
  if ((await statementInForce(scope.company)).version !== signature.statementVersion)
    refuse(
      'signingRefused',
      'The Signature Statement changed since this screen loaded it. Read it again before signing.',
    );
  return { id: latest.id, contentHash: signature.recordVersion.contentHash };
}

type KeptCommit = Pick<Selectable<DB['commitKey']>, 'sessionId' | 'requestHash' | 'testId' | 'state'>;

function receiptOf(kept: KeptCommit, sessionId: string, requestHash: Buffer): StepTaken {
  if (kept.sessionId !== sessionId)
    refuse('keyReused', 'This press was already saved before the latest sign-in. Reload to see what was saved.');
  if (!kept.requestHash.equals(requestHash))
    refuse('keyReused', 'This press was already saved with other entries. Reload to see what was saved.');
  return { testId: kept.testId, state: kept.state };
}

function registerStep<K extends StepName>(
  app: App,
  db: Kysely<DB>,
  credentials: Credentials,
  name: K,
  release: string,
): void {
  const step: Step = steps[name];
  const effect: Effect<StepInput<K>> = effects[name];
  const route = stepRoute(name);
  app.post<{ Body: StepBody<K>; Reply: RouteReply<typeof route> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    const sessionId = req.sessionKey.id;
    const scope = labScope(db, actor);
    const requestHash = createHash('sha256')
      .update(pressText(name, body.testId ?? null, body.input))
      .digest();
    const kept = (q: LabQueries) =>
      q.from('commitKey').select(['sessionId', 'requestHash', 'testId', 'state']).where('key', '=', body.commitKey);

    const test =
      body.testId === undefined
        ? null
        : ((await scope.from('test').selectAll().where('id', '=', body.testId).executeTakeFirst()) ??
          refuse('notFound', 'This Lab has no such Test.'));
    const facts = await factsFor(scope, actor, test, effect.assignee?.(body.input));
    const refused = refusal(name, test?.state ?? null, actor.roles, facts);
    if (refused) {
      // A retry finds the Test already moved by its own first press, whose key commits in the same transaction.
      const first = await kept(scope).executeTakeFirst();
      if (!first) refuse(refused.kind, refused.message);
      req.log.info({ step: name, testId: first.testId }, 'step replayed');
      return receiptOf(first, sessionId, requestHash);
    }
    let signing: Signing | null = null;
    if (step.signs) {
      // A retry whose first press committed between the registry check and here replays, as it does on a refusal.
      const first = await kept(scope).executeTakeFirst();
      if (first) {
        req.log.info({ step: name, testId: first.testId }, 'step replayed');
        return receiptOf(first, sessionId, requestHash);
      }
      const signature = body.signature ?? refuse('malformed', `The ${name} step needs the signer's credentials.`);
      const testId = test?.id ?? refuse('malformed', `The ${name} step signs a Test, and this request names none.`);
      const review = (await effect.review?.(scope, actor, testId, body.input)) ?? null;
      const seen = await seenVersion(scope, review ? ['test_review', review] : ['test', testId], signature);
      const reauthenticated = await reauthenticate(
        db,
        credentials,
        { actor, session: req.sessionKey },
        { username: signature.username, password: signature.password, code: signature.code },
        step.role,
        sourceAddressOf(req),
        'ReauthenticationFailed',
      );
      signing = {
        reauthenticated,
        meaning: step.signs,
        table: review ? 'test_review' : (effect.signedRecord ?? 'test'),
        testId,
        recordId: review,
        seen,
        statementVersion: signature.statementVersion,
        release,
      };
    }

    const claim = { testId: test?.id ?? randomUUID(), state: step.to };
    const { testId } = claim;
    const { receipt, replayed } = await scope.write(
      name,
      step.role,
      async (q) => {
        // A press whose key another transaction holds waits here for that one to commit, then replays it.
        const claimed = await q
          .insert('commitKey', { key: body.commitKey, sessionId, requestHash, ...claim })
          .onConflict((oc) => oc.doNothing())
          .returning('key')
          .executeTakeFirst();
        if (!claimed)
          return {
            receipt: receiptOf(await kept(q).executeTakeFirstOrThrow(), sessionId, requestHash),
            replayed: true,
          };
        if (test) {
          const moved = await q
            .update('test')
            .set({ state: step.to })
            .where('id', '=', testId)
            .where('state', '=', test.state)
            .executeTakeFirstOrThrow();
          if (!moved.numUpdatedRows) refuse('stale', 'The Test has moved on. Reload it.');
        }
        await effect.write(q, actor, testId, body.input);
        if (signing) await sign(q, actor, sessionId, signing);
        return { receipt: claim, replayed: false };
      },
      signing?.reauthenticated,
    );
    req.log.info({ step: name, testId: receipt.testId }, replayed ? 'step replayed' : 'step taken');
    return receipt;
  });
}

/** `POST /api/steps/:step`, one route per registry entry so each body is validated against its own schema. */
export function stepRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  for (const name of stepNames) registerStep(app, db, credentials, name, release);
}
