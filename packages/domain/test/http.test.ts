import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathOf, readReply, type Route, routes, type StepName, stepNames, stepRoute } from '../src/index.ts';

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
const refusal = { statusCode: 404, error: 'Not Found', message: 'no such Test' };

type Expected = { kind: 'reply' } | { kind: 'refused'; message: string } | { kind: 'breach'; problem: RegExp };

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
      name: "a 4xx body in Fastify's error shape is refused with its message",
      route: routes.test,
      status: 404,
      json: refusal,
      expected: { kind: 'refused', message: 'no such Test' },
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
      name: "a non-2xx body outside Fastify's error shape is a breach",
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
      if (answer.kind === 'refused' && c.expected.kind === 'refused') assert.equal(answer.message, c.expected.message);
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
    submit: ['input'],
    receive: ['testId', 'input'],
    assign: ['testId', 'input'],
    enterResult: ['testId', 'input', 'signature'],
    review: ['testId', 'input', 'signature'],
    release: ['testId', 'input', 'signature'],
  };
  for (const name of stepNames)
    it(`${name} requires ${required[name].join(', ')}`, () => {
      assert.deepEqual(stepRoute(name).schema.body.required, required[name]);
    });
});
