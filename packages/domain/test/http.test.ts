import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  pathOf,
  pressText,
  readReply,
  type RefusalBody,
  type Route,
  routes,
  type StepName,
  stepNames,
  stepRoute,
} from '../src/index.ts';

const row = {
  id: '8e46be82-9907-4ba5-a8b2-def4f8329bf0',
  state: 'Requested',
  gxpClass: 'GMP',
  sampleNumber: 'RD-S00001',
  description: 'Metformin HCl tablets (fictional)',
  receivedAt: null,
  customer: 'Northwind Generics (fictional)',
  methodCode: 'RD-MTH-0001',
  methodVersion: '1',
  methodTitle: 'NDMA in metformin hydrochloride by LC-MS/MS',
  assignee: null,
};
const refusal: RefusalBody = { kind: 'notFound', message: 'no such Test' };

type Expected = { kind: 'reply' } | { kind: 'refused'; body: RefusalBody } | { kind: 'breach'; problem: RegExp };

describe('readReply tells a reply, a refusal and a breach apart', () => {
  const cases: { name: string; route: Route; status: number; json: unknown; expected: Expected }[] = [
    {
      name: 'a 2xx body that fits the reply schema is a reply',
      route: routes.tests,
      status: 200,
      json: [row],
      expected: { kind: 'reply' },
    },
    {
      name: 'a 4xx body with a kind and a message is refused with both',
      route: routes.test,
      status: 404,
      json: refusal,
      expected: { kind: 'refused', body: refusal },
    },
    {
      name: 'a non-2xx body without a kind is a breach',
      route: routes.test,
      status: 404,
      json: { statusCode: 404, error: 'Not Found', message: 'no such Test' },
      expected: {
        kind: 'breach',
        problem: /^GET \/api\/tests\/:id answered 404 outside its schema at \/: must have required properties kind$/,
      },
    },
    {
      name: 'a non-2xx body with a kind outside the list is a breach at the kind',
      route: routes.test,
      status: 404,
      json: { kind: 'gone', message: 'no such Test' },
      expected: { kind: 'breach', problem: /outside its schema at \/kind/ },
    },
    {
      name: 'a 2xx body missing a declared field is a breach at its path',
      route: routes.tests,
      status: 200,
      json: [{ ...row, state: undefined }],
      expected: { kind: 'breach', problem: /^GET \/api\/tests answered 200 outside its schema at \/0/ },
    },
    {
      name: 'a 2xx body with a field of the wrong type is a breach at that field',
      route: routes.tests,
      status: 200,
      json: [{ ...row, receivedAt: 1_700_000_000 }],
      expected: { kind: 'breach', problem: /outside its schema at \/0\/receivedAt/ },
    },
    {
      name: 'a non-2xx body that is not an object is a breach',
      route: routes.me,
      status: 500,
      json: 'Internal Server Error',
      expected: { kind: 'breach', problem: /^GET \/api\/me answered 500 outside its schema at \// },
    },
  ];
  for (const c of cases)
    it(c.name, () => {
      const answer = readReply(c.route, c.status, c.json);
      assert.equal(answer.kind, c.expected.kind);
      if (answer.kind === 'refused' && c.expected.kind === 'refused') assert.deepEqual(answer.body, c.expected.body);
      if (answer.kind === 'breach' && c.expected.kind === 'breach') assert.match(answer.problem, c.expected.problem);
    });
});

describe('pathOf', () => {
  it('replaces each :param with its encoded value', () => {
    assert.equal(pathOf(routes.test, { id: 'a b' }), '/api/tests/a%20b');
  });
  it('leaves a POST URL as it is', () => {
    assert.equal(pathOf(stepRoute('receive'), { testId: 'x', input: {} }), '/api/steps/receive');
  });
});

describe('a step body requires testId when the step starts from a state, and signature when it signs', () => {
  const required: { [K in StepName]: string[] } = {
    submit: ['commitKey', 'input'],
    receive: ['commitKey', 'testId', 'input'],
    assign: ['commitKey', 'testId', 'input'],
    enterResult: ['commitKey', 'testId', 'input', 'signature'],
    review: ['commitKey', 'testId', 'input', 'signature'],
    release: ['commitKey', 'testId', 'input', 'signature'],
  };
  for (const name of stepNames)
    it(`${name} requires ${required[name].join(', ')}`, () => {
      assert.deepEqual(stepRoute(name).schema.body.required, required[name]);
    });
});

describe('pressText', () => {
  const entries = { methodId: 'm1', description: 'Metformin HCl tablets (fictional)' };
  const press = pressText('submit', null, entries);
  const cases: [string, string, boolean][] = [
    [
      'the same entries typed in another order',
      pressText('submit', null, { description: entries.description, methodId: 'm1' }),
      true,
    ],
    [
      'other entries',
      pressText('submit', null, { ...entries, description: 'Metformin HCl, lot 2 (fictional)' }),
      false,
    ],
    ['another step', pressText('assign', null, entries), false],
    ['another record', pressText('submit', 't1', entries), false],
  ];
  for (const [what, other, same] of cases)
    it(`names ${what} as ${same ? 'the same' : 'another'} press`, () => assert.equal(other === press, same));
  it('names an entry typed and then cleared, which is an absent entry, as the same press', () =>
    assert.equal(
      pressText('submit', null, { ...entries, description: '' }),
      pressText('submit', null, { methodId: entries.methodId }),
    ));
});
