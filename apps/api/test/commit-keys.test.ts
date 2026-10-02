import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { type StepBody, type StepName, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_commit_keys_test');
const [cora, samir, lena, ana] = [api.person('cora'), api.person('samir'), api.person('lena'), api.person('ana')];
const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
};

const submission = { input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' } };
const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};

const post = <K extends StepName>(client: Client, name: K, body: StepBody<K>) => client.send(stepRoute(name), body);

async function assigned(): Promise<string> {
  const { testId } = ok(await post(as.cora, 'submit', { commitKey: randomUUID(), ...submission }));
  ok(await post(as.samir, 'receive', { commitKey: randomUUID(), testId, input: {} }));
  ok(await post(as.lena, 'assign', { commitKey: randomUUID(), testId, input: { assigneeId: ana.id } }));
  return testId;
}

const enterResult = (commitKey: string, testId: string, password = ana.password) =>
  post(as.ana, 'enterResult', { commitKey, testId, input: result, signature: { password } });

async function writtenBy(testId: string) {
  const db = api.superuser;
  const entries = await db
    .selectFrom('auditEntry')
    .select(['tableName', 'op'])
    .where('reason', '=', 'enterResult')
    .where(
      sql<boolean>`coalesce(new_row ->> 'test_id', new_row ->> 'record_id', new_row ->> 'id') = ${testId}
        or new_row ->> 'record_version_id' in (select id::text from lims.record_version where record_id = ${testId})`,
    )
    .execute();
  const signatures = await db
    .selectFrom('signature')
    .innerJoin('recordVersion', 'recordVersion.id', 'signature.recordVersionId')
    .select('signature.meaning')
    .where('recordVersion.recordId', '=', testId)
    .execute();
  return {
    stateMoves: entries.filter((e) => e.tableName === 'test' && e.op === 'UPDATE').length,
    signatures: signatures.map((s) => s.meaning),
    auditEntries: entries.map((e) => `${e.op} ${e.tableName}`).sort(),
  };
}

const countOf = async (table: 'submission' | 'test' | 'commitKey' | 'auditEntry') =>
  Number(
    (
      await api.superuser
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
const totals = async () => ({
  submissions: await countOf('submission'),
  tests: await countOf('test'),
  commitKeys: await countOf('commitKey'),
  auditEntries: await countOf('auditEntry'),
});

const once = {
  stateMoves: 1,
  signatures: ['Performed'],
  auditEntries: ['INSERT record_version', 'INSERT result', 'INSERT signature', 'UPDATE test'],
};

it('a signing step sent twice with the same Commit Key answers the first receipt and commits once', async () => {
  const testId = await assigned();
  const key = randomUUID();
  const first = ok(await enterResult(key, testId));
  const retry = ok(await enterResult(key, testId));
  assert.deepEqual(retry, first, 'the retry gets the identical receipt');
  assert.deepEqual(first, { testId, state: 'SubmittedForReview' });
  assert.deepEqual(await writtenBy(testId), once, 'one state move, one Signature, one Audit Trail entry per row');
  assert.ok(
    api.logLines().some((line) => line.msg === 'step replayed' && line.testId === testId),
    'the retry is logged as a replay',
  );
});

it('a Submission sent twice with the same Commit Key creates one Submission and one Test', async () => {
  const key = randomUUID();
  const first = ok(await post(as.cora, 'submit', { commitKey: key, ...submission }));
  const before = await totals();
  const retry = ok(await post(as.cora, 'submit', { commitKey: key, ...submission }));
  assert.deepEqual(retry, first);
  assert.deepEqual(await totals(), before, 'the retry writes nothing');
});

it('a Submission resent with the same entries in another order answers the first receipt and writes nothing', async () => {
  const key = randomUUID();
  const { methodId, description } = submission.input;
  const first = ok(await post(as.cora, 'submit', { commitKey: key, input: { methodId, description } }));
  const before = await totals();
  const retry = ok(await post(as.cora, 'submit', { commitKey: key, input: { description, methodId } }));
  assert.deepEqual(retry, first);
  assert.deepEqual(await totals(), before, 'the retry writes nothing');
});

async function bothWaitingOnLockedTable<T>(table: 'submission' | 'result', presses: () => Promise<T>[]) {
  let answers: Promise<T[]> | undefined;
  await api.superuser.transaction().execute(async (tx) => {
    await sql`lock table ${sql.table(`lims.${table}`)} in exclusive mode`.execute(tx);
    answers = Promise.all(presses());
    await api.untilWaitingOnLocks(2);
  });
  return answers ?? assert.fail('the presses were sent');
}

it('two concurrent Submissions with the same Commit Key commit once and both answer the first receipt', async () => {
  const before = await totals();
  const key = randomUUID();
  const [a, b] = await bothWaitingOnLockedTable('submission', () => [
    post(as.cora, 'submit', { commitKey: key, ...submission }),
    post(as.cora, 'submit', { commitKey: key, ...submission }),
  ]);
  assert.deepEqual(ok(b ?? assert.fail()), ok(a ?? assert.fail()), 'both get the same receipt');
  const after = await totals();
  assert.deepEqual(
    [after.submissions - before.submissions, after.tests - before.tests, after.commitKeys - before.commitKeys],
    [1, 1, 1],
    'one Submission, one Test, one Commit Key',
  );
});

it('two concurrent signing steps with the same Commit Key commit once and both answer the first receipt', async () => {
  const testId = await assigned();
  const key = randomUUID();
  const [a, b] = await bothWaitingOnLockedTable('result', () => [enterResult(key, testId), enterResult(key, testId)]);
  assert.deepEqual(ok(b ?? assert.fail()), ok(a ?? assert.fail()));
  assert.deepEqual(await writtenBy(testId), once);
});

it('a step without a Commit Key is refused as malformed and writes nothing', async () => {
  const before = await totals();
  const refused = await as.cora.send(stepRoute('submit'), submission);
  assert.equal(refusedWith(refused, 'malformed'), "body must have required property 'commitKey'");
  assert.deepEqual(await totals(), before);
});

it("the same Commit Key from another session is refused and does not answer the first session's receipt", async () => {
  const key = randomUUID();
  ok(await post(as.cora, 'submit', { commitKey: key, ...submission }));
  const otherSession = await api.login(cora);
  const before = await totals();
  const refused = await post(otherSession, 'submit', { commitKey: key, ...submission });
  assert.equal(
    refusedWith(refused, 'keyReused'),
    'this press was already saved under another sign-in; reload to see what was saved',
  );
  assert.deepEqual(await totals(), before, 'no second Submission');
});

it('the same Commit Key with other input or for another step is refused as a reused Commit Key and writes nothing', async () => {
  const testId = await assigned();
  const key = randomUUID();
  ok(await enterResult(key, testId));
  const before = await totals();
  const otherValue = await post(as.ana, 'enterResult', {
    commitKey: key,
    testId,
    input: { ...result, value: '0.0310' },
    signature: { password: ana.password },
  });
  refusedWith(otherValue, 'keyReused');
  refusedWith(await post(as.ana, 'submit', { commitKey: key, ...submission }), 'keyReused');
  assert.deepEqual(await totals(), before);
});

it('a refused press leaves its Commit Key unused, so the corrected retry commits', async () => {
  const testId = await assigned();
  const key = randomUUID();
  refusedWith(await enterResult(key, testId, 'not-the-password'), 'badCredentials');
  assert.deepEqual(ok(await enterResult(key, testId)), { testId, state: 'SubmittedForReview' });
  assert.deepEqual(await writtenBy(testId), once);
});

it('a retry of a committed signing step answers its receipt whatever password it carries, and signs nothing', async () => {
  const testId = await assigned();
  const key = randomUUID();
  const first = ok(await enterResult(key, testId));
  assert.deepEqual(ok(await enterResult(key, testId, 'not-the-password')), first);
  assert.deepEqual(await writtenBy(testId), once);
});

it('more concurrent signing presses than the connection pool holds all commit', { timeout: 30_000 }, async () => {
  const tests: string[] = [];
  for (let i = 0; i < 12; i++) tests.push(await assigned());
  const answers = await Promise.all(tests.map((testId) => enterResult(randomUUID(), testId)));
  assert.deepEqual(
    answers.map((answer) => ok(answer).state),
    tests.map(() => 'SubmittedForReview'),
  );
});
