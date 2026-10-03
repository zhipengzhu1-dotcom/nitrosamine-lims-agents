import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ChangeFacts,
  type ChangeStepName,
  changeRefusal,
  changeStepNames,
  openChangeSteps,
  type Refusal,
  type Role,
  refusal,
  type StepFacts,
  steps,
  type TestState,
} from '../src/index.ts';

const facts = (over: Partial<ChangeFacts>): ChangeFacts => ({
  actor: 'ana',
  state: 'SubmittedForReview',
  assignee: 'ana',
  performedBy: 'ana',
  pendingBy: null,
  ...over,
});
const pending = (over: Partial<ChangeFacts> = {}) => facts({ actor: 'rui', pendingBy: 'ana', ...over });

const rows: [string, ChangeStepName, Role[], ChangeFacts, Refusal | null][] = [
  ['the assigned Analyst proposes on a Test submitted for review', 'proposeChange', ['Analyst'], facts({}), null],
  [
    'the assigned Analyst proposes on a reviewed Test',
    'proposeChange',
    ['Analyst'],
    facts({ state: 'Reviewed' }),
    null,
  ],
  [
    'a Reviewer does not propose',
    'proposeChange',
    ['Reviewer'],
    facts({}),
    { kind: 'role', message: 'The proposeChange step is taken by the Analyst role.' },
  ],
  [
    'an Analyst other than the assignee does not propose',
    'proposeChange',
    ['Analyst'],
    facts({ actor: 'pia' }),
    { kind: 'guard', message: 'Only the assigned Analyst can propose a Critical Data Change to the Result.' },
  ],
  [
    'no proposal on a released Test',
    'proposeChange',
    ['Analyst'],
    facts({ state: 'Reported' }),
    {
      kind: 'state',
      message: 'A Critical Data Change is proposed on a Test in SubmittedForReview or Reviewed state, not Reported.',
    },
  ],
  [
    'no second proposal while one is pending',
    'proposeChange',
    ['Analyst'],
    facts({ pendingBy: 'ana' }),
    { kind: 'changePending', message: 'A Critical Data Change on this Result is already pending.' },
  ],
  ['a Reviewer approves a pending change', 'approveChange', ['Reviewer'], pending(), null],
  ['a Reviewer rejects a pending change', 'rejectChange', ['Reviewer'], pending(), null],
  [
    'an Analyst does not approve',
    'approveChange',
    ['Analyst'],
    pending(),
    { kind: 'role', message: 'The approveChange step is taken by the Reviewer role.' },
  ],
  [
    'nothing to approve with no change pending',
    'approveChange',
    ['Reviewer'],
    facts({ actor: 'rui' }),
    { kind: 'state', message: 'No Critical Data Change is pending on this Test.' },
  ],
  [
    'the proposer does not approve their own change',
    'approveChange',
    ['Analyst', 'Reviewer'],
    pending({ actor: 'dana', pendingBy: 'dana' }),
    { kind: 'guard', message: 'The proposer cannot approve or reject their own Critical Data Change.' },
  ],
  [
    'the Performed signer does not reject a correction',
    'rejectChange',
    ['Analyst', 'Reviewer'],
    pending({ actor: 'dana', pendingBy: 'ana', performedBy: 'dana' }),
    { kind: 'guard', message: 'The Analyst who signed Performed cannot approve or reject a correction to the Result.' },
  ],
  ['the proposer withdraws', 'withdrawChange', ['Analyst'], pending({ actor: 'ana' }), null],
  [
    'nobody else withdraws',
    'withdrawChange',
    ['Analyst'],
    pending({ actor: 'pia' }),
    { kind: 'guard', message: 'Only the proposer withdraws a Critical Data Change.' },
  ],
  [
    'nothing to withdraw with no change pending',
    'withdrawChange',
    ['Analyst'],
    facts({}),
    { kind: 'state', message: 'No Critical Data Change is pending on this Test.' },
  ],
];

describe('who proposes, approves, rejects and withdraws a Critical Data Change', () => {
  for (const [name, step, roles, f, expected] of rows)
    it(name, () => assert.deepEqual(changeRefusal(step, f, roles), expected));

  it('the web is offered exactly the steps the registry allows', () => {
    assert.deepEqual(openChangeSteps(facts({}), ['Analyst']), ['proposeChange']);
    assert.deepEqual(openChangeSteps(pending({ actor: 'ana' }), ['Analyst']), ['withdrawChange']);
    assert.deepEqual(openChangeSteps(pending(), ['Reviewer']), ['approveChange', 'rejectChange']);
    assert.equal(changeStepNames.length, 4);
  });
});

describe('every Test step that signs waits while a Critical Data Change is pending', () => {
  const f: StepFacts = {
    actor: 'qa',
    assignee: 'ana',
    assigneeTrained: true,
    signers: { Performed: ['ana'], Reviewed: ['rui'] },
    signedOnLatest: [],
    pendingChange: true,
  };
  const signing: [Parameters<typeof refusal>[0], TestState, Role][] = [
    ['enterResult', 'Assigned', 'Analyst'],
    ['signPerformedAgain', 'SubmittedForReview', 'Analyst'],
    ['review', 'SubmittedForReview', 'Reviewer'],
    ['release', 'Reviewed', 'QA'],
  ];
  for (const [name, state, role] of signing)
    it(`${name} is refused while a change is pending`, () =>
      assert.deepEqual(
        refusal(name, state, [role], { ...f, actor: steps[name].role === 'Analyst' ? 'ana' : f.actor }),
        {
          kind: 'changePending',
          message: 'The Test cannot be signed while a Critical Data Change on it is pending.',
        },
      ));
  it('a step that does not sign is not held up', () =>
    assert.equal(refusal('assign', 'Ready', ['LabManager'], f), null));
});
