// Gates: pure functions from loaded facts to "go" or every reason why not. A command loads the facts
// (apps/api records/facts.ts, one loader per gate, standings computed from the database clock),
// calls the gate, and acts. The "Who is signing" panel calls the same gate before credentials, and
// the signing transaction calls it again, so what the prompt shows and what the server enforces
// cannot differ. State checks belong to the machines, not here.
//
// Gates return every reason, not the first, because the rail lists them all.

import { formatWritten } from './decimal.ts';
import type { PersonId, PreparationId } from './ids.ts';
import type { NonEmpty } from './nonempty.ts';
import { describeReasons, type GateReason, type NotBuilt, type Refusal, type SodRule } from './refusal.ts';
import type { Meaning } from './signing.ts';
import type { Jurisdiction, LineVerdict, RunCheckOutcome, TestJudgement } from './verdict.ts';

export type GateResult =
  | { readonly go: true }
  | { readonly go: false; readonly reasons: NonEmpty<GateReason> };

// ---------------------------------------------------------------------------------------------
// Standings, computed by the fact loader at the database clock.
// ---------------------------------------------------------------------------------------------

export type TrainingStanding =
  | { readonly kind: 'current'; readonly documentVersion: string }
  | { readonly kind: 'missing'; readonly documentVersion: string }
  | { readonly kind: 'superseded'; readonly documentVersion: string; readonly by: string };

export type AuthorisationStanding =
  | { readonly kind: 'current'; readonly meaning: Meaning; readonly scope: string; readonly validUntil: string }
  | { readonly kind: 'missing'; readonly meaning: Meaning; readonly scope: string }
  | { readonly kind: 'expired'; readonly meaning: Meaning; readonly scope: string; readonly validUntil: string }
  | { readonly kind: 'suspended'; readonly meaning: Meaning; readonly scope: string };

const leapYear = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/**
 * Decision 19: an Authorisation is valid for 12 months. The latest valid-until (exclusive) for a
 * valid-from date: the same day a year on, or 28 February when that day is 29 February.
 */
export function authorisationEndsBy(validFrom: string): string {
  const [y, m, d] = validFrom.split('-');
  const year = Number(y) + 1;
  return `${year}-${m}-${m === '02' && d === '29' && !leapYear(year) ? '28' : d}`;
}

/** Decision 13's enabling steps, plus decision 19 §7's LIMS-use training. */
export type EnablementStep = 'identity-check' | 'policy-acknowledged' | 'lims-use-training';

export type SigningEnablement =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'not-enabled'; readonly missingSteps: NonEmpty<EnablementStep> };

export type FitnessStatus = 'Quarantined' | 'In use' | 'Suspended' | 'Expired' | 'Retired';

export type AdoptionStatus =
  | 'in-development' | 'validated-here' | 'transferred-in' | 'verified' | 'verified-basic-compendial' | 'retired'
  | 'none'; // no Adoption of this Method version in this Lab

/** A Method version's basis (decision 36). */
export type MethodBasis = 'compendial' | 'alternative' | 'in-house';

// ---------------------------------------------------------------------------------------------
// Who may act. Each signer type holds exactly what decision 19 checks for that meaning.
// ---------------------------------------------------------------------------------------------

/** Decision 19 §4's four conditions, checked at assignment and again at every Performed signature. */
export type PerformerFacts = {
  readonly person: PersonId;
  readonly methodTraining: TrainingStanding; // on the Method version the Test uses
  readonly prerequisiteTraining: readonly TrainingStanding[];
  readonly authorisation: AuthorisationStanding; // Performed, on the Method, in this Lab
  readonly signing: SigningEnablement;
};

export type AnalystFacts = PerformerFacts & { readonly holdsAnalystRole: boolean };

/** Verified needs a current Performed or Reviewed Authorisation on the Test's Method. */
export type VerifierFacts = {
  readonly person: PersonId;
  readonly authorisations: NonEmpty<AuthorisationStanding>; // any one current suffices
  readonly signing: SigningEnablement;
};

/** Reviewed needs a Reviewed Authorisation and a Training Record at the Reviewer's level on the pinned version. */
export type ReviewerFacts = {
  readonly person: PersonId;
  readonly methodTraining: TrainingStanding;
  readonly authorisation: AuthorisationStanding;
  readonly signing: SigningEnablement;
};

/** Released needs its own Authorisation and one for conformity statements, since the report states verdicts. */
export type ReleaserFacts = {
  readonly person: PersonId;
  readonly authorisation: AuthorisationStanding;
  readonly conformityAuthorisation: AuthorisationStanding;
  readonly signing: SigningEnablement;
};

// ---------------------------------------------------------------------------------------------
// Fact shapes per gate
// ---------------------------------------------------------------------------------------------

export type AcceptanceFacts = { readonly gxpClass: 'GMP' | 'non-GMP'; readonly adoption: AdoptionStatus };
export type ReadyFacts = AcceptanceFacts & { readonly sampleReceived: boolean };
export type CancelFacts = { readonly test: string; readonly preparations: number; readonly runs: number };

export type VerifiedFacts = {
  readonly signer: VerifierFacts;
  readonly values: NonEmpty<{
    readonly label: string;
    readonly authors: readonly PersonId[]; // of every version of the value
    readonly proposer: PersonId | null; // author of the pending version being approved, if any
  }>;
};

export type RunPerformedFacts = {
  readonly run: string;
  readonly signer: PerformerFacts;
  readonly isAcquirer: boolean;
  readonly missingValues: readonly string[];
  readonly unverifiedValues: readonly string[];
  readonly pendingChanges: readonly string[];
  readonly equipment: { readonly code: string; readonly fitness: FitnessStatus };
  readonly runChecks: readonly { readonly check: string; readonly outcome: RunCheckOutcome }[]; // from judgeRunCheck
};

export type TestPerformedFacts = {
  readonly test: string;
  readonly signer: PerformerFacts;
  readonly isAssignee: boolean;
  readonly valuesByOthers: readonly string[]; // Recorded Values on the Test another person typed
  readonly missingValues: readonly string[];
  readonly unverifiedValues: readonly string[];
  readonly pendingChanges: readonly string[];
  readonly runs: readonly { readonly run: string; readonly performedStands: boolean }[];
  /** The balance each Preparation was weighed on (usp 7, iso 5), checked In use like the Run's instrument. */
  readonly balances: readonly { readonly preparation: string; readonly equipment: { readonly code: string; readonly fitness: FitnessStatus } }[];
  readonly judgement: TestJudgement;
  readonly blockingHolds: readonly string[];
};

/** Reviewed on a Test (with the Runs feeding it, at least one) or on a Run (with none). */
export type ReviewedFacts = {
  readonly kind: 'test' | 'run';
  readonly record: string;
  readonly signer: ReviewerFacts;
  readonly performedStands: boolean;
  readonly performedSigners: readonly PersonId[]; // on the record and every Run feeding it
  readonly feedingRuns: readonly { readonly run: string; readonly reviewedStands: boolean }[];
  readonly pendingChanges: readonly string[];
  readonly checklist: Checklist;
  readonly blockingHolds: readonly string[];
};

export type ReleasedFacts = {
  readonly report: string;
  readonly signer: ReleaserFacts;
  readonly tests: NonEmpty<{
    readonly test: string;
    readonly performedStands: boolean;
    readonly reviewedStands: boolean;
    readonly performedBy: readonly PersonId[]; // assigned Analysts and Performed signers, of the Test and its Runs
    readonly reviewedBy: readonly PersonId[]; // Reviewed signers, of the Test and its Runs
    readonly hasRun: boolean;
    readonly blockingHolds: readonly string[];
    readonly pendingChanges: readonly string[]; // on the Test's values and its Runs' values: the lock would leave them unsettleable
    readonly verdicts: readonly { readonly jurisdiction: Jurisdiction; readonly confirmation: 'confirmed' | 'disagreed' | 'none' }[];
  }>;
  readonly checklist: Checklist;
};

export type Checklist = { readonly required: readonly string[]; readonly ticked: readonly string[] };

// ---------------------------------------------------------------------------------------------
// Shared checks on the person
// ---------------------------------------------------------------------------------------------

type Reasons = GateReason[];

function training(standings: readonly TrainingStanding[]): Reasons {
  return standings.flatMap((standing) => (standing.kind === 'current' ? [] : [{ code: 'training' as const, standing }]));
}

/** Passes if any one standing is current; otherwise names every one. */
function authorisation(standings: NonEmpty<AuthorisationStanding>): Reasons {
  if (standings.some((a) => a.kind === 'current')) return [];
  const [first, ...rest] = standings.filter((a) => a.kind !== 'current');
  return first ? [{ code: 'authorisation', standings: [first, ...rest] }] : [];
}

const enablement = (s: SigningEnablement): Reasons =>
  s.kind === 'enabled' ? [] : [{ code: 'signing-not-enabled', missingSteps: s.missingSteps }];

/** Decision 19 §4, in its order: (1) Method version training, (2) prerequisites, (3) Authorisation, (4) signing. */
const performerReasons = (p: PerformerFacts): Reasons => [
  ...training([p.methodTraining, ...p.prerequisiteTraining]),
  ...authorisation([p.authorisation]),
  ...enablement(p.signing),
];

const each = <T>(xs: readonly T[], reason: (x: T) => GateReason): Reasons => xs.map(reason);

function unticked(c: Checklist): Reasons {
  const [first, ...rest] = c.required.filter((item) => !c.ticked.includes(item));
  return first === undefined ? [] : [{ code: 'checklist-incomplete', items: [first, ...rest] }];
}

function result(reasons: Reasons): GateResult {
  const [first, ...rest] = reasons;
  return first === undefined ? { go: true } : { go: false, reasons: [first, ...rest] };
}

const QUALIFIED: ReadonlySet<AdoptionStatus> = new Set(['validated-here', 'verified', 'transferred-in', 'verified-basic-compendial']);

// ---------------------------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------------------------

export type AdoptionStatusFacts = {
  readonly status: Exclude<AdoptionStatus, 'none'>;
  readonly basis: MethodBasis;
  readonly nitrosamineAnalytes: readonly string[];
};

/**
 * Decision 36 §4: verification is for a compendial Method, and the basic compendial status never
 * covers nitrosamine Analytes. An in-house or alternative Method is validated here or transferred in.
 */
export function adoptionStatusGate(f: AdoptionStatusFacts): GateResult {
  const verifiedKind = f.status === 'verified' || f.status === 'verified-basic-compendial';
  const [first, ...rest] = f.nitrosamineAnalytes;
  return result([
    ...(verifiedKind && f.basis !== 'compendial' ? [{ code: 'adoption-status-for-basis', status: f.status, basis: f.basis } as const] : []),
    ...(f.status === 'verified-basic-compendial' && first !== undefined ? [{ code: 'basic-compendial-nitrosamine', analytes: [first, ...rest] } as const] : []),
  ]);
}

/** Decision 12: a GMP Test is accepted only on a qualified Method Adoption in this Lab. */
export function acceptanceGate(f: AcceptanceFacts): GateResult {
  return result(f.gxpClass === 'GMP' && !QUALIFIED.has(f.adoption) ? [{ code: 'method-adoption', status: f.adoption }] : []);
}

/**
 * Decision 12: Ready once Accepted (the machine's cell) and the Sample is Received, re-checking the
 * Adoption for a GMP Test. test.accept and sample.receive both call it; whichever completes it moves
 * the Test.
 */
export function readyGate(f: ReadyFacts): GateResult {
  const notReceived: Reasons = f.sampleReceived ? [] : [{ code: 'sample-not-received' }];
  const adoption = acceptanceGate(f);
  return result([...notReceived, ...(adoption.go ? [] : adoption.reasons)]);
}

/** Decision 12: cancelled only before any Preparation or Run is linked. */
export function cancelGate(f: CancelFacts): GateResult {
  return result(f.preparations > 0 || f.runs > 0 ? [{ code: 'work-linked', test: f.test }] : []);
}

/** Decision 19 §4: the four conditions, no override, every Test GMP or not. */
export function assignmentGate(analyst: AnalystFacts): GateResult {
  return result([
    ...(analyst.holdsAnalystRole ? [] : [{ code: 'role-not-held' as const, role: 'Analyst' as const }]),
    ...performerReasons(analyst),
  ]);
}

/** Ineligible Analysts are not offered (decision 19 §4): the picker is the gate as a filter. */
export function eligibleAnalysts<A extends AnalystFacts>(candidates: readonly A[]): readonly A[] {
  return candidates.filter((c) => assignmentGate(c).go);
}

/** Decision 19 §4 and decision 13; the database refuses the same two SoD cases (LS001, LS002). */
export function verifiedGate(f: VerifiedFacts): GateResult {
  const me = f.signer.person;
  return result([
    ...authorisation(f.signer.authorisations),
    ...enablement(f.signer.signing),
    ...f.values.flatMap((v): Reasons => [
      ...(v.authors.includes(me) ? [sod('verifier-entered-value', v.label)] : []),
      ...(v.proposer === me ? [sod('self-approval', v.label)] : []),
    ]),
  ]);
}

/** Decisions 19 and 20: the acquirer signs, every value is in and Verified, the instrument is In use, every Run Check passes. */
export function runPerformedGate(f: RunPerformedFacts): GateResult {
  return result([
    ...performerReasons(f.signer),
    ...(f.isAcquirer ? [] : [{ code: 'not-acquirer' as const, run: f.run }]),
    ...each(f.missingValues, (field) => ({ code: 'value-missing', field })),
    ...each(f.unverifiedValues, (value) => ({ code: 'not-verified', value })),
    ...each(f.pendingChanges, (value) => ({ code: 'change-pending', value })),
    ...(f.equipment.fitness === 'In use' ? [] : [{ code: 'equipment-not-in-use' as const, equipment: f.equipment.code, status: f.equipment.fitness }]),
    ...f.runChecks.flatMap(({ check, outcome }): Reasons => {
      switch (outcome.kind) {
        case 'not-recorded': return [{ code: 'run-check-missing', check }];
        case 'not-built': return [notBuilt('computed-run-check', `Run Check ${check} is an ${outcome.statistic} the LIMS computes`)];
        case 'criterion-coarser-than-export':
        case 'export-coarser-than-criterion':
          return [{ code: 'criterion-misconfigured', check, problem: outcome.kind, valueDecimals: outcome.valueDecimals, limitDecimals: outcome.limitDecimals, source: outcome.source }];
        case 'judged': {
          if (outcome.conforms) return [];
          const failed = outcome.comparisons.find((c) => !c.within)!;
          return [notBuilt('deviation-workflow', `Run Check ${check} does not conform (${formatWritten(failed.compared)} against ${criterionText(outcome)})`)];
        }
      }
    }),
  ]);
}

const noRun = (test: string): GateReason => ({ code: 'no-run-linked', test });

/** Decisions 12, 19, 20 and 29: the assignee signs after every feeding Run (usp 2: at least one), and no Preparation or Reportable Result fails. */
export function testPerformedGate(f: TestPerformedFacts): GateResult {
  return result([
    ...performerReasons(f.signer),
    ...(f.isAssignee ? [] : [{ code: 'not-assignee' as const, test: f.test }]),
    ...each(f.valuesByOthers, (value) => notBuilt('split-performed-signing', `${value} was typed by another Analyst`)),
    ...each(f.missingValues, (field) => ({ code: 'value-missing', field })),
    ...each(f.unverifiedValues, (value) => ({ code: 'not-verified', value })),
    ...each(f.pendingChanges, (value) => ({ code: 'change-pending', value })),
    ...(f.runs.length === 0 ? [noRun(f.test)] : []),
    ...f.runs.flatMap((r): Reasons => (r.performedStands ? [] : [{ code: 'unsigned-dependency', record: r.run, needs: 'Performed' }])),
    ...f.balances.flatMap((b): Reasons => (b.equipment.fitness === 'In use' ? [] : [{ code: 'equipment-not-in-use', equipment: `${b.preparation} balance ${b.equipment.code}`, status: b.equipment.fitness }])),
    ...each(f.blockingHolds, (hold) => ({ code: 'open-hold', hold })),
    ...verdictReasons(f.judgement),
  ]);
}

/** Decisions 13, 19 and 20: a Reviewer who signed none of it, over standing Performed work, with the checklist complete. */
export function reviewedGate(f: ReviewedFacts): GateResult {
  return result([
    ...training([f.signer.methodTraining]),
    ...authorisation([f.signer.authorisation]),
    ...enablement(f.signer.signing),
    ...(f.performedSigners.includes(f.signer.person) ? [sod('reviewer-signed-performed', f.record)] : []),
    ...(f.performedStands ? [] : [{ code: 'unsigned-dependency' as const, record: f.record, needs: 'Performed' as const }]),
    ...(f.kind === 'test' && f.feedingRuns.length === 0 ? [noRun(f.record)] : []),
    ...f.feedingRuns.flatMap((r): Reasons => (r.reviewedStands ? [] : [{ code: 'unsigned-dependency', record: r.run, needs: 'Reviewed' }])),
    ...each(f.pendingChanges, (value) => ({ code: 'change-pending', value })),
    ...each(f.blockingHolds, (hold) => ({ code: 'open-hold', hold })),
    ...unticked(f.checklist),
  ]);
}

/**
 * Decisions 12, 13 and 29: every Test's current version carries standing Performed and Reviewed
 * signatures, no Hold is open, no change is pending on a value the release would lock, QA worked
 * on none of it, and QA confirmed every verdict.
 */
export function releasedGate(f: ReleasedFacts): GateResult {
  const me = f.signer.person;
  return result([
    ...authorisation([f.signer.authorisation]),
    ...authorisation([f.signer.conformityAuthorisation]),
    ...enablement(f.signer.signing),
    ...f.tests.flatMap((t): Reasons => [
      ...(t.performedStands ? [] : [{ code: 'unsigned-dependency' as const, record: t.test, needs: 'Performed' as const }]),
      ...(t.reviewedStands ? [] : [{ code: 'unsigned-dependency' as const, record: t.test, needs: 'Reviewed' as const }]),
      ...(t.hasRun ? [] : [noRun(t.test)]),
      ...(t.performedBy.includes(me) ? [sod('releaser-performed', t.test)] : []),
      ...(t.reviewedBy.includes(me) ? [sod('releaser-reviewed', t.test)] : []),
      ...each(t.blockingHolds, (hold) => ({ code: 'open-hold', hold })),
      ...each(t.pendingChanges, (value) => ({ code: 'change-pending', value })),
      ...t.verdicts.flatMap(({ jurisdiction, confirmation }): Reasons =>
        confirmation === 'confirmed' ? []
        : confirmation === 'none' ? [{ code: 'verdict-not-confirmed', test: t.test, jurisdiction }]
        : [notBuilt('deviation-workflow', `QA disagrees with the ${jurisdiction} verdict on ${t.test}`)]),
    ]),
    ...unticked(f.checklist),
  ]);
}

/** A closed gate as the Refusal the rail prints. */
export const toRefusal = (gate: Extract<GateResult, { go: false }>): Refusal =>
  ({ kind: 'gate', reasons: gate.reasons, message: describeReasons(gate.reasons) });

// ---------------------------------------------------------------------------------------------

const sod = (rule: SodRule, subject: string): GateReason => ({ code: 'separation-of-duties', rule, subject });
const notBuilt = (feature: NotBuilt, because: string): GateReason => ({ code: 'not-built', feature, because });

function criterionText(v: Extract<RunCheckOutcome, { kind: 'judged' }>): string {
  const [first, second] = v.comparisons;
  return second
    ? `${formatWritten(first.limit)}–${formatWritten(second.limit)}`
    : `${first.op} ${formatWritten(first.limit)}`;
}

/**
 * Decision 29: a failing Preparation opens OOS even when the mean passes; so does a failing
 * Reportable Result. Variability over its limit blocks the Reportable Result and opens a Deviation.
 */
function verdictReasons(j: TestJudgement): Reasons {
  if (j.kind === 'result-missing') return [{ code: 'value-missing', field: `${j.analyte} result` }];
  const variability = j.variability.flatMap((v): Reasons => {
    switch (v.kind) {
      case 'missing': return [{ code: 'variability-not-computed', analyte: v.analyte, because: v.because }];
      case 'not-built': return [notBuilt('variability-statistic', `the Method's variability is an ${v.statistic} limit`)];
      case 'judged': return v.pairs.filter((p) => !p.within).map((p) => notBuilt('deviation-workflow',
        `the variability between Preparations ${pairLabel(j, p.preparations)} does not conform: ${v.analyte} ${formatWritten(p.compared)} % against NMT ${formatWritten(v.limit)} %`));
    }
  });
  return [...variability, ...j.sections.flatMap((s) => {
    const against = (l: LineVerdict) =>
      `${l.analyte} ${formatWritten(l.compared)} ppm against ${s.jurisdiction} NMT ${formatWritten(l.limit)} ppm`;
    return [
      ...s.reportable.flatMap((l) => (l.kind === 'judged' && !l.conforms
        ? [notBuilt('deviation-workflow', `the Reportable Result does not conform: ${against(l)}`)] : [])),
      ...s.preparations.flatMap((p, i) => p.lines.filter((l) => !l.conforms)
        .map((l) => notBuilt('deviation-workflow', `Preparation ${i + 1} does not conform: ${against(l)}`))),
    ];
  })];
}

/** Preparations are numbered in the order the Test lists them, as the rail shows them. */
function pairLabel(j: Extract<TestJudgement, { kind: 'judged' }>, pair: readonly [PreparationId, PreparationId]): string {
  const order = j.sections[0].preparations.map((p) => p.preparation);
  return `${order.indexOf(pair[0]) + 1} and ${order.indexOf(pair[1]) + 1}`;
}
