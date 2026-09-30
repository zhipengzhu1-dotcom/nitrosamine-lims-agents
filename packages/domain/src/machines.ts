// Lifecycles as data (decision 12). A machine is a table of cells: from a state, an event, by an
// actor, to a state. Commands name an event, never a target state. Guards are not in the table; they
// are the gates in gates.ts, which commands call with loaded facts.
//
// Stored or derived:
//   Test, Sample, Test Report  stored in place (audited per field), moved only through transition().
//   Submission                 Draft, Submitted and Cancelled stored; Accepted and Rejected derived
//                              from its Tests (submissionState).
//   Run                        derived from the standing signatures on its effective version (runState).

import type { NotBuilt } from './refusal.ts';
import type { Meaning } from './signing.ts';

export type Role = 'CustomerUser' | 'SampleCustodian' | 'LabManager' | 'Analyst' | 'Reviewer' | 'QA';

export type Actor =
  | Role
  | 'assignee' // the Test's assigned Analyst, checked against the row by the command
  | 'system'; // a consequence inside another command's transaction, never a request

export const ACTORS: readonly Actor[] = ['CustomerUser', 'SampleCustodian', 'LabManager', 'Analyst', 'Reviewer', 'QA', 'assignee', 'system'];

/** What the audit entry's Reason for Change is: the action itself, a picklist entry, or one the Customer sees. */
export type Reason = 'action' | 'picklist' | 'customer-visible';

export type Transition<S extends string, E extends string> = {
  readonly from: S;
  readonly event: E;
  readonly to: S;
  readonly by: readonly Actor[];
  readonly reason: Reason;
  readonly signedAs?: Meaning; // the transition is the consequence of this signature
};

export type Machine<S extends string, E extends string, N extends string> = {
  readonly name: string;
  readonly states: { readonly [K in S]: string }; // the label a message prints
  readonly events: { readonly [K in E]: string }; // the verb a message prints
  readonly transitions: readonly Transition<S, E>[];
  /** Events the domain has but the skeleton refuses, each logged as a spec gap. */
  readonly notBuilt: { readonly [K in N]: { readonly feature: NotBuilt; readonly label: string } };
};

export type TestState =
  | 'Requested' | 'Accepted' | 'Rejected' | 'Ready' | 'Assigned' | 'InProgress'
  | 'SubmittedForReview' | 'Reviewed' | 'Reported' | 'Cancelled' | 'Invalidated';

const cancellable = ['Requested', 'Accepted', 'Ready', 'Assigned'] as const;

export const TestMachine = {
  name: 'test',
  states: {
    Requested: 'Requested', Accepted: 'Accepted', Rejected: 'Rejected', Ready: 'Ready', Assigned: 'Assigned',
    InProgress: 'In Progress', SubmittedForReview: 'Submitted for Review', Reviewed: 'Reviewed',
    Reported: 'Reported', Cancelled: 'Cancelled', Invalidated: 'Invalidated',
  },
  events: {
    accept: 'accept', reject: 'reject', becomeReady: 'make Ready', assign: 'assign', reassign: 'reassign',
    start: 'start', submitForReview: 'submit for review', review: 'review', return: 'return',
    reopenAfterChange: 'reopen for review', report: 'report', cancel: 'cancel',
  },
  transitions: [
    { from: 'Requested', event: 'accept', to: 'Accepted', by: ['SampleCustodian'], reason: 'customer-visible' },
    { from: 'Requested', event: 'reject', to: 'Rejected', by: ['SampleCustodian'], reason: 'customer-visible' },
    { from: 'Accepted', event: 'becomeReady', to: 'Ready', by: ['system'], reason: 'action' },
    { from: 'Ready', event: 'assign', to: 'Assigned', by: ['LabManager'], reason: 'action' },
    { from: 'Assigned', event: 'reassign', to: 'Assigned', by: ['LabManager'], reason: 'picklist' },
    { from: 'InProgress', event: 'reassign', to: 'InProgress', by: ['LabManager'], reason: 'picklist' },
    { from: 'Assigned', event: 'start', to: 'InProgress', by: ['assignee'], reason: 'action' },
    { from: 'InProgress', event: 'submitForReview', to: 'SubmittedForReview', by: ['assignee'], reason: 'action', signedAs: 'Performed' },
    { from: 'SubmittedForReview', event: 'review', to: 'Reviewed', by: ['Reviewer'], reason: 'action', signedAs: 'Reviewed' },
    { from: 'SubmittedForReview', event: 'return', to: 'InProgress', by: ['Reviewer'], reason: 'picklist' },
    // An approved Critical Data Change after Reviewed sends the Test back for review (decision 12).
    { from: 'Reviewed', event: 'reopenAfterChange', to: 'SubmittedForReview', by: ['system'], reason: 'action' },
    { from: 'Reviewed', event: 'report', to: 'Reported', by: ['system'], reason: 'action' },
    // Only before any Preparation or Run is linked: the cancel gate checks that. 'system' is a
    // Sample Rejected at receipt cancelling its Tests.
    ...cancellable.map((from) => ({ from, event: 'cancel' as const, to: 'Cancelled' as const, by: ['LabManager', 'system'] as const, reason: 'picklist' as const })),
  ],
  notBuilt: {
    invalidate: { feature: 'invalidation', label: 'invalidate' },
    markNonGmp: { feature: 'non-gmp-marking', label: 'mark non-GMP' },
    raiseToGmp: { feature: 'raise-to-gmp', label: 'raise to GMP' },
    retest: { feature: 'retest', label: 'retest' },
  },
} as const satisfies Machine<TestState, string, string>;

export type SampleState = 'Expected' | 'Received' | 'RejectedAtReceipt' | 'Retained' | 'ReturnedToCustomer' | 'Disposed';

export const SampleMachine = {
  name: 'sample',
  states: {
    Expected: 'Expected', Received: 'Received', RejectedAtReceipt: 'Rejected at receipt', Retained: 'Retained',
    ReturnedToCustomer: 'Returned to Customer', Disposed: 'Disposed',
  },
  events: { receive: 'receive', rejectAtReceipt: 'reject at receipt', retain: 'retain' },
  transitions: [
    { from: 'Expected', event: 'receive', to: 'Received', by: ['SampleCustodian'], reason: 'action' },
    { from: 'Expected', event: 'rejectAtReceipt', to: 'RejectedAtReceipt', by: ['SampleCustodian'], reason: 'customer-visible' },
    { from: 'Received', event: 'retain', to: 'Retained', by: ['system'], reason: 'action' },
  ],
  notBuilt: {
    receiveWithDiscrepancy: { feature: 'receipt-discrepancy', label: 'receive with a discrepancy' },
    returnToCustomer: { feature: 'sample-return', label: 'return to the Customer' },
    dispose: { feature: 'sample-disposal', label: 'dispose of' },
  },
} as const satisfies Machine<SampleState, string, string>;

export type TestReportState = 'Draft' | 'InQaReview' | 'Released' | 'Superseded';

export const TestReportMachine = {
  name: 'test_report',
  states: { Draft: 'Draft', InQaReview: 'In QA Review', Released: 'Released', Superseded: 'Superseded' },
  events: { submitToQa: 'send to QA', release: 'release', return: 'return' },
  transitions: [
    { from: 'Draft', event: 'submitToQa', to: 'InQaReview', by: ['Reviewer', 'LabManager'], reason: 'action' },
    { from: 'InQaReview', event: 'release', to: 'Released', by: ['QA'], reason: 'action', signedAs: 'Released' },
    { from: 'InQaReview', event: 'return', to: 'Draft', by: ['QA'], reason: 'picklist' },
  ],
  notBuilt: { amend: { feature: 'amended-report', label: 'amend' } },
} as const satisfies Machine<TestReportState, string, string>;

export type StateOf<M extends Machine<string, string, string>> = keyof M['states'] & string;
export type EventOf<M extends Machine<string, string, string>> = (keyof M['events'] | keyof M['notBuilt']) & string;

export type TransitionResult<S extends string, E extends string> =
  | { readonly ok: true; readonly to: S; readonly reason: Reason; readonly signedAs: Meaning | null }
  | { readonly ok: false; readonly refusal: 'not-from-this-state'; readonly from: S; readonly event: E }
  | { readonly ok: false; readonly refusal: 'not-this-actor'; readonly from: S; readonly event: E; readonly allowed: readonly Actor[] }
  | { readonly ok: false; readonly refusal: 'not-built'; readonly feature: NotBuilt };

/** Pure. The command applies `to` with an UPDATE, and the capture trigger audits it. */
export function transition<S extends string, E extends string, N extends string>(
  machine: Machine<S, E, N>, from: NoInfer<S>, event: NoInfer<E | N>, actor: Actor,
): TransitionResult<S, E | N> {
  if (Object.hasOwn(machine.notBuilt, event)) return { ok: false, refusal: 'not-built', feature: machine.notBuilt[event as N].feature };
  const cell = machine.transitions.find((t) => t.from === from && t.event === event);
  if (!cell) return { ok: false, refusal: 'not-from-this-state', from, event };
  if (!cell.by.includes(actor)) return { ok: false, refusal: 'not-this-actor', from, event, allowed: cell.by };
  return { ok: true, to: cell.to, reason: cell.reason, signedAs: cell.signedAs ?? null };
}

// ---------------------------------------------------------------------------------------------
// Derived states
// ---------------------------------------------------------------------------------------------

export type SubmissionState = 'Draft' | 'Submitted' | 'Accepted' | 'Rejected' | 'Cancelled';

/** A Cancelled Test's state no longer says whether it was accepted first, so the fact carries it. */
export type SubmissionTestFact =
  | { readonly state: Exclude<TestState, 'Cancelled'> }
  | { readonly state: 'Cancelled'; readonly acceptedBeforeCancel: boolean };

export function submissionState(s: {
  readonly submitted: boolean; readonly cancelled: boolean; readonly tests: readonly SubmissionTestFact[];
}): SubmissionState {
  if (s.cancelled) return 'Cancelled';
  if (!s.submitted) return 'Draft';
  const accepted = (t: SubmissionTestFact) =>
    t.state === 'Cancelled' ? t.acceptedBeforeCancel : t.state !== 'Requested' && t.state !== 'Rejected';
  if (s.tests.some(accepted)) return 'Accepted';
  if (s.tests.some((t) => t.state === 'Requested')) return 'Submitted';
  return 'Rejected';
}

export type RunState = 'Open' | 'Performed' | 'Reviewed';

/** Reviewed counts only over a standing Performed on the same version. */
export function runState(standing: { readonly performed: boolean; readonly reviewed: boolean }): RunState {
  if (!standing.performed) return 'Open';
  return standing.reviewed ? 'Reviewed' : 'Performed';
}
