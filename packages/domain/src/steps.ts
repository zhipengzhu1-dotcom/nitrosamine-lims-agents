import type { Meaning, Role, TestState } from '@lims/db';

export type { Meaning, Role, TestState };
export type PersonId = string;

export interface StepFacts {
  actor: PersonId;
  assignee: PersonId | null;
  assigneeTrained: boolean;
  signers: Partial<Record<Meaning, PersonId>>;
}

export interface Step {
  from: TestState | null;
  to: TestState;
  role: Role;
  signs: Meaning | null;
  guard?: (f: StepFacts) => string | null;
}

export const steps = {
  submit: { from: null, to: 'Requested', role: 'Customer', signs: null },
  receive: { from: 'Requested', to: 'Ready', role: 'SampleCustodian', signs: null },
  assign: {
    from: 'Ready',
    to: 'Assigned',
    role: 'LabManager',
    signs: null,
    // With no assignee named yet the Lab Manager is still choosing; the API requires one on the step itself.
    guard: (f) =>
      f.assignee === null || f.assigneeTrained
        ? null
        : 'the assignee must be an Analyst in this Lab with a Training Record for the Method',
  },
  enterResult: {
    from: 'Assigned',
    to: 'SubmittedForReview',
    role: 'Analyst',
    signs: 'Performed',
    guard: (f) => (f.actor === f.assignee ? null : 'only the assigned Analyst can enter the Result'),
  },
  review: {
    from: 'SubmittedForReview',
    to: 'Reviewed',
    role: 'Reviewer',
    signs: 'Reviewed',
    guard: (f) => (f.signers.Performed === f.actor ? 'the Analyst who performed the Test cannot review it' : null),
  },
  release: {
    from: 'Reviewed',
    to: 'Reported',
    role: 'QA',
    signs: 'Released',
    guard: (f) =>
      f.signers.Performed === f.actor || f.signers.Reviewed === f.actor
        ? 'QA cannot release a Test they performed or reviewed'
        : null,
  },
} satisfies Record<string, Step>;

export type StepName = keyof typeof steps;
export const stepNames = Object.keys(steps) as StepName[];

export interface Refusal {
  kind: 'state' | 'role' | 'guard';
  message: string;
}

export function refusal(
  name: StepName,
  state: TestState | null,
  roles: readonly Role[],
  facts: StepFacts,
): Refusal | null {
  const step: Step = steps[name];
  if (step.from !== state)
    return { kind: 'state', message: `${name} needs a Test in ${step.from ?? 'no'} state, not ${state}` };
  if (!roles.includes(step.role)) return { kind: 'role', message: `${name} is taken by the ${step.role} role` };
  const failed = step.guard?.(facts);
  return failed ? { kind: 'guard', message: failed } : null;
}

export function nextStep(state: TestState, roles: readonly Role[], facts: StepFacts): StepName | null {
  return stepNames.find((name) => steps[name].from === state && !refusal(name, state, roles, facts)) ?? null;
}
