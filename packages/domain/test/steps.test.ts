import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Refusal,
  type Role,
  refusal,
  type StepFacts,
  type StepName,
  stepNames,
  steps,
  type TestState,
} from '../src/index.ts';

const stateSet = {
  Requested: null,
  Ready: null,
  Assigned: null,
  SubmittedForReview: null,
  Reviewed: null,
  Reported: null,
} satisfies Record<TestState, null>;
const states: (TestState | null)[] = [
  null,
  ...Object.keys(stateSet).filter((key): key is TestState => Object.hasOwn(stateSet, key)),
];

const roleSet = {
  Customer: null,
  SampleCustodian: null,
  Analyst: null,
  Reviewer: null,
  QA: null,
  LabManager: null,
  Admin: null,
} satisfies Record<Role, null>;
const roles = Object.keys(roleSet).filter((key): key is Role => Object.hasOwn(roleSet, key));

const allowed: StepFacts = {
  actor: 'ana',
  assignee: 'ana',
  assigneeTrained: true,
  signers: { Performed: 'pia', Reviewed: 'rui' },
};

describe('a step from any state but its own is refused', () => {
  for (const name of stepNames) {
    const { from, role } = steps[name];
    it(`${name} is taken only from ${from ?? 'no'} state`, () => {
      assert.equal(refusal(name, from, [role], allowed), null, `${name} from ${from} by ${role}`);
      for (const state of states.filter((s) => s !== from))
        assert.deepEqual(refusal(name, state, [role], allowed), {
          kind: 'state',
          message: `${name} needs a Test in ${from ?? 'no'} state, not ${state}`,
        });
    });
  }
});

describe('a step by any role but its own is refused', () => {
  for (const name of stepNames) {
    const { from, role } = steps[name];
    it(`${name} is taken only by the ${role} role`, () => {
      const expected: Refusal = { kind: 'role', message: `${name} is taken by the ${role} role` };
      assert.deepEqual(refusal(name, from, [], allowed), expected, 'a person with no role');
      for (const other of roles.filter((r) => r !== role))
        assert.deepEqual(refusal(name, from, [other], allowed), expected, other);
    });
  }
});

describe("a step whose guard fails is refused with the guard's reason", () => {
  const cases: { name: string; step: StepName; facts: Partial<StepFacts>; refused: string | null }[] = [
    {
      name: 'assigning an Analyst without a Training Record for the Method is refused',
      step: 'assign',
      facts: { assignee: 'theo', assigneeTrained: false },
      refused: 'the assignee must be an Analyst in this Lab with a Training Record for the Method',
    },
    {
      name: 'assign is offered while the Lab Manager has named no assignee yet',
      step: 'assign',
      facts: { assignee: null, assigneeTrained: false },
      refused: null,
    },
    {
      name: 'a Result entered by anyone but the assigned Analyst is refused',
      step: 'enterResult',
      facts: { assignee: 'wes' },
      refused: 'only the assigned Analyst can enter the Result',
    },
    {
      name: 'a review by the Analyst who performed the Test is refused',
      step: 'review',
      facts: { signers: { Performed: 'ana' } },
      refused: 'the Analyst who performed the Test cannot review it',
    },
    {
      name: 'a release by the Analyst who performed the Test is refused',
      step: 'release',
      facts: { signers: { Performed: 'ana', Reviewed: 'rui' } },
      refused: 'QA cannot release a Test they performed or reviewed',
    },
    {
      name: 'a release by the Reviewer who reviewed the Test is refused',
      step: 'release',
      facts: { signers: { Performed: 'pia', Reviewed: 'ana' } },
      refused: 'QA cannot release a Test they performed or reviewed',
    },
  ];
  for (const c of cases)
    it(c.name, () => {
      const { from, role } = steps[c.step];
      assert.equal(refusal(c.step, from, [role], allowed), null, `${c.step} with facts that pass its guard`);
      const expected: Refusal | null = c.refused === null ? null : { kind: 'guard', message: c.refused };
      assert.deepEqual(refusal(c.step, from, [role], { ...allowed, ...c.facts }), expected);
    });
});
