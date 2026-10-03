import type { Meaning, RefusalKind, Role, TestState } from './http.ts';
import type { Sentence } from './sentence.ts';

export type PersonId = string;

export interface StepFacts {
  actor: PersonId;
  assignee: PersonId | null;
  assigneeTrained: boolean;
  /** Everyone who signed each meaning on any Record Version of the Test, and Approved on any of its Critical Data Changes. */
  signers: Partial<Record<Meaning, readonly PersonId[]>>;
  /** The Signature Meanings given on the Test's latest Record Version: those that still cover the Test as it reads now. */
  signedOnLatest: readonly Meaning[];
  /** True while a Critical Data Change on the Test's Result is neither approved, rejected nor withdrawn. */
  pendingChange: boolean;
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
  // A new Record Version of the Test, such as an approved Critical Data Change makes, leaves the Performed Signature on
  // the earlier one, so the assigned Analyst signs the Test as it reads now before anyone reviews or releases it.
  signPerformedAgain: {
    from: 'SubmittedForReview',
    to: 'SubmittedForReview',
    role: 'Analyst',
    signs: 'Performed',
    guard: (f) => {
      if (f.actor !== f.assignee) return 'Only the assigned Analyst can sign the Test Performed again.';
      return f.signedOnLatest.includes('Performed') ? 'The Test as it reads now is already signed Performed.' : null;
    },
  },
  review: {
    from: 'SubmittedForReview',
    to: 'Reviewed',
    role: 'Reviewer',
    signs: 'Reviewed',
    guard: (f) => {
      if (f.signers.Performed?.includes(f.actor)) return 'The Analyst who performed the Test cannot review it.';
      return f.signedOnLatest.includes('Performed')
        ? null
        : "The Test as it reads now needs the assigned Analyst's Performed Signature before review.";
    },
  },
  release: {
    from: 'Reviewed',
    to: 'Reported',
    role: 'QA',
    signs: 'Released',
    guard: (f) => {
      if (f.signers.Performed?.includes(f.actor) || f.signers.Reviewed?.includes(f.actor))
        return 'QA cannot release a Test they performed or reviewed.';
      if (f.signers.Approved?.includes(f.actor))
        return 'QA cannot release a Test after approving a Critical Data Change on it.';
      if (!f.signedOnLatest.includes('Performed'))
        return "The Test as it reads now needs the assigned Analyst's Performed Signature before release.";
      return f.signedOnLatest.includes('Reviewed')
        ? null
        : 'The Test as it reads now needs a Reviewed Signature before release.';
    },
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
  kind: Extract<RefusalKind, 'state' | 'role' | 'guard' | 'changePending'>;
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
  if (step.signs !== null && facts.pendingChange)
    return {
      kind: 'changePending',
      message: 'The Test cannot be signed while a Critical Data Change on it is pending.',
    };
  const failed = step.guard?.(facts);
  return failed ? { kind: 'guard', message: failed } : null;
}

export function nextStep(state: TestState, roles: readonly Role[], facts: StepFacts): StepName | null {
  return stepNames.find((name) => steps[name].from === state && !refusal(name, state, roles, facts)) ?? null;
}
