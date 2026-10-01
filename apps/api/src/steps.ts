import { randomUUID } from 'node:crypto';
import type { DB } from '@lims/db';
import { type Meaning, refusal, type Step, type StepFacts, type StepName, stepNames, steps } from '@lims/domain';
import type { FastifyInstance } from 'fastify';
import { type Kysely, type Selectable, sql } from 'kysely';
import { reauthenticate } from './auth.ts';
import { type ActorContext, type LabQueries, labScope, refuse } from './scope.ts';

export const uuid = { type: 'string', format: 'uuid' } as const;
const text = { type: 'string', minLength: 1, maxLength: 200 } as const;
const REFUSAL_STATUS = { state: 409, role: 403, guard: 403 } as const;

interface Inputs {
  submit: { methodId: string; description: string };
  receive: Record<string, never>;
  assign: { assigneeId: string };
  enterResult: { analyte: string; value: string; unit: string; injectionSequenceRef: string; notebookRef: string; performedOn: string };
  review: Record<string, never>;
  release: Record<string, never>;
}

interface Effect<I> {
  input: Record<string, object>;
  signedRecord?: 'test_report';
  write(q: LabQueries, ctx: ActorContext, testId: string, input: I): Promise<unknown>;
}

async function nextNumber(q: LabQueries, table: 'sample' | 'test_report', prefix: string): Promise<string> {
  const { n } = await q.from(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
  return `${prefix}${String(Number(n) + 1).padStart(5, '0')}`;
}

/** What each step writes besides moving the Test's state. */
const effects: { [K in StepName]: Effect<Inputs[K]> } = {
  submit: {
    input: { methodId: uuid, description: text },
    async write(q, ctx, testId, input) {
      const customerId = ctx.person.customerId ?? refuse(403, 'only a Customer User submits');
      const submission = await q.company.insertInto('submission').values({ customer_id: customerId, submitted_by: ctx.person.id })
        .returning('id').executeTakeFirstOrThrow();
      const sample = await q.insert('sample', {
        submission_id: submission.id, description: input.description, number: await nextNumber(q, 'sample', `${ctx.lab.code}-S`),
      }).returning('id').executeTakeFirstOrThrow();
      await q.insert('test', { id: testId, sample_id: sample.id, method_id: input.methodId }).execute();
    },
  },
  receive: {
    input: {},
    write: (q, _ctx, testId) => q.update('sample').set({ received_at: sql`clock_timestamp()` })
      .where('id', 'in', q.from('test').select('sample_id').where('id', '=', testId)).execute(),
  },
  assign: {
    input: { assigneeId: uuid },
    write: (q, _ctx, testId, input) => q.update('test').set({ assignee_id: input.assigneeId }).where('id', '=', testId).execute(),
  },
  enterResult: {
    input: {
      analyte: text, value: { type: 'string', pattern: '^-?[0-9]+(\\.[0-9]+)?$' }, unit: text,
      injectionSequenceRef: text, notebookRef: text, performedOn: { type: 'string', format: 'date' },
    },
    write: (q, ctx, testId, input) => q.insert('result', {
      test_id: testId, analyte: input.analyte, value: input.value, unit: input.unit, injection_sequence_ref: input.injectionSequenceRef,
      notebook_ref: input.notebookRef, performed_on: input.performedOn, entered_by: ctx.person.id,
    }).execute(),
  },
  review: { input: {}, write: async () => {} },
  release: {
    input: {},
    signedRecord: 'test_report',
    write: async (q, ctx, testId) =>
      q.insert('test_report', { test_id: testId, number: await nextNumber(q, 'test_report', `${ctx.lab.code}-R`) }).execute(),
  },
};

type FactsTest = Pick<Selectable<DB['test']>, 'id' | 'assignee_id' | 'method_id'>;

export async function factsFor(q: LabQueries, ctx: ActorContext, test: FactsTest | null, assigneeId?: string): Promise<StepFacts> {
  const signatures = test ? await q.from('signature').select(['meaning', 'person_id']).where('record_id', '=', test.id).execute() : [];
  const assignee = assigneeId ?? test?.assignee_id ?? null;
  const trained = assignee && test && await q.from('training_record')
    .innerJoin('membership', (j) => j.onRef('membership.lab_id', '=', 'training_record.lab_id')
      .onRef('membership.person_id', '=', 'training_record.person_id'))
    .select('training_record.person_id').where('membership.role', '=', 'Analyst')
    .where('training_record.person_id', '=', assignee).where('training_record.method_id', '=', test.method_id)
    .executeTakeFirst();
  return {
    actor: ctx.person.id, assignee, assigneeTrained: Boolean(trained),
    signers: Object.fromEntries(signatures.map((s) => [s.meaning, s.person_id])),
  };
}

/** The signed Record Version: the Test as it stands after the step's writes, in a fixed field order. */
async function recordVersion(q: LabQueries, testId: string): Promise<Buffer> {
  const record = await q.from('test')
    .innerJoin('sample', 'sample.id', 'test.sample_id').innerJoin('method', 'method.id', 'test.method_id')
    .leftJoin('result', 'result.test_id', 'test.id').leftJoin('test_report', 'test_report.test_id', 'test.id')
    .select(['test.id', 'sample.number as sample', 'method.code as method', 'method.version as methodVersion',
      'test.gxp_class as gxpClass', 'result.analyte', 'result.value', 'result.unit',
      'result.injection_sequence_ref as injectionSequenceRef', 'result.notebook_ref as notebookRef',
      sql<string>`result.performed_on::text`.as('performedOn'), 'test_report.number as report'])
    .where('test.id', '=', testId).executeTakeFirstOrThrow();
  return Buffer.from(JSON.stringify(record));
}

async function sign(q: LabQueries, ctx: ActorContext, meaning: Meaning, table: 'test' | 'test_report', testId: string) {
  const recordId = table === 'test'
    ? testId : (await q.from('test_report').select('id').where('test_id', '=', testId).executeTakeFirstOrThrow()).id;
  await q.insert('signature', {
    person_id: ctx.person.id, meaning, record_table: table, record_id: recordId, content: await recordVersion(q, testId),
  }).execute();
}

function stepRoute<K extends StepName>(app: FastifyInstance, db: Kysely<DB>, name: K): void {
  const step: Step = steps[name];
  const effect: Effect<Inputs[K]> = effects[name];
  const body = {
    type: 'object', additionalProperties: false,
    required: [...(step.from ? ['testId'] : []), 'input', ...(step.signs ? ['signature'] : [])],
    properties: {
      testId: uuid,
      input: { type: 'object', additionalProperties: false, required: Object.keys(effect.input), properties: effect.input },
      signature: { type: 'object', additionalProperties: false, required: ['password'], properties: { password: text } },
    },
  };

  app.post<{ Body: { testId?: string; input: Inputs[K]; signature?: { password: string } } }>(`/api/steps/${name}`, { schema: { body } },
    async (req) => {
      const { actor, body } = req;
      const scope = labScope(db, actor);
      const test = body.testId === undefined ? null
        : await scope.from('test').selectAll().where('id', '=', body.testId).executeTakeFirst() ?? refuse(404, 'no such Test in this Lab');
      const facts = await factsFor(scope, actor, test, (body.input as { assigneeId?: string }).assigneeId);
      const refused = refusal(name, test?.state ?? null, actor.roles, facts);
      if (refused) refuse(REFUSAL_STATUS[refused.kind], refused.message);
      if (step.signs) await reauthenticate(db, actor, body.signature!.password, name);

      const testId = test?.id ?? randomUUID();
      await scope.write(name, step.role, async (q) => {
        if (test) {
          const moved = await q.update('test').set({ state: step.to })
            .where('id', '=', testId).where('state', '=', test.state).executeTakeFirstOrThrow();
          if (!moved.numUpdatedRows) refuse(409, 'the Test has moved on; reload it');
        }
        await effect.write(q, actor, testId, body.input);
        if (step.signs) await sign(q, actor, step.signs, effect.signedRecord ?? 'test', testId);
      });
      return { testId, state: step.to };
    });
}

/** `POST /api/steps/:step`, one route per registry entry so each body is validated against its own schema. */
export function stepRoutes(app: FastifyInstance, db: Kysely<DB>): void {
  for (const name of stepNames) stepRoute(app, db, name);
}
