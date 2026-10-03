import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { routes, type StepInput, type StepName, stepRoute } from '@lims/domain';
import { type Account, type Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_review_checklist_none_test');
const [cora, samir, lena, ana, rui] = ['cora', 'samir', 'lena', 'ana', 'rui'] as const;
const as = {
  cora: await api.login(api.person(cora)),
  samir: await api.login(api.person(samir)),
  lena: await api.login(api.person(lena)),
  ana: await api.login(api.person(ana)),
  rui: await api.login(api.person(rui)),
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName>, signer?: Account) {
  const signature = signer && (await signatureOf(client, testId, signer));
  ok(await client.call(stepRoute(name), { commitKey: randomUUID(), testId, input, ...(signature && { signature }) }));
}

it('until QA approves a Test Review Checklist version, the Test view shows none and a Test Review is refused', async () => {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  await take(as.samir, 'receive', testId, {});
  await take(as.lena, 'assign', testId, { assigneeId: api.person(ana).id });
  const result = {
    analyte: 'NDMA',
    value: '0.0300',
    unit: 'ppm',
    injectionSequenceRef: 'SEQ-2026-0042',
    notebookRef: 'NB-RD-0001-012',
    performedOn: '2026-09-30',
  };
  await take(as.ana, 'enterResult', testId, result, api.person(ana));
  const view = ok(await as.rui.call(routes.test, { id: testId }));
  assert.deepEqual([view.test.state, view.checklist], ['SubmittedForReview', null]);
  assert.equal(ok(await as.rui.call(routes.reviewChecklists, { kind: 'Test' })).inForce, null);
  assert.equal(
    refusedWith(await as.rui.call(routes.saveReview, { testId, checklistVersion: 1, ticks: {} }), 'state'),
    'No Test Review Checklist version is approved yet.',
  );
});
