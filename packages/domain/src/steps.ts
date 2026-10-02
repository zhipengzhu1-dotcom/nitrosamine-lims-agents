import type { Meaning, RefusalKind, Role, TestState } from './http.ts';
import type { Sentence } from './sentence.ts';

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
  guard?: (f: StepFacts) => Sentence | null;
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
        : 'The assignee must be an Analyst in this Lab with a Training Record for the Method.',
  },
  enterResult: {
    from: 'Assigned',
    to: 'SubmittedForReview',
    role: 'Analyst',
    signs: 'Performed',
    guard: (f) => (f.actor === f.assignee ? null : 'Only the assigned Analyst can enter the Result.'),
  },
  review: {
    from: 'SubmittedForReview',
    to: 'Reviewed',
    role: 'Reviewer',
    signs: 'Reviewed',
    guard: (f) => (f.signers.Performed === f.actor ? 'The Analyst who performed the Test cannot review it.' : null),
  },
  release: {
    from: 'Reviewed',
    to: 'Reported',
    role: 'QA',
    signs: 'Released',
    guard: (f) =>
      f.signers.Performed === f.actor || f.signers.Reviewed === f.actor
        ? 'QA cannot release a Test they performed or reviewed.'
        : null,
  },
} satisfies Record<string, Step>;

/** Who may take each action that is not a step on a Test; the API refuses and the web offers by this table. */
export const actions = {
  generateAuditExport: { role: 'QA' },
} as const satisfies Record<string, { role: Role }>;
export type ActionName = keyof typeof actions;
/** True when one of `roles` takes `action`. */
export const mayTake = (action: ActionName, roles: readonly Role[]): boolean => roles.includes(actions[action].role);

export type StepName = keyof typeof steps;
export const stepNames = Object.keys(steps).filter((key): key is StepName => Object.hasOwn(steps, key));

export interface Refusal {
  kind: Extract<RefusalKind, 'state' | 'role' | 'guard'>;
  message: Sentence;
}

export function refusal(
  name: StepName,
  state: TestState | null,
  roles: readonly Role[],
  facts: StepFacts,
): Refusal | null {
  const step: Step = steps[name];
  if (step.from !== state)
    return { kind: 'state', message: `The ${name} step needs a Test in ${step.from ?? 'no'} state, not ${state}.` };
  if (!roles.includes(step.role))
    return { kind: 'role', message: `The ${name} step is taken by the ${step.role} role.` };
  const failed = step.guard?.(facts);
  return failed ? { kind: 'guard', message: failed } : null;
}

export function nextStep(state: TestState, roles: readonly Role[], facts: StepFacts): StepName | null {
  return stepNames.find((name) => steps[name].from === state && !refusal(name, state, roles, facts)) ?? null;
}
