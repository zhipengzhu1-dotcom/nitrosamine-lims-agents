import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audited } from '@lims/db';
import { sql } from 'kysely';
import { routes, type StepInput, type StepName, stepNames, stepRoute, steps } from '@lims/domain';
import { labScope } from '../src/scope.ts';
import { type Account, type Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_steps_test');
const [cora, samir, lena, ana, theo, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('theo'),
  api.person('rui'),
  api.person('quinn'),
];
const customerId =
  (await api.db.selectFrom('person').select('customerId').where('id', '=', cora.id).executeTakeFirstOrThrow())
    .customerId ?? assert.fail('Cora is a Customer User');
const otherCustomer = await audited(
  api.db,
  { actor: 'svc:test', role: 'system', reason: 'Add a second Customer' },
  (tx) =>
    tx.insertInto('customer').values({ name: 'Second Customer (fictional)' }).returning('id').executeTakeFirstOrThrow(),
);
const dana = await api.addPerson('dana.analyst-reviewer', ['Analyst', 'Reviewer'], { trained: true });
const rhea = await api.addPerson('rhea.reviewer-qa', ['Reviewer', 'QA']);
const wes = await api.addPerson('wes.analyst', ['Analyst'], { trained: true });
const olga = await api.addPerson('olga.other-customer', ['Customer'], { customerId: otherCustomer.id });

const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  dana: await api.login(dana),
  rhea: await api.login(rhea),
  wes: await api.login(wes),
  olga: await api.login(olga),
};

const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName> = {}, signer?: Account) {
  const signature = signer && { password: signer.password };
  return client.call(stepRoute(name), { commitKey: randomUUID(), testId, input, ...(signature && { signature }) });
}

async function submitTestTo(state: 'Requested' | 'Ready' | 'Assigned', analyst: Account = ana): Promise<string> {
  const { testId: id } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  if (state !== 'Requested') assert.equal((await take(as.samir, 'receive', id)).status, 200);
  if (state === 'Assigned') assert.equal((await take(as.lena, 'assign', id, { assigneeId: analyst.id })).status, 200);
  return id;
}

const view = async (id: string, client = as.lena) => ok(await client.call(routes.test, { id }));

it('the chain walks a submitted Test to Reported with three Signatures and an audit entry for every step', async () => {
  const id = await submitTestTo('Assigned');
  assert.equal((await take(as.ana, 'enterResult', id, result, ana)).status, 200);
  assert.equal((await take(as.rui, 'review', id, {}, rui)).status, 200);
  assert.equal(
    refusedWith(await as.cora.call(routes.report, { id }), 'notFound'),
    'this Test has no released Test Report',
    'no Test Report for the Customer before release',
  );
  assert.equal((await take(as.quinn, 'release', id, {}, quinn)).status, 200);

  const reported = await view(id, as.quinn);
  assert.equal(reported.test.state, 'Reported');
  assert.equal(reported.result?.value, '0.0300', 'the Result as typed');
  assert.equal(
    reported.auditTrail.find((e) => e.table === 'result')?.newRow?.value,
    '0.0300',
    'the Audit Trail keeps the Result as typed',
  );
  const testInsert = reported.auditTrail.find((e) => e.table === 'test' && e.op === 'INSERT')?.newRow;
  assert.deepEqual(
    Object.keys(testInsert ?? {}).sort(),
    ['assignee_id', 'gxp_class', 'id', 'lab_id', 'method_id', 'sample_id', 'state'],
    'the Audit Trail shows each row snapshot under its stored column names',
  );
  assert.deepEqual(
    reported.signatures.map((s) => [s.meaning, s.signer, s.record]),
    [
      ['Performed', 'Ana Ferreira', 'test'],
      ['Reviewed', 'Rui Tanaka', 'test'],
      ['Released', 'Quinn Adeyemi', 'test_report'],
    ],
  );
  const actors = {
    submit: cora,
    receive: samir,
    assign: lena,
    enterResult: ana,
    review: rui,
    release: quinn,
  } satisfies {
    [K in StepName]: Account;
  };
  for (const name of stepNames) {
    const entries = reported.auditTrail.filter((e) => e.reason === name);
    assert.ok(entries.length > 0, `an audit entry for ${name}`);
    for (const e of entries)
      assert.deepEqual([e.actor, e.role], [`person:${actors[name].username}`, steps[name].role], name);
  }

  const report = ok(await as.cora.call(routes.report, { id }));
  assert.match(report.report.number, /^RD-R\d{5}$/);
  const printed = report.test;
  const signed = await api.db
    .selectFrom('signature')
    .select('content')
    .where((eb) =>
      eb.or([
        eb('recordId', '=', id),
        eb('recordId', 'in', eb.selectFrom('testReport').select('id').where('testId', '=', id)),
      ]),
    )
    .execute();
  assert.equal(signed.length, 3);
  for (const { content } of signed) {
    const version = JSON.parse(content.toString());
    assert.deepEqual(
      Object.keys(version),
      [
        'id',
        'customer',
        'sample',
        'description',
        'receivedAt',
        'method',
        'methodVersion',
        'methodTitle',
        'gxpClass',
        'analyte',
        'value',
        'unit',
        'injectionSequenceRef',
        'notebookRef',
        'performedOn',
        'report',
      ],
      'each signed Record Version names its fields in one fixed order',
    );
    assert.deepEqual(
      [version.customer, version.description, version.receivedAt, version.methodTitle],
      [printed.customer, printed.description, printed.receivedAt, printed.methodTitle],
      'each Signature covers what the Test Report prints',
    );
  }
  const verified = ok(await as.quinn.call(routes.verifyAuditTrail));
  assert.deepEqual([verified.lab, verified.company], [null, null]);
  const { recent } = await api.db
    .selectNoFrom(sql<boolean>`${verified.at}::timestamptz between now() - interval '1 minute' and now()`.as('recent'))
    .executeTakeFirstOrThrow();
  assert.ok(recent, 'the server states when it checked, by the database clock');
});

it('a step by the wrong role is refused', async () => {
  const id = await submitTestTo('Requested');
  assert.equal(refusedWith(await take(as.cora, 'receive', id), 'role'), 'receive is taken by the SampleCustodian role');
  refusedWith(await take(as.ana, 'receive', id), 'role');
  assert.equal((await view(id)).test.state, 'Requested');
});

it('assigning an Analyst without a Training Record for the Method is refused', async () => {
  const id = await submitTestTo('Ready');
  const refused = await take(as.lena, 'assign', id, { assigneeId: theo.id });
  assert.match(refusedWith(refused, 'guard'), /Training Record/);
  const after = await view(id);
  assert.deepEqual([after.test.state, after.test.assignee], ['Ready', null]);
});

it('the Analyst who signed Performed cannot review, and the Reviewer who reviewed cannot release', async () => {
  const id = await submitTestTo('Assigned', dana);
  assert.equal((await take(as.dana, 'enterResult', id, result, dana)).status, 200);
  assert.equal((await view(id, as.dana)).next, null, 'review is not offered to the Analyst who performed it');
  const anySignature = { password: 'unused' };
  const selfReview = await as.dana.call(stepRoute('review'), {
    commitKey: randomUUID(),
    testId: id,
    input: {},
    signature: anySignature,
  });
  assert.equal(refusedWith(selfReview, 'guard'), 'the Analyst who performed the Test cannot review it');

  assert.equal((await take(as.rhea, 'review', id, {}, rhea)).status, 200);
  const selfRelease = await as.rhea.call(stepRoute('release'), {
    commitKey: randomUUID(),
    testId: id,
    input: {},
    signature: anySignature,
  });
  refusedWith(selfRelease, 'guard');
  assert.equal((await view(id)).test.state, 'Reviewed');
});

it('a signing with a wrong password is refused and changes nothing, and a signing on an ended session is refused by another kind', async () => {
  const id = await submitTestTo('Assigned', wes);
  const before = await view(id);
  const enter = (password: string) =>
    as.wes.call(stepRoute('enterResult'), {
      commitKey: randomUUID(),
      testId: id,
      input: result,
      signature: { password },
    });

  assert.equal(refusedWith(await enter('not-the-password'), 'badCredentials'), 'the credentials are not valid');
  assert.deepEqual(
    await view(id),
    before,
    'a wrong password leaves the Test, Result, Signatures and Audit Trail as they were',
  );
  assert.equal((await enter(wes.password)).status, 200);

  ok(await as.wes.call(routes.logout));
  assert.equal(refusedWith(await enter(wes.password), 'noSession'), 'sign in first');
});

it("a Customer User cannot read another Customer's Test", async () => {
  const id = await submitTestTo('Requested');
  assert.ok(ok(await as.cora.call(routes.tests)).some((t) => t.id === id));
  refusedWith(await as.olga.call(routes.test, { id }), 'notFound');
  refusedWith(await as.olga.call(routes.report, { id }), 'notFound');
  assert.ok(!ok(await as.olga.call(routes.tests)).some((t) => t.id === id));
});

it("a query without the context's Lab fails, and another Lab's Test is out of reach", async () => {
  const ctx = ok(await as.lena.call(routes.me));
  assert.throws(() => labScope(api.db, { ...ctx, lab: { id: '', code: '', name: '' } }), /needs the Lab/);

  const otherTest = await audited(
    api.db,
    { actor: 'svc:test', role: 'system', reason: 'Add a second Lab' },
    async (tx) => {
      const { labId } = await tx
        .insertInto('lab')
        .values({ code: 'OT', name: 'Other Lab' })
        .returning('labId')
        .executeTakeFirstOrThrow();
      const submission = await tx
        .insertInto('submission')
        .values({ customerId, submittedBy: cora.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await tx
        .insertInto('sample')
        .values({ labId, submissionId: submission.id, number: 'OT-S00001', description: 'x' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (
        await tx
          .insertInto('test')
          .values({ labId, sampleId: sample.id, methodId: api.methodId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    },
  );
  refusedWith(await as.lena.call(routes.test, { id: otherTest }), 'notFound');
  refusedWith(await take(as.samir, 'receive', otherTest), 'notFound');
  assert.ok(!ok(await as.lena.call(routes.tests)).some((t) => t.id === otherTest));
});

it('a Test leaves the API with only the fields a Test row declares', async () => {
  const id = await submitTestTo('Assigned');
  const declared = Object.keys(routes.tests.schema.response[200].items.properties).sort();
  const listed = ok(await as.lena.call(routes.tests)).find((t) => t.id === id) ?? assert.fail('the Test is listed');
  assert.deepEqual(Object.keys(listed).sort(), declared, 'GET /api/tests');
  assert.deepEqual(Object.keys((await view(id)).test).sort(), declared, 'GET /api/tests/:id');
});
