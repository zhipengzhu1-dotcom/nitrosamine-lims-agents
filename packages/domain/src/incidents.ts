import type { IncidentState, IncidentStepInputs, Meaning, Role, SystemIncident } from './http.ts';
import type { Sentence } from './sentence.ts';
import type { Refusal } from './steps.ts';

/**
 * The kinds whose answer to "could this have affected results or records?" is always Yes: a broken or unanchored
 * audit chain, or a clock step during audited writes. The same list as `lims.incident_forces_yes`.
 */
export const forcesYes = (kind: string): boolean =>
  kind === 'ChainVerifyFailure' || kind === 'FailedAnchor' || kind === 'ClockStep';

/** What a System Incident holds that decides which step may be taken on it: its kind, its state, and whether each of the three records is there. */
export interface IncidentFacts {
  kind: SystemIncident['kind'];
  state: IncidentState;
  impact: object | null;
  immediateAction: object | null;
  correctiveAction: object | null;
}

export type IncidentStepName =
  | 'answerImpact'
  | 'recordImmediateAction'
  | 'recordCorrectiveAction'
  | 'acknowledge'
  | 'close';

export interface IncidentStep<K extends IncidentStepName = IncidentStepName> {
  from: IncidentState;
  to: IncidentState;
  role: Role;
  signs: Meaning | null;
  guard?: (f: IncidentFacts, input: IncidentStepInputs[K]) => Sentence | null;
}

/** The first of the three records a close needs that is missing, named for the person at the bench. */
function missingForClose(f: IncidentFacts): Sentence | null {
  if (f.immediateAction === null) return 'The immediate action is not recorded on this System Incident.';
  if (f.correctiveAction === null) return 'The corrective action is not recorded on this System Incident.';
  if (f.impact === null) return "QA's answer is not recorded on this System Incident.";
  return null;
}

/**
 * How a System Incident closes: QA answers whether it could have affected results or records, the owner (as Admin)
 * records the immediate and corrective actions, signs Acknowledged over all three, and closes it. Each is recorded
 * once. The API refuses and the web offers by this table, and the database holds the same rules.
 */
export const incidentSteps: { [K in IncidentStepName]: IncidentStep<K> } = {
  answerImpact: {
    from: 'Open',
    to: 'Open',
    role: 'QA',
    signs: null,
    guard: (f, input) => {
      if (f.impact) return "QA's answer is already recorded on this System Incident.";
      if (input.answer === 'No' && forcesYes(f.kind))
        return 'A broken or unanchored audit chain, or a clock step, could have affected results or records: the answer is Yes.';
      return null;
    },
  },
  recordImmediateAction: {
    from: 'Open',
    to: 'Open',
    role: 'Admin',
    signs: null,
    guard: (f) => (f.immediateAction ? 'The immediate action is already recorded.' : null),
  },
  recordCorrectiveAction: {
    from: 'Open',
    to: 'Open',
    role: 'Admin',
    signs: null,
    guard: (f) => (f.correctiveAction ? 'The corrective action is already recorded.' : null),
  },
  acknowledge: { from: 'Open', to: 'Acknowledged', role: 'Admin', signs: 'Acknowledged', guard: missingForClose },
  close: { from: 'Acknowledged', to: 'Closed', role: 'Admin', signs: null, guard: missingForClose },
};
export const incidentStepNames = Object.keys(incidentSteps).filter((key): key is IncidentStepName =>
  Object.hasOwn(incidentSteps, key),
);

/**
 * Why `name` may not be taken on the incident by someone holding `roles`, or null when it may: the role first, then
 * what the incident lacks, then its state, so that a close on an Open incident names what is still missing before it
 * says the incident is not Acknowledged.
 */
export function incidentRefusal<K extends IncidentStepName>(
  name: K,
  facts: IncidentFacts,
  roles: readonly Role[],
  input: IncidentStepInputs[K],
): Refusal | null {
  const step: IncidentStep<K> = incidentSteps[name];
  if (!roles.includes(step.role))
    return { kind: 'role', message: `The ${name} step is taken by the ${step.role} role.` };
  const failed = step.guard?.(facts, input);
  if (failed) return { kind: 'guard', message: failed };
  if (step.from !== facts.state)
    return {
      kind: 'state',
      message: `The ${name} step needs a System Incident in ${step.from} state, not ${facts.state}.`,
    };
  return null;
}

/** The steps someone holding `roles` may take on the incident now, in registry order; the web offers these. */
export function openIncidentSteps(facts: IncidentFacts, roles: readonly Role[]): IncidentStepName[] {
  return incidentStepNames.filter((name) => {
    const input =
      name === 'answerImpact'
        ? { answer: 'Yes' as const }
        : name === 'close' || name === 'acknowledge'
          ? {}
          : { text: ' ' };
    return incidentRefusal(name, facts, roles, input) === null;
  });
}
