import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audited } from '@lims/db';
import { type StepName, stepNames, steps } from '@lims/domain';
import { labScope } from '../src/scope.ts';
import { type Account, type Client, startApi } from './harness.ts';

const api = await startApi('lims_api_steps_test');
const { cora, samir, lena, ana, theo, rui, quinn } = api.people as Record<string, Account>;
const customerId = (await api.db.selectFrom('person').select('customer_id').where('id', '=', cora!.id).executeTakeFirstOrThrow()).customer_id!;
const otherCustomer = await audited(api.db, { actor: 'svc:test', role: 'system', reason: 'Add a second Customer' }, (tx) =>
  tx.insertInto('customer').values({ name: 'Second Customer (fictional)' }).returning('id').executeTakeFirstOrThrow());
const dana = await api.addPerson('dana.analyst-reviewer', ['Analyst', 'Reviewer'], { trained: true });
const rhea = await api.addPerson('rhea.reviewer-qa', ['Reviewer', 'QA']);
const wes = await api.addPerson('wes.analyst', ['Analyst'], { trained: true });
const olga = await api.addPerson('olga.other-customer', ['Customer'], { customerId: otherCustomer.id });

const as: Record<string, Client> = {};
for (const [name, account] of Object.entries({ cora, samir, lena, ana, rui, quinn, dana, rhea, wes, olga })) as[name] = await api.login(account!);

const result = {
  analyte: 'NDMA', value: '0.0300', unit: 'ppm', injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012', performedOn: '2026-09-30',
};

async function take(client: Client, name: StepName, testId: string, input: object = {}, signer?: Account) {
  const signature = signer && { password: signer.password };
  return client.post(`/api/steps/${name}`, { testId, input, ...(signature && { signature }) });
}

async function testIn(state: 'Requested' | 'Ready' | 'Assigned', analyst: Account = ana!): Promise<string> {
  const submitted = await as.cora!.post('/api/steps/submit', { input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' } });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const id: string = submitted.body.testId;
  if (state !== 'Requested') assert.equal((await take(as.samir!, 'receive', id)).status, 200);
  if (state === 'Assigned') assert.equal((await take(as.lena!, 'assign', id, { assigneeId: analyst.id })).status, 200);
  return id;
}

const view = async (id: string, client = as.lena!) => (await client.get(`/api/tests/${id}`)).body;

test('the chain walks a submitted Test to Reported with three Signatures and an audit entry for every step', async () => {
  const id = await testIn('Assigned');
  assert.equal((await take(as.ana!, 'enterResult', id, result, ana)).status, 200);
  assert.equal((await take(as.rui!, 'review', id, {}, rui)).status, 200);
  assert.equal((await as.cora!.get(`/api/tests/${id}/report`)).status, 404, 'no Test Report for the Customer before release');
  assert.equal((await take(as.quinn!, 'release', id, {}, quinn)).status, 200);

  const reported = await view(id, as.quinn);
  assert.equal(reported.test.state, 'Reported');
  assert.equal(reported.result.value, '0.0300', 'the Result as typed');
  assert.equal(reported.auditTrail.find((e: any) => e.table === 'result').newRow.value, '0.0300', 'the Audit Trail keeps the Result as typed');
  assert.deepEqual(reported.signatures.map((s: any) => [s.meaning, s.signer]),
    [['Performed', 'Ana Ferreira'], ['Reviewed', 'Rui Tanaka'], ['Released', 'Quinn Adeyemi']]);
  const actors = { submit: cora, receive: samir, assign: lena, enterResult: ana, review: rui, release: quinn };
  for (const name of stepNames) {
    const entries = reported.auditTrail.filter((e: any) => e.reason === name);
    assert.ok(entries.length > 0, `an audit entry for ${name}`);
    for (const e of entries) assert.deepEqual([e.actor, e.role], [`person:${actors[name]!.username}`, steps[name].role], name);
  }

  const report = await as.cora!.get(`/api/tests/${id}/report`);
  assert.equal(report.status, 200);
  assert.match(report.body.report.number, /^RD-R\d{5}$/);
  assert.deepEqual((await as.quinn!.post('/api/audit/verify')).body, { lab: null, company: null });
});

test('a step by the wrong role is refused', async () => {
  const id = await testIn('Requested');
  assert.equal((await take(as.cora!, 'receive', id)).status, 403);
  assert.equal((await take(as.ana!, 'receive', id)).status, 403);
  assert.equal((await view(id)).test.state, 'Requested');
});

test('assigning an Analyst without a Training Record for the Method is refused', async () => {
  const id = await testIn('Ready');
  const refused = await take(as.lena!, 'assign', id, { assigneeId: theo!.id });
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /Training Record/);
  const after = await view(id);
  assert.deepEqual([after.test.state, after.test.assignee_id], ['Ready', null]);
});

test('the Analyst who signed Performed cannot review, and the Reviewer who reviewed cannot release', async () => {
  const id = await testIn('Assigned', dana);
  assert.equal((await take(as.dana!, 'enterResult', id, result, dana)).status, 200);
  assert.equal((await view(id, as.dana)).next, null, 'review is not offered to the Analyst who performed it');
  const anySignature = { password: 'unused' };
  const selfReview = await as.dana!.post('/api/steps/review', { testId: id, input: {}, signature: anySignature });
  assert.deepEqual([selfReview.status, selfReview.body.message], [403, 'the Analyst who performed the Test cannot review it']);

  assert.equal((await take(as.rhea!, 'review', id, {}, rhea)).status, 200);
  const selfRelease = await as.rhea!.post('/api/steps/release', { testId: id, input: {}, signature: anySignature });
  assert.equal(selfRelease.status, 403);
  assert.equal((await view(id)).test.state, 'Reviewed');
});

test('a signing with a wrong password is refused and changes nothing', async () => {
  const id = await testIn('Assigned', wes);
  const before = await view(id);
  const enter = (password: string) => as.wes!.post('/api/steps/enterResult', { testId: id, input: result, signature: { password } });

  assert.equal((await enter('not-the-password')).status, 401);
  assert.deepEqual(await view(id), before, 'a wrong password leaves the Test, Result, Signatures and Audit Trail as they were');
  assert.equal((await enter(wes.password)).status, 200);
});

test('a Customer User cannot read another Customer\'s Test', async () => {
  const id = await testIn('Requested');
  assert.ok((await as.cora!.get('/api/tests')).body.some((t: any) => t.id === id));
  assert.equal((await as.olga!.get(`/api/tests/${id}`)).status, 404);
  assert.equal((await as.olga!.get(`/api/tests/${id}/report`)).status, 404);
  assert.ok(!(await as.olga!.get('/api/tests')).body.some((t: any) => t.id === id));
});

test('a query without the context\'s Lab fails, and another Lab\'s Test is out of reach', async () => {
  const ctx = (await as.lena!.get('/api/me')).body;
  assert.throws(() => labScope(api.db, { ...ctx, lab: { id: '', code: '', name: '' } }), /needs the Lab/);

  const otherTest = await audited(api.db, { actor: 'svc:test', role: 'system', reason: 'Add a second Lab' }, async (tx) => {
    const { lab_id } = await tx.insertInto('lab').values({ code: 'OT', name: 'Other Lab' }).returning('lab_id').executeTakeFirstOrThrow();
    const submission = await tx.insertInto('submission').values({ customer_id: customerId, submitted_by: cora!.id })
      .returning('id').executeTakeFirstOrThrow();
    const sample = await tx.insertInto('sample').values({ lab_id, submission_id: submission.id, number: 'OT-S00001', description: 'x' })
      .returning('id').executeTakeFirstOrThrow();
    return (await tx.insertInto('test').values({ lab_id, sample_id: sample.id, method_id: api.methodId })
      .returning('id').executeTakeFirstOrThrow()).id;
  });
  assert.equal((await as.lena!.get(`/api/tests/${otherTest}`)).status, 404);
  assert.equal((await take(as.samir!, 'receive', otherTest)).status, 404);
  assert.ok(!(await as.lena!.get('/api/tests')).body.some((t: any) => t.id === otherTest));
});
