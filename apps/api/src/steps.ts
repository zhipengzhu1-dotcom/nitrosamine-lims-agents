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

/** The records a Signature can be given on, each with its own canonical content in the database. */
export type Signable = 'test' | 'test_report';

interface Effect<I> {
  signedRecord?: 'test_report';
  assignee?: (input: I) => PersonId;
  write(q: LabQueries, ctx: ActorContext, testId: string, input: I): Promise<unknown>;
}

async function nextNumber(q: LabQueries, table: 'sample' | 'testReport', prefix: string): Promise<string> {
  const { n } = await q
    .from(table)
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return `${prefix}${String(Number(n) + 1).padStart(5, '0')}`;
}

/** What each step writes besides moving the Test's state. */
const effects: { [K in StepName]: Effect<StepInput<K>> } = {
  submit: {
    async write(q, ctx, testId, input) {
      const customerId = ctx.person.customerId ?? refuse('role', 'only a Customer User submits');
      const submission = await q.company
        .insertInto('submission')
        .values({ customerId, submittedBy: ctx.person.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await q
        .insert('sample', {
          submissionId: submission.id,
          description: input.description,
          number: await nextNumber(q, 'sample', `${ctx.lab.code}-S`),
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
    write: async (q, ctx, testId) =>
      q.insert('testReport', { testId, number: await nextNumber(q, 'testReport', `${ctx.lab.code}-R`) }).execute(),
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
        .where('recordVersion.recordId', '=', test.id)
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

/** The record's latest Record Version, which the database wrote as it changed: what a Signature given now binds to. */
export function latestVersion(q: LabQueries, table: Signable, recordId: string) {
  return q
    .from('recordVersion')
    .select(['id', 'version', 'canonicalForm', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', table)
    .where('recordId', '=', recordId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

async function sign(q: LabQueries, ctx: ActorContext, meaning: Meaning, table: Signable, testId: string) {
  const recordId =
    table === 'test'
      ? testId
      : (await q.from('testReport').select('id').where('testId', '=', testId).executeTakeFirstOrThrow()).id;
  const { id: recordVersionId } = await latestVersion(q, table, recordId);
  await q.insert('signature', { personId: ctx.person.id, meaning, recordVersionId }).execute();
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
