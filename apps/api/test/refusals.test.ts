import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import {
  type RefusalBody,
  refusalBody,
  type Route,
  routes,
  type StepBody,
  type StepName,
  stepNames,
  stepRoute,
} from '@lims/domain';
import type { Static, TObject } from 'typebox';
import { Value } from 'typebox/value';
import { type Account, type Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_refusals_test');
const cora = api.person('cora');
const as = {
  cora: await api.login(cora),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
};

type BodyRouteName = {
  [K in keyof typeof routes]: (typeof routes)[K]['schema'] extends { body: TObject } ? K : never;
}[keyof typeof routes];
const entry = <R extends Route & { schema: { body: TObject } }>(route: R, body: Static<R['schema']['body']>) => ({
  route,
  body,
});
const step = <K extends StepName>(name: K, body: StepBody<K>) => ({ route: stepRoute(name), body });

const testId = randomUUID();
const signature = {
  username: 'unused',
  password: 'unused',
  recordVersion: { version: 1, contentHash: '0'.repeat(64) },
  statementVersion: 1,
};
const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};
const posts: { [K in BodyRouteName]: { route: Route; body: object } } & {
  [K in StepName]: { route: Route; body: StepBody<K> };
} = {
  login: entry(routes.login, { username: cora.username, password: 'not-the-password' }),
  enrolAuthenticator: entry(routes.enrolAuthenticator, { username: cora.username, password: 'not-the-password' }),
  switchLab: entry(routes.switchLab, { username: cora.username, password: 'not-the-password', labId: api.labId }),
  verifyAuditTrail: entry(routes.verifyAuditTrail, {}),
  recomputeAuditTrail: entry(routes.recomputeAuditTrail, {}),
  setPreferences: entry(routes.setPreferences, { reducedMotion: true }),
  auditExport: entry(routes.auditExport, { customerId: randomUUID(), format: 'JSON' }),
  submit: step('submit', {
    commitKey: randomUUID(),
    input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
  }),
  receive: step('receive', { commitKey: randomUUID(), testId, input: {} }),
  assign: step('assign', { commitKey: randomUUID(), testId, input: { assigneeId: randomUUID() } }),
  enterResult: step('enterResult', { commitKey: randomUUID(), testId, input: result, signature }),
  review: step('review', { commitKey: randomUUID(), testId, input: {}, signature }),
  release: step('release', { commitKey: randomUUID(), testId, input: {}, signature }),
  recordIdentityVerification: entry(routes.recordIdentityVerification, {
    printedName: 'Nell Newcomer',
    evidence: 'Passport seen in person (fictional)',
  }),
  createAccount: entry(routes.createAccount, { identityVerificationId: randomUUID(), username: 'nell.newcomer' }),
  issueLink: entry(routes.issueLink, { personId: randomUUID() }),
  issueEnrolmentGrant: entry(routes.issueEnrolmentGrant, { personId: randomUUID() }),
  grantMembership: entry(routes.grantMembership, { personId: randomUUID(), role: 'Analyst', reason: 'New starter' }),
  changePrintedName: entry(routes.changePrintedName, {
    personId: randomUUID(),
    printedName: 'Nell Newcomer-Smith',
    reason: 'Marriage',
  }),
  setPasswordThroughLink: entry(routes.setPasswordThroughLink, { token: 'not-a-link', password: 'unused' }),
  registerWorkstation: entry(routes.registerWorkstation, {
    name: 'RD-BENCH-99',
    roomId: randomUUID(),
    browserPolicy: 'Managed Chrome',
    reason: 'Register a bench PC',
  }),
  registerRoom: entry(routes.registerRoom, { name: 'Balance Room (fictional)', reason: 'Register a Room' }),
  enrolWorkstation: entry(routes.enrolWorkstation, { workstationId: randomUUID(), reason: 'Enrol the bench PC' }),
  unlock: entry(routes.unlock, { password: 'not-the-password' }),
  changePassword: entry(routes.changePassword, { password: 'not-the-password', newPassword: 'Benchline-2026-unused' }),
  createDocument: entry(routes.createDocument, {
    documentType: 'SOP',
    title: 'Receiving',
    body: 'Check the seal.',
    effectiveDate: '2099-01-01',
  }),
  lock: entry(routes.lock, {}),
  logout: entry(routes.logout, {}),
};

async function raw(
  path: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(api.base + path, { ...init, headers: { cookie: as.cora.cookie, ...init.headers } });
  return { status: res.status, body: await res.json() };
}

const refusalIn = (body: unknown): RefusalBody =>
  Value.Check(refusalBody, body) ? body : assert.fail(`not a refusal body: ${JSON.stringify(body)}`);

async function counts() {
  const count = async (table: 'auditEntry' | 'submission' | 'test' | 'signature') =>
    (
      await api.superuser
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n;
  return {
    auditEntries: await count('auditEntry'),
    submissions: await count('submission'),
    tests: await count('test'),
    signatures: await count('signature'),
  };
}

async function assignedTo(analyst: Account): Promise<string> {
  const { testId: id } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { commitKey: randomUUID(), testId: id, input: {} }));
  ok(
    await as.lena.call(stepRoute('assign'), { commitKey: randomUUID(), testId: id, input: { assigneeId: analyst.id } }),
  );
  return id;
}

it('every route that takes a body refuses a field its schema does not name with unknownField', async () => {
  const client: Client = await api.login(cora);
  assert.deepEqual(
    Object.values(posts)
      .map((p) => p.route.url)
      .sort(),
    [
      ...Object.values(routes)
        .filter((r) => r.method === 'POST')
        .map((r) => r.url),
      ...stepNames.map((name) => stepRoute(name).url),
    ].sort(),
    'the table covers every POST route and every step',
  );
  for (const name of stepNames) {
    const { route, body } = posts[name];
    const refused = await client.send(route, { ...body, input: { ...body.input, extra: 1 } });
    assert.equal(refusedWith(refused, 'unknownField'), 'The LIMS does not know the field input.extra.', name);
  }
  for (const [name, { route, body }] of Object.entries(posts)) {
    // Each route gets its own session: lock and logout end what the next route's hook would read before the body.
    const client = await api.login(cora);
    const refused = await client.send(route, { ...body, extra: 1 });
    assert.equal(refusedWith(refused, 'unknownField'), 'The LIMS does not know the field extra.', name);
    const control = await client.send(route, body);
    assert.ok(
      control.kind === 'reply' || !['unknownField', 'malformed'].includes(control.body.kind),
      `${name}: the body is well formed apart from the extra field, got ${JSON.stringify(control)}`,
    );
  }
});

it('a body with an unknown field and a missing required field is refused for the unknown field', async () => {
  const refused = await as.cora.send(stepRoute('receive'), { commitKey: randomUUID(), input: {}, extra: 1 });
  assert.equal(refusedWith(refused, 'unknownField'), 'The LIMS does not know the field extra.');
});

it('a step whose input names an unknown field is refused and writes no row and no Audit Trail entry', async () => {
  const before = await counts();
  const { body } = posts.submit;
  const refused = await as.cora.send(posts.submit.route, { ...body, input: { ...body.input, extra: 1 } });
  assert.equal(refusedWith(refused, 'unknownField'), 'The LIMS does not know the field input.extra.');
  assert.deepEqual(await counts(), before);
});

it('a signing step with the right password and an unknown field in the signature signs nothing and counts no failure', async () => {
  const lou = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
  const id = await assignedTo(lou);
  const client = await api.login(lou);
  const before = await counts();
  const refused = await client.send(stepRoute('enterResult'), {
    commitKey: randomUUID(),
    testId: id,
    input: result,
    signature: { ...(await signatureOf(client, id, lou)), extra: 1 },
  });
  assert.equal(refusedWith(refused, 'unknownField'), 'The LIMS does not know the field signature.extra.');
  assert.deepEqual(await counts(), before, 'no Signature, no Result and no Audit Trail entry');
  const person = await api.superuser
    .selectFrom('person')
    .select(['failedLogins', 'lockedAt'])
    .where('id', '=', lou.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(person, { failedLogins: 0, lockedAt: null }, 'the password was never checked');
  assert.equal(ok(await client.call(routes.test, { id })).test.state, 'Assigned');
});

it('unparseable JSON and a missing required field are refused as malformed, an unknown route as not found, and a non-JSON body still carries a kind', async () => {
  const json = { 'content-type': 'application/json' };
  const unparseable = await raw(stepRoute('submit').url, { method: 'POST', headers: json, body: '{' });
  assert.equal(unparseable.status, 400);
  assert.equal(refusalIn(unparseable.body).kind, 'malformed');

  const missing = await as.cora.send(stepRoute('receive'), { commitKey: randomUUID(), input: {} });
  assert.equal(
    refusedWith(missing, 'malformed'),
    "The LIMS cannot read this request: body must have required property 'testId'.",
  );

  const unknownRoute = await raw('/api/no-such-route', { method: 'GET' });
  assert.deepEqual(unknownRoute, { status: 404, body: { kind: 'notFound', message: 'The LIMS has no such route.' } });

  const text = await raw(stepRoute('submit').url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'x',
  });
  assert.equal(text.status, 400);
  assert.equal(refusalIn(text.body).kind, 'malformed');
});
