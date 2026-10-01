import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import {
  type RefusalBody,
  refusalBody,
  type Route,
  type RouteInput,
  routes,
  type StepBody,
  type StepName,
  stepNames,
  stepRoute,
} from '@lims/domain';
import type { TObject } from 'typebox';
import { Value } from 'typebox/value';
import { ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_refusals_test');
const cora = api.person('cora');
const as = { cora: await api.login(cora) };

type BodyRouteName = {
  [K in keyof typeof routes]: (typeof routes)[K]['schema'] extends { body: TObject } ? K : never;
}[keyof typeof routes];
const entry = <R extends Route>(route: R, body: RouteInput<R>[0] & object) => ({ route, body });
const step = <K extends StepName>(name: K, body: StepBody<K>) => ({ route: stepRoute(name), body });

const testId = randomUUID();
const signature = { password: 'unused' };
/** One well-formed body per route that takes one. The key type fails to compile when a body route or a step is added and not listed. */
const posts: { [K in BodyRouteName]: { route: Route; body: object } } & {
  [K in StepName]: { route: Route; body: StepBody<K> };
} = {
  login: entry(routes.login, { username: cora.username, password: 'not-the-password' }),
  submit: step('submit', { input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' } }),
  receive: step('receive', { testId, input: {} }),
  assign: step('assign', { testId, input: { assigneeId: randomUUID() } }),
  enterResult: step('enterResult', {
    testId,
    input: {
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0042',
      notebookRef: 'NB-RD-0001-012',
      performedOn: '2026-09-30',
    },
    signature,
  }),
  review: step('review', { testId, input: {}, signature }),
  release: step('release', { testId, input: {}, signature }),
};

async function raw(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(api.base + path, { ...init, headers: { cookie: as.cora.cookie, ...init.headers } });
  return { status: res.status, body: await res.json() };
}

const refusalIn = (body: unknown): RefusalBody =>
  Value.Check(refusalBody, body) ? body : assert.fail(`not a refusal body: ${JSON.stringify(body)}`);

it('every route that takes a body refuses a field its schema does not name with unknownField', async () => {
  const bodyRoutes = Object.values(routes).filter((r) => 'body' in r.schema);
  assert.deepEqual(
    Object.values(posts)
      .map((p) => p.route.url)
      .sort(),
    [...bodyRoutes.map((r) => r.url), ...stepNames.map((name) => stepRoute(name).url)].sort(),
    'the table covers every body route and every step',
  );
  for (const [name, { route, body }] of Object.entries(posts)) {
    const control = await as.cora.send(route, body);
    assert.ok(
      control.kind === 'reply' || !['unknownField', 'malformed'].includes(control.body.kind),
      `${name}: the body is well formed apart from the extra field, got ${JSON.stringify(control)}`,
    );
    const refused = await as.cora.send(route, { ...body, extra: 1 });
    assert.equal(refused.status, 400, name);
    assert.equal(refusedWith(refused, 'unknownField'), 'the LIMS does not know the field extra', name);
  }
  for (const name of stepNames) {
    const { route, body } = posts[name];
    const refused = await as.cora.send(route, { ...body, input: { ...body.input, extra: 1 } });
    assert.equal(refusedWith(refused, 'unknownField'), 'the LIMS does not know the field input.extra', name);
  }
});

it('a step whose input names an unknown field is refused and writes no row and no Audit Trail entry', async () => {
  const counts = async () => {
    const count = async (table: 'auditEntry' | 'submission' | 'test') =>
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
    };
  };
  const before = await counts();
  const { body } = posts.submit;
  const refused = await as.cora.send(posts.submit.route, { ...body, input: { ...body.input, extra: 1 } });
  assert.equal(refusedWith(refused, 'unknownField'), 'the LIMS does not know the field input.extra');
  assert.deepEqual(await counts(), before);
});

it('unparseable JSON and a missing required field are malformed, an unknown route is notFound, and a non-JSON body carries a kind', async () => {
  const json = { 'content-type': 'application/json' };
  const unparseable = await raw(stepRoute('submit').url, { method: 'POST', headers: json, body: '{' });
  assert.equal(unparseable.status, 400);
  assert.equal(refusalIn(unparseable.body).kind, 'malformed');

  const missing = await as.cora.send(stepRoute('receive'), { input: {} });
  assert.equal(missing.status, 400);
  assert.equal(refusedWith(missing, 'malformed'), "body must have required property 'testId'");

  const unknownRoute = await raw('/api/no-such-route', { method: 'GET' });
  assert.deepEqual(unknownRoute, { status: 404, body: { kind: 'notFound', message: 'no such route' } });

  const text = await raw(stepRoute('submit').url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'x',
  });
  assert.equal(text.status, 400);
  assert.equal(refusalIn(text.body).kind, 'malformed');
  ok(await as.cora.call(routes.me));
});
