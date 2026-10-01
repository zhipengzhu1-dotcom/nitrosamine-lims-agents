import { randomUUID } from 'node:crypto';
import type { DB } from '@lims/db';
import {
  type ActorContext,
  type Meaning,
  type PersonId,
  type RouteReply,
  refusal,
  type Step,
  type StepBody,
  type StepFacts,
  type StepInput,
  type StepName,
  stepNames,
  stepRoute,
  steps,
} from '@lims/domain';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { App } from './app.ts';
import { reauthenticate } from './auth.ts';
import { refuse } from './refuse.ts';
import { type LabQueries, labScope } from './scope.ts';

interface Effect<I> {
  signedRecord?: 'test_report';
  assignee?: (input: I) => PersonId;
  write(q: LabQueries, ctx: ActorContext, testId: string, input: I): Promise<unknown>;
}

/** What each step writes besides moving the Test's state. */
const effects: { [K in StepName]: Effect<StepInput<K>> } = {
  submit: {
    async write(q, ctx, testId, input) {
      const customerId = ctx.person.customerId ?? refuse('role', 'only a Customer User submits');
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
  review: { write: async () => {} },
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
    ? await q.from('signature').select(['meaning', 'personId']).where('recordId', '=', test.id).execute()
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

/** The signed Record Version: the Test as it stands after the step's writes, in a fixed field order. */
async function recordVersion(q: LabQueries, testId: string): Promise<Buffer> {
  const record = await q
    .from('test')
    .innerJoin('sample', 'sample.id', 'test.sampleId')
    .innerJoin('method', 'method.id', 'test.methodId')
    .innerJoin('submission', 'submission.id', 'sample.submissionId')
    .innerJoin('customer', 'customer.id', 'submission.customerId')
    .leftJoin('result', 'result.testId', 'test.id')
    .leftJoin('testReport', 'testReport.testId', 'test.id')
    .select([
      'test.id',
      'customer.name as customer',
      'sample.number as sample',
      'sample.description',
      'sample.receivedAt',
      'method.code as method',
      'method.version as methodVersion',
      'method.title as methodTitle',
      'test.gxpClass',
      'result.analyte',
      'result.value',
      'result.unit',
      'result.injectionSequenceRef',
      'result.notebookRef',
      sql<string>`result.performed_on::text`.as('performedOn'),
      'testReport.number as report',
    ])
    .where('test.id', '=', testId)
    .executeTakeFirstOrThrow();
  return Buffer.from(JSON.stringify(record));
}

async function sign(q: LabQueries, ctx: ActorContext, meaning: Meaning, table: 'test' | 'test_report', testId: string) {
  const recordId =
    table === 'test'
      ? testId
      : (await q.from('testReport').select('id').where('testId', '=', testId).executeTakeFirstOrThrow()).id;
  await q
    .insert('signature', {
      personId: ctx.person.id,
      meaning,
      recordTable: table,
      recordId,
      content: await recordVersion(q, testId),
    })
    .execute();
}

function registerStep<K extends StepName>(app: App, db: Kysely<DB>, name: K): void {
  const step: Step = steps[name];
  const effect: Effect<StepInput<K>> = effects[name];
  const route = stepRoute(name);
  app.post<{ Body: StepBody<K>; Reply: RouteReply<typeof route> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    const scope = labScope(db, actor);
    const test =
      body.testId === undefined
        ? null
        : ((await scope.from('test').selectAll().where('id', '=', body.testId).executeTakeFirst()) ??
          refuse('notFound', 'no such Test in this Lab'));
    const facts = await factsFor(scope, actor, test, effect.assignee?.(body.input));
    const refused = refusal(name, test?.state ?? null, actor.roles, facts);
    if (refused) refuse(refused.kind, refused.message);
    if (step.signs) {
      const { password } = body.signature ?? refuse('malformed', `${name} needs the signer's password`);
      await reauthenticate(db, actor, password, name);
    }

    const testId = test?.id ?? randomUUID();
    await scope.write(name, step.role, async (q) => {
      if (test) {
        const moved = await q
          .update('test')
          .set({ state: step.to })
          .where('id', '=', testId)
          .where('state', '=', test.state)
          .executeTakeFirstOrThrow();
        if (!moved.numUpdatedRows) refuse('stale', 'the Test has moved on; reload it');
      }
      await effect.write(q, actor, testId, body.input);
      if (step.signs) await sign(q, actor, step.signs, effect.signedRecord ?? 'test', testId);
    });
    req.log.info({ step: name, testId }, 'step taken');
    return { testId, state: step.to };
  });
}

/** `POST /api/steps/:step`, one route per registry entry so each body is validated against its own schema. */
export function stepRoutes(app: App, db: Kysely<DB>): void {
  for (const name of stepNames) registerStep(app, db, name);
}
