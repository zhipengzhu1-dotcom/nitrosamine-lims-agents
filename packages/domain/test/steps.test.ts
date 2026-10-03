import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  nextStep,
  type Refusal,
  type Role,
  type Sentence,
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
  PlatformOperator: null,
} satisfies Record<Role, null>;
const roles = Object.keys(roleSet).filter((key): key is Role => Object.hasOwn(roleSet, key));

const allowed: StepFacts = {
  actor: 'ana',
  assignee: 'ana',
  assigneeTrained: true,
  signers: { Performed: ['pia'], Reviewed: ['rui'], Approved: ['rui'] },
  signedOnLatest: ['Performed', 'Reviewed'],
  pendingChange: false,
};
/** Facts that pass `name`'s guard: Performed is signed again only once an approved change left the Result unsigned. */
const allowedFor = (name: StepName): StepFacts =>
  name === 'signPerformedAgain' ? { ...allowed, signedOnLatest: [] } : allowed;

describe('a step from any state but its own is refused', () => {
  for (const name of stepNames) {
    const { from, role } = steps[name];
    it(`${name} is taken only from ${from ?? 'no'} state`, () => {
      assert.equal(refusal(name, from, [role], allowedFor(name)), null, `${name} from ${from} by ${role}`);
      for (const state of states.filter((s) => s !== from))
        assert.deepEqual(refusal(name, state, [role], allowedFor(name)), {
          kind: 'state',
          message: `The ${name} step needs a Test in ${from ?? 'no'} state, not ${state}.`,
        });
    });
  }
});

describe('a step by any role but its own is refused', () => {
  for (const name of stepNames) {
    const { from, role } = steps[name];
    it(`${name} is taken only by the ${role} role`, () => {
      const expected: Refusal = { kind: 'role', message: `The ${name} step is taken by the ${role} role.` };
      assert.deepEqual(refusal(name, from, [], allowedFor(name)), expected, 'a person with no role');
      for (const other of roles.filter((r) => r !== role))
        assert.deepEqual(refusal(name, from, [other], allowedFor(name)), expected, other);
    });
  }
});

describe("a step whose guard fails is refused with the guard's reason", () => {
  const cases: { name: string; step: StepName; facts: Partial<StepFacts>; refused: Sentence | null }[] = [
    {
      name: 'assigning an Analyst without a Training Record for the Method is refused',
      step: 'assign',
      facts: { assignee: 'theo', assigneeTrained: false },
      refused: 'The assignee must be an Analyst in this Lab with a Training Record for the Method.',
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
      refused: 'Only the assigned Analyst can enter the Result.',
    },
    {
      name: 'a review by the Analyst who performed the Test is refused',
      step: 'review',
      facts: { signers: { Performed: ['ana'] } },
      refused: 'The Analyst who performed the Test cannot review it.',
    },
    {
      name: 'a release by the Analyst who performed the Test is refused',
      step: 'release',
      facts: { signers: { Performed: ['ana'], Reviewed: ['rui'] } },
      refused: 'QA cannot release a Test they performed or reviewed.',
    },
    {
      name: 'a release by the Reviewer who reviewed the Test is refused',
      step: 'release',
      facts: { signers: { Performed: ['pia'], Reviewed: ['ana'] } },
      refused: 'QA cannot release a Test they performed or reviewed.',
    },
    {
      name: 'a release by a Reviewer of an earlier Record Version of the Test is refused',
      step: 'release',
      facts: { signers: { Performed: ['pia'], Reviewed: ['ana', 'rui'] } },
      refused: 'QA cannot release a Test they performed or reviewed.',
    },
    {
      name: 'a release by the Reviewer who approved a Critical Data Change on the Test is refused',
      step: 'release',
      facts: { signers: { Performed: ['pia'], Reviewed: ['rui'], Approved: ['ana'] } },
      refused: 'QA cannot release a Test after approving a Critical Data Change on it.',
    },
    {
      name: 'signing the corrected Result Performed by anyone but the assigned Analyst is refused',
      step: 'signPerformedAgain',
      facts: { assignee: 'wes' },
      refused: 'Only the assigned Analyst can sign the Test Performed again.',
    },
    {
      name: 'signing Performed again while a Performed Signature covers the Result as it reads now is refused',
      step: 'signPerformedAgain',
      facts: { signedOnLatest: ['Performed'] },
      refused: 'The Test as it reads now is already signed Performed.',
    },
    {
      name: 'a review of a corrected Result the assigned Analyst has not signed Performed again is refused',
      step: 'review',
      facts: { signedOnLatest: [] },
      refused: "The Test as it reads now needs the assigned Analyst's Performed Signature before review.",
    },
    {
      name: 'a release of a corrected Result the assigned Analyst has not signed Performed again is refused',
      step: 'release',
      facts: { signedOnLatest: ['Reviewed'] },
      refused: "The Test as it reads now needs the assigned Analyst's Performed Signature before release.",
    },
    {
      name: 'a release of a corrected Result no Reviewer has signed Reviewed again is refused',
      step: 'release',
      facts: { signedOnLatest: ['Performed'] },
      refused: 'The Test as it reads now needs a Reviewed Signature before release.',
    },
  ];
  for (const c of cases)
    it(c.name, () => {
      const { from, role } = steps[c.step];
      assert.equal(refusal(c.step, from, [role], allowedFor(c.step)), null, `${c.step} with facts that pass its guard`);
      const expected: Refusal | null = c.refused === null ? null : { kind: 'guard', message: c.refused };
      assert.deepEqual(refusal(c.step, from, [role], { ...allowedFor(c.step), ...c.facts }), expected);
    });
});

describe('after an approved change the assigned Analyst signs Performed again, then a Reviewer reviews', () => {
  const corrected: StepFacts = { ...allowed, signers: { Performed: ['ana'], Approved: ['rui'] }, signedOnLatest: [] };
  it('the next step for the assigned Analyst is to sign Performed again, and a Reviewer has none until then', () => {
    assert.equal(nextStep('SubmittedForReview', ['Analyst'], corrected), 'signPerformedAgain');
    assert.equal(nextStep('SubmittedForReview', ['Reviewer'], { ...corrected, actor: 'dee' }), null);
  });
  it('once Performed covers the corrected Result, review is next and signing Performed again is not', () => {
    const resigned: StepFacts = { ...corrected, signedOnLatest: ['Performed'] };
    assert.equal(nextStep('SubmittedForReview', ['Analyst'], resigned), null);
    assert.equal(nextStep('SubmittedForReview', ['Reviewer'], { ...resigned, actor: 'dee' }), 'review');
  });
});
