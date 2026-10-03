import type { Meaning, Role, TestState } from './http.ts';
import type { PersonId, Refusal } from './steps.ts';

export type ChangeStepName = 'proposeChange' | 'approveChange' | 'rejectChange' | 'withdrawChange';
/** The steps that take a reason from their own picklist; an approval's reason is the proposal's. */
export type ReasonStep = Exclude<ChangeStepName, 'approveChange'>;
export const reasonSteps = ['proposeChange', 'rejectChange', 'withdrawChange'] as const satisfies ReasonStep[];

/** What decides who may take a Critical Data Change step on a Test: its state, its people, and the proposer of the change pending on it. */
export interface ChangeFacts {
  actor: PersonId;
  state: TestState;
  assignee: PersonId | null;
  performedBy: PersonId | null;
  pendingBy: PersonId | null;
}

interface ChangeStep {
  role: Role;
  signs: Meaning | null;
  guard: (f: ChangeFacts) => Refusal | null;
}

const nonePending: Refusal = { kind: 'state', message: 'No Critical Data Change is pending on this Test.' };

/** Neither the proposer nor the Analyst who signed Performed decides a correction: the four-eyes rule of #45. */
function decider(f: ChangeFacts): Refusal | null {
  if (f.pendingBy === null) return nonePending;
  if (f.actor === f.pendingBy)
    return { kind: 'guard', message: 'The proposer cannot approve or reject their own Critical Data Change.' };
  if (f.actor === f.performedBy)
    return {
      kind: 'guard',
      message: 'The Analyst who signed Performed cannot approve or reject a correction to the Result.',
    };
  return null;
}

/**
 * How a saved Result value changes: the assigned Analyst proposes, a Reviewer approves with a Signature or rejects,
 * or the proposer withdraws. The API refuses and the web offers by this table, and the database holds the same rules.
 */
export const changeSteps: Record<ChangeStepName, ChangeStep> = {
  proposeChange: {
    role: 'Analyst',
    signs: null,
    guard: (f) => {
      if (f.state !== 'SubmittedForReview' && f.state !== 'Reviewed')
        return {
          kind: 'state',
          message: `A Critical Data Change is proposed on a Test in SubmittedForReview or Reviewed state, not ${f.state}.`,
        };
      if (f.actor !== f.assignee)
        return {
          kind: 'guard',
          message: 'Only the assigned Analyst can propose a Critical Data Change to the Result.',
        };
      if (f.pendingBy !== null)
        return { kind: 'changePending', message: 'A Critical Data Change on this Result is already pending.' };
      return null;
    },
  },
  approveChange: { role: 'Reviewer', signs: 'Approved', guard: decider },
  rejectChange: { role: 'Reviewer', signs: null, guard: decider },
  withdrawChange: {
    role: 'Analyst',
    signs: null,
    guard: (f) => {
      if (f.pendingBy === null) return nonePending;
      return f.actor === f.pendingBy
        ? null
        : { kind: 'guard', message: 'Only the proposer withdraws a Critical Data Change.' };
    },
  },
};
export const changeStepNames = Object.keys(changeSteps).filter((key): key is ChangeStepName =>
  Object.hasOwn(changeSteps, key),
);

/** Why `name` may not be taken by someone holding `roles`, or null when it may: the role first, then the step's own rule. */
export function changeRefusal(name: ChangeStepName, facts: ChangeFacts, roles: readonly Role[]): Refusal | null {
  const step = changeSteps[name];
  if (!roles.includes(step.role))
    return { kind: 'role', message: `The ${name} step is taken by the ${step.role} role.` };
  return step.guard(facts);
}

/** The Critical Data Change steps someone holding `roles` may take on the Test now, in registry order; the web offers these. */
export function openChangeSteps(facts: ChangeFacts, roles: readonly Role[]): ChangeStepName[] {
  return changeStepNames.filter((name) => changeRefusal(name, facts, roles) === null);
}
