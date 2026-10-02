import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited } from '@lims/db';
import { hashPassword } from '@lims/db/credentials';
import { numberedKinds, routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_numbers_test');
const [cora, samir, lena, ana, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('rui'),
  api.person('quinn'),
];
const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
};
const { year } =
  (await sql<{ year: string }>`select to_char(now() at time zone 'America/New_York', 'YYYY') as year`.execute(api.db))
    .rows[0] ?? assert.fail('the database has a clock');

async function submit(client: Client, methodId = api.methodId) {
  return client.call(stepRoute('submit'), {
    commitKey: randomUUID(),
    input: { methodId, description: 'Metformin HCl tablets (fictional)' },
  });
}

async function numbersOf(testId: string) {
  return api.db
    .selectFrom('test')
    .innerJoin('sample', 'sample.id', 'test.sampleId')
    .innerJoin('submission', 'submission.id', 'sample.submissionId')
    .select(['submission.number as submission', 'sample.number as sample'])
    .where('test.id', '=', testId)
    .executeTakeFirstOrThrow();
}

const seqOf = (number: string) => Number(number.slice(-6));

it('two Submissions in a row get consecutive SUB numbers, and their Samples consecutive Lab numbers', async () => {
  const first = await numbersOf(ok(await submit(as.cora)).testId);
  const second = await numbersOf(ok(await submit(as.cora)).testId);
  assert.match(first.submission, new RegExp(`^SUB-${year}-\\d{6}$`));
  assert.match(first.sample, new RegExp(`^RD-S-${year}-\\d{6}$`));
  assert.equal(seqOf(second.submission), seqOf(first.submission) + 1);
  assert.equal(seqOf(second.sample), seqOf(first.sample) + 1);
  assert.equal(second.sample, `RD-S-${year}-${String(seqOf(first.sample) + 1).padStart(6, '0')}`);
});

it('two Labs number their Samples independently, each with its own Lab code', async () => {
  const customerId =
    (await api.db.selectFrom('person').select('customerId').where('id', '=', cora.id).executeTakeFirstOrThrow())
      .customerId ?? assert.fail('Cora is a Customer User');
  const password = 'quincy-password-for-tests';
  await audited(
    api.db,
    { actor: 'svc:test', role: 'system', reason: 'Add a Customer User of the second Lab' },
    async (tx) => {
      const { id: personId } = await tx
        .insertInto('person')
        .values({
          username: 'quincy.qc-customer',
          displayName: 'Quincy',
          customerId,
          passwordHash: await hashPassword(password),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ labId: api.qcLabId, personId, role: 'Customer' }).execute();
    },
  );
  const quincy = await api.login({ id: '', username: 'quincy.qc-customer', password }, api.qcLabId);

  const rd = await numbersOf(ok(await submit(as.cora)).testId);
  const qcFirst = await numbersOf(ok(await submit(quincy)).testId);
  const qcSecond = await numbersOf(ok(await submit(quincy)).testId);
  const rdNext = await numbersOf(ok(await submit(as.cora)).testId);
  assert.deepEqual(
    [qcFirst.sample, qcSecond.sample],
    [`QC-S-${year}-000001`, `QC-S-${year}-000002`],
    "the new Lab's counter starts at one",
  );
  assert.equal(seqOf(rdNext.sample), seqOf(rd.sample) + 1, "the other Lab's Samples do not move RD's counter");
  assert.deepEqual(
    [rd, qcFirst, qcSecond, rdNext].map((n) => seqOf(n.submission) - seqOf(rd.submission)),
    [0, 1, 2, 3],
    'Submissions share one company-wide counter',
  );
});

it('a Test Report Draft is numbered RD-R with the year and six digits when it is created', async () => {
  const { testId } = ok(await submit(as.cora));
  const step = (
    name: 'receive' | 'assign' | 'enterResult' | 'review' | 'release',
    client: Client,
    input = {},
    password?: string,
  ) =>
    client.call(stepRoute(name), {
      commitKey: randomUUID(),
      testId,
      input,
      ...(password && { signature: { password } }),
    });
  ok(await step('receive', as.samir));
  ok(await step('assign', as.lena, { assigneeId: ana.id }));
  ok(
    await step(
      'enterResult',
      as.ana,
      {
        analyte: 'NDMA',
        value: '0.0300',
        unit: 'ppm',
        injectionSequenceRef: 'SEQ-2026-0042',
        notebookRef: 'NB-RD-0001-012',
        performedOn: '2026-09-30',
      },
      ana.password,
    ),
  );
  ok(await step('review', as.rui, {}, rui.password));
  ok(await step('release', as.quinn, {}, quinn.password));
  assert.equal(ok(await as.cora.call(routes.report, { id: testId })).report.number, `RD-R-${year}-000001`);
});

it('a submit that rolls back after taking its numbers gives them to the next kept Submission', async () => {
  const kept = await numbersOf(ok(await submit(as.cora)).testId);
  const failed = await submit(as.cora, randomUUID());
  assert.equal(failed.status, 500, 'a Method that does not exist fails the submit after its numbers were taken');
  const next = await numbersOf(ok(await submit(as.cora)).testId);
  assert.equal(seqOf(next.submission), seqOf(kept.submission) + 1);
  assert.equal(seqOf(next.sample), seqOf(kept.sample) + 1);
});

it('Submissions made at the same moment get distinct, consecutive numbers', async () => {
  const taken = await Promise.all([1, 2, 3, 4].map(async () => numbersOf(ok(await submit(as.cora)).testId)));
  const samples = taken.map((n) => seqOf(n.sample)).sort((a, b) => a - b);
  const submissions = taken.map((n) => seqOf(n.submission)).sort((a, b) => a - b);
  const [first = 0] = samples;
  assert.deepEqual(samples, [first, first + 1, first + 2, first + 3]);
  assert.equal(new Set(submissions).size, 4);
  assert.equal((submissions.at(-1) ?? 0) - (submissions[0] ?? 0), 3);
});

it('the kinds the domain formats are the kinds the database counts', async () => {
  const { rows } = await sql<{
    kind: string;
  }>`select unnest(enum_range(null::lims.numbered_kind))::text as kind`.execute(api.db);
  assert.deepEqual(
    rows.map((r) => r.kind),
    [...numberedKinds],
  );
});
