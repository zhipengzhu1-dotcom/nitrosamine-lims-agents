// Every way the server says no, as values. The server renders each message; the UI prints it and
// never writes consequence text of its own (decision 23 rule 18).

import type { AdoptionStatus, AuthorisationStanding, EnablementStep, FitnessStatus, MethodBasis, TrainingStanding } from './gates.ts';
import type { VersionId } from './ids.ts';
import type { Actor, Machine, Role, TransitionResult } from './machines.ts';
import type { NonEmpty } from './nonempty.ts';
import type { Meaning } from './signing.ts';
import type { CriterionSource, Jurisdiction } from './verdict.ts';

export type NotBuilt =
  | 'deviation-workflow' // a failing Run Check, Preparation or Reportable Result, or QA disagreeing with a verdict
  | 'split-performed-signing' // Performed after a reassignment, each Analyst signing their own entries
  | 'variability-statistic' // a Method variability statistic other than the relative difference of a pair
  | 'computed-run-check' // a Run Check statistic the LIMS computes from raw values (#37 §4)
  | 'hold-release' | 'amended-report' | 'invalidation' | 'non-gmp-marking' | 'raise-to-gmp' | 'retest'
  | 'receipt-discrepancy' | 'sample-return' | 'sample-disposal'
  | 'import' | 'passkey' | 'anchoring' | 'below-loq-reporting' | 'multiple-nitrosamine-sum' | 'basis-correction';

export type SodRule =
  | 'reviewer-signed-performed' // on the record or a Run feeding it
  | 'verifier-entered-value' // any version of the value (LS002, strict)
  | 'self-approval' // the pending change the signature would approve (LS001)
  | 'releaser-performed' // an Analyst on any Test in the report, or a Run feeding it
  | 'releaser-reviewed'; // a Reviewer of any Test in the report, or a Run feeding it

export type GateReason =
  | { readonly code: 'training'; readonly standing: Exclude<TrainingStanding, { kind: 'current' }> }
  | { readonly code: 'authorisation'; readonly standings: NonEmpty<Exclude<AuthorisationStanding, { kind: 'current' }>> }
  | { readonly code: 'signing-not-enabled'; readonly missingSteps: NonEmpty<EnablementStep> }
  | { readonly code: 'role-not-held'; readonly role: Role }
  | { readonly code: 'separation-of-duties'; readonly rule: SodRule; readonly subject: string }
  | { readonly code: 'not-assignee'; readonly test: string }
  | { readonly code: 'not-acquirer'; readonly run: string }
  | { readonly code: 'value-missing'; readonly field: string }
  | { readonly code: 'not-verified'; readonly value: string }
  | { readonly code: 'change-pending'; readonly value: string }
  | { readonly code: 'unsigned-dependency'; readonly record: string; readonly needs: Meaning }
  | { readonly code: 'run-check-missing'; readonly check: string }
  | {
      readonly code: 'criterion-misconfigured'; readonly check: string;
      readonly problem: 'criterion-coarser-than-export' | 'export-coarser-than-criterion';
      readonly valueDecimals: number; readonly limitDecimals: number; readonly source: CriterionSource;
    }
  | { readonly code: 'variability-not-computed'; readonly analyte: string; readonly because: 'one-preparation' | 'zero-mean' }
  | { readonly code: 'equipment-not-in-use'; readonly equipment: string; readonly status: FitnessStatus }
  | { readonly code: 'open-hold'; readonly hold: string }
  | { readonly code: 'checklist-incomplete'; readonly items: NonEmpty<string> }
  | { readonly code: 'verdict-not-confirmed'; readonly test: string; readonly jurisdiction: Jurisdiction }
  | { readonly code: 'method-adoption'; readonly status: AdoptionStatus }
  | { readonly code: 'adoption-status-for-basis'; readonly status: 'verified' | 'verified-basic-compendial'; readonly basis: Exclude<MethodBasis, 'compendial'> }
  | { readonly code: 'basic-compendial-nitrosamine'; readonly analytes: NonEmpty<string> }
  | { readonly code: 'sample-not-received' }
  | { readonly code: 'work-linked'; readonly test: string }
  | {
      readonly code: 'limit-not-derived'; readonly jurisdiction: Jurisdiction; readonly analyte: string;
      readonly limit: string; readonly derived: string; readonly acceptableIntake: string; readonly maximumDailyDose: string;
    }
  | { readonly code: 'not-built'; readonly feature: NotBuilt; readonly because: string };

export type Refusal =
  | { readonly kind: 'session'; readonly state: 'none' | 'locked' | 'ended'; readonly message: string }
  | { readonly kind: 'not-permitted'; readonly message: string }
  | { readonly kind: 'gate'; readonly reasons: NonEmpty<GateReason>; readonly message: string }
  | { readonly kind: 'transition'; readonly message: string }
  | { readonly kind: 'stale-version'; readonly shown: VersionId; readonly current: VersionId | null; readonly message: string }
  | { readonly kind: 'credentials'; readonly attemptsLeft: number; readonly message: string }
  | { readonly kind: 'locked-out'; readonly message: string }
  | { readonly kind: 'totp-already-used'; readonly message: string }
  | { readonly kind: 'wrong-user'; readonly message: string }
  | { readonly kind: 'not-built'; readonly feature: NotBuilt; readonly message: string }
  | { readonly kind: 'commit-key-reused'; readonly message: string };

/** The words for each out-of-slice refusal. Each such refusal is also written as a spec_gap row. */
export const NOT_BUILT_MESSAGE: { readonly [F in NotBuilt]: string } = {
  'deviation-workflow': 'Deviation workflow not built in the skeleton',
  'split-performed-signing': 'Signing Performed after a reassignment not built in the skeleton',
  'variability-statistic': 'Variability statistics other than the relative difference of two Preparations not built in the skeleton',
  'computed-run-check': 'Run Checks the LIMS computes from raw values not built in the skeleton',
  'hold-release': 'Hold release not built in the skeleton',
  'amended-report': 'Amended Reports not built in the skeleton',
  'invalidation': 'Invalidation not built in the skeleton',
  'non-gmp-marking': 'Non-GMP Tests not built in the skeleton',
  'raise-to-gmp': 'Raising a Test to GMP not built in the skeleton',
  'retest': 'Retests not built in the skeleton',
  'receipt-discrepancy': 'Receipt with a discrepancy not built in the skeleton',
  'sample-return': 'Returning a Sample to the Customer not built in the skeleton',
  'sample-disposal': 'Sample disposal not built in the skeleton',
  'import': 'Instrument import not built in the skeleton; use typed entry',
  'passkey': 'Passkeys not built in the skeleton; use a code from your authenticator app',
  'anchoring': 'Off-server anchoring of the audit chain not built in the skeleton',
  'below-loq-reporting': 'Results below the LOQ not built in the skeleton',
  'multiple-nitrosamine-sum': 'Multiple-nitrosamine sums not built in the skeleton',
  'basis-correction': 'Basis correction not built in the skeleton',
};

const ROLE_LABEL: { readonly [A in Actor]: string } = {
  CustomerUser: 'a Customer User', SampleCustodian: 'the Sample Custodian', LabManager: 'the Lab Manager',
  Analyst: 'an Analyst', Reviewer: 'a Reviewer', QA: 'QA', assignee: 'the assigned Analyst', system: 'the system',
};

const STEP_LABEL: { readonly [S in EnablementStep]: string } = {
  'identity-check': "the Admin's identity check",
  'policy-acknowledged': 'Acknowledged on the e-signature policy',
  'lims-use-training': 'LIMS-use training for the role',
};

const ADOPTION_LABEL: { readonly [A in AdoptionStatus]: string } = {
  'in-development': 'in development', 'validated-here': 'validated here', 'transferred-in': 'transferred in',
  'verified': 'verified', 'verified-basic-compendial': 'verified (basic compendial)', 'retired': 'retired',
  'none': 'missing',
};

const SOD_SENTENCE: { readonly [R in SodRule]: (subject: string) => string } = {
  'reviewer-signed-performed': (s) => `You signed ${s} or a Run feeding it Performed, so someone else must review it.`,
  'verifier-entered-value': (s) => `You entered ${s}, so someone else must verify it.`,
  'self-approval': (s) => `You proposed the change to ${s}, so someone else must approve it.`,
  'releaser-performed': (s) => `You worked as an Analyst on ${s} or a Run feeding it, so you can't release this report.`,
  'releaser-reviewed': (s) => `You reviewed ${s} or a Run feeding it, so you can't release this report.`,
};

const orList = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;
const andList = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

function authorisationPhrase(a: Exclude<AuthorisationStanding, { kind: 'current' }>): string {
  switch (a.kind) {
    case 'missing': return `no ${a.meaning} Authorisation for ${a.scope}`;
    case 'expired': return `the ${a.meaning} Authorisation for ${a.scope} expired on ${a.validUntil}`;
    case 'suspended': return `the ${a.meaning} Authorisation for ${a.scope} is suspended`;
  }
}

const decimals = (n: number): string => `${n} ${n === 1 ? 'decimal' : 'decimals'}`;

/**
 * GN 7.10: a compendial criterion keeps its printed decimals, so only the export can move. The lab's
 * own criterion may instead be written to the export's decimals, in a new version of what it cites.
 */
function mismatchSentence(r: Extract<GateReason, { code: 'criterion-misconfigured' }>): string {
  const setExport = `set the instrument's export to ${decimals(r.limitDecimals)}`;
  const head = `Run Check ${r.check} can't be judged`;
  if (r.source.kind === 'compendial') {
    return `${head}: ${r.source.citation} prints its criterion to ${decimals(r.limitDecimals)} and the value has ${decimals(r.valueDecimals)}. ${capitalise(setExport)}; the criterion keeps its printed decimals.`;
  }
  const cites = r.source.kind === 'method' ? r.source.methodVersion : r.source.sopVersion;
  return `${head}: its criterion is written to ${decimals(r.limitDecimals)} and the value has ${decimals(r.valueDecimals)}. Either write the criterion to ${decimals(r.valueDecimals)} in a new version (it cites ${cites}), or ${setExport}.`;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One sentence per reason, server-side. */
export function describeReason(r: GateReason): string {
  switch (r.code) {
    case 'training':
      return r.standing.kind === 'missing'
        ? `No current Training Record on ${r.standing.documentVersion}.`
        : `The Training Record on ${r.standing.documentVersion} is superseded by ${r.standing.by}.`;
    case 'authorisation': {
      const [only, ...more] = r.standings;
      return more.length === 0
        ? `${capitalise(authorisationPhrase(only))}.`
        : `Needs a current ${orList(r.standings.map((a) => a.meaning))} Authorisation: ${andList(r.standings.map(authorisationPhrase))}.`;
    }
    case 'signing-not-enabled': return `Signing is not enabled yet: ${andList(r.missingSteps.map((s) => STEP_LABEL[s]))} still needed.`;
    case 'role-not-held': return `Doesn't hold the ${r.role} role in this Lab.`;
    case 'separation-of-duties': return SOD_SENTENCE[r.rule](r.subject);
    case 'not-assignee': return `${r.test} is assigned to another Analyst.`;
    case 'not-acquirer': return `Only the Analyst who acquired ${r.run} signs it Performed.`;
    case 'value-missing': return `${capitalise(r.field)} has no value.`;
    case 'not-verified': return `${capitalise(r.value)} is not Verified.`;
    case 'change-pending': return `${capitalise(r.value)} has a change waiting for approval.`;
    case 'unsigned-dependency': return `${r.record} has no standing ${r.needs} signature.`;
    case 'run-check-missing': return `Run Check ${r.check} is not recorded.`;
    case 'criterion-misconfigured': return mismatchSentence(r);
    case 'variability-not-computed':
      return r.because === 'one-preparation'
        ? `The variability between Preparations can't be computed for ${r.analyte}: it needs at least two Preparations.`
        : `The variability between Preparations can't be computed for ${r.analyte}: the Preparations' mean is zero.`;
    case 'equipment-not-in-use': return `${r.equipment} is ${r.status}, not In use.`;
    case 'open-hold': return `Hold ${r.hold} is open.`;
    case 'checklist-incomplete': return `The Review Checklist is not complete: ${andList(r.items.map((i) => `"${i}"`))} not ticked.`;
    case 'verdict-not-confirmed': return `Confirm or disagree with the ${r.jurisdiction} verdict on ${r.test}.`;
    case 'method-adoption': return `The Method Adoption in this Lab is ${ADOPTION_LABEL[r.status]}; a GMP Test needs it validated here, verified or transferred in.`;
    case 'adoption-status-for-basis':
      return `${r.basis === 'in-house' ? 'An in-house' : 'An alternative'} Method can't be adopted as ${ADOPTION_LABEL[r.status]}: verification is only for a compendial Method. Adopt it as validated here or transferred in.`;
    case 'basic-compendial-nitrosamine': return `A Method with nitrosamine Analytes (${andList(r.analytes)}) is never verified (basic compendial).`;
    case 'sample-not-received': return 'The Sample has not been received.';
    case 'work-linked': return `${r.test} has a Preparation or Run linked, so it can't be cancelled.`;
    case 'limit-not-derived':
      return `The ${r.jurisdiction} limit for ${r.analyte} is written ${r.limit} ppm, but ${r.acceptableIntake} ng/day ÷ ${r.maximumDailyDose} mg/day rounded down to ${decimals(r.limit.split('.')[1]?.length ?? 0)} is ${r.derived} ppm.`;
    case 'not-built': return `${NOT_BUILT_MESSAGE[r.feature]}: ${r.because}.`;
  }
}

export const describeReasons = (reasons: readonly GateReason[]): string => reasons.map(describeReason).join(' ');

/** The features a refusal logs as spec_gap rows, once each. */
export function specGapsOf(r: Refusal): readonly NotBuilt[] {
  if (r.kind === 'not-built') return [r.feature];
  if (r.kind !== 'gate') return [];
  return [...new Set(r.reasons.flatMap((reason) => (reason.code === 'not-built' ? [reason.feature] : [])))];
}

export const refuse = {
  session: (state: 'none' | 'locked' | 'ended'): Refusal => ({
    kind: 'session', state,
    message: { none: 'Sign in to continue.', locked: 'This session is locked. Unlock it to continue.', ended: 'This session has ended. Sign in again.' }[state],
  }),
  notPermitted: (role: Role): Refusal => ({ kind: 'not-permitted', message: `This needs the ${role} role in this Lab.` }),
  transition: <S extends string, E extends string, N extends string>(
    m: Machine<S, E, N>, record: string, t: NoInfer<Exclude<TransitionResult<S, E>, { ok: true }>>,
  ): Refusal => {
    switch (t.refusal) {
      case 'not-built': return refuse.notBuilt(t.feature);
      case 'not-from-this-state':
        return { kind: 'transition', message: `Can't ${m.events[t.event]} ${record}: it is ${m.states[t.from]}.` };
      case 'not-this-actor':
        return { kind: 'transition', message: `Only ${orList(t.allowed.map((a) => ROLE_LABEL[a]))} can ${m.events[t.event]} ${record}.` };
    }
  },
  staleVersion: (record: string, shown: VersionId, current: VersionId | null): Refusal => ({
    kind: 'stale-version', shown, current,
    message: `${record} changed after this prompt opened. Close it and sign the current version.`,
  }),
  credentials: (attemptsLeft: number): Refusal => ({
    kind: 'credentials', attemptsLeft,
    message: `The user ID, password or code is wrong. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left before the account locks.`,
  }),
  lockedOut: (): Refusal => ({
    kind: 'locked-out',
    message: 'The account is locked after 5 failed attempts. QA and the Admin have been alerted; an Admin must unlock it.',
  }),
  totpAlreadyUsed: (): Refusal => ({ kind: 'totp-already-used', message: 'Wait for the next code.' }),
  wrongUser: (): Refusal => ({
    kind: 'wrong-user',
    message: "That user ID isn't the signed-in person's. Sign with your own, or use Switch user. QA and the Admin have been alerted.",
  }),
  notBuilt: (feature: NotBuilt): Refusal => ({ kind: 'not-built', feature, message: NOT_BUILT_MESSAGE[feature] }),
  commitKeyReused: (): Refusal => ({
    kind: 'commit-key-reused',
    message: 'This request was already made with different details. Start again from the current screen.',
  }),
};
