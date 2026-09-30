import { describe, expect, it } from 'vitest';
import {
  ACTORS, SampleMachine, TestMachine, TestReportMachine, runState, submissionState, transition,
  type Machine, type TestState,
} from '../src/machines.ts';

// Decision 12's edges, written out by hand: "from event to by… [reason] [signed Meaning]".
// The machine must allow exactly these cells and refuse every other (state, event, actor).
const EXPECTED: { readonly [name: string]: readonly string[] } = {
  test: [
    'Requested accept Accepted SampleCustodian customer-visible',
    'Requested reject Rejected SampleCustodian customer-visible',
    'Accepted becomeReady Ready system action',
    'Ready assign Assigned LabManager action',
    'Assigned reassign Assigned LabManager picklist',
    'InProgress reassign InProgress LabManager picklist',
    'Assigned start InProgress assignee action',
    'InProgress submitForReview SubmittedForReview assignee action Performed',
    'SubmittedForReview review Reviewed Reviewer action Reviewed',
    'SubmittedForReview return InProgress Reviewer picklist',
    'Reviewed reopenAfterChange SubmittedForReview system action',
    'Reviewed report Reported system action',
    'Requested cancel Cancelled LabManager picklist',
    'Requested cancel Cancelled system picklist',
    'Accepted cancel Cancelled LabManager picklist',
    'Accepted cancel Cancelled system picklist',
    'Ready cancel Cancelled LabManager picklist',
    'Ready cancel Cancelled system picklist',
    'Assigned cancel Cancelled LabManager picklist',
    'Assigned cancel Cancelled system picklist',
  ],
  sample: [
    'Expected receive Received SampleCustodian action',
    'Expected rejectAtReceipt RejectedAtReceipt SampleCustodian customer-visible',
    'Received retain Retained system action',
  ],
  test_report: [
    'Draft submitToQa InQaReview Reviewer action',
    'Draft submitToQa InQaReview LabManager action',
    'InQaReview release Released QA action Released',
    'InQaReview return Draft QA picklist',
  ],
};

function allowedCells<S extends string, E extends string, N extends string>(m: Machine<S, E, N>): string[] {
  const cells: string[] = [];
  const states = Object.keys(m.states) as S[];
  const events = [...Object.keys(m.events), ...Object.keys(m.notBuilt)] as (E | N)[];
  for (const from of states) for (const event of events) for (const actor of ACTORS) {
    const t = transition(m, from, event, actor);
    if (t.ok) {
      expect(Object.keys(m.states)).toContain(t.to);
      cells.push([from, event, t.to, actor, t.reason, t.signedAs ?? ''].join(' ').trim());
    }
  }
  return cells;
}

describe.each([TestMachine, SampleMachine, TestReportMachine] as const)('the $name machine', (m) => {
  it('allows exactly the cells decision 12 lists, from every state, for every actor', () => {
    expect(allowedCells(m as Machine<string, string, string>).sort()).toEqual([...EXPECTED[m.name]!].sort());
  });

  it('refuses a not-built event from every state as not built', () => {
    for (const [event, { feature }] of Object.entries(m.notBuilt)) {
      for (const from of Object.keys(m.states)) {
        expect(transition(m as Machine<string, string, string>, from, event, 'LabManager'))
          .toEqual({ ok: false, refusal: 'not-built', feature });
      }
    }
  });
});

describe('transition', () => {
  it('says whether the state or the actor was wrong', () => {
    expect(transition(TestMachine, 'Requested', 'assign', 'LabManager'))
      .toEqual({ ok: false, refusal: 'not-from-this-state', from: 'Requested', event: 'assign' });
    expect(transition(TestMachine, 'Ready', 'assign', 'Analyst'))
      .toEqual({ ok: false, refusal: 'not-this-actor', from: 'Ready', event: 'assign', allowed: ['LabManager'] });
  });
});

describe('submissionState (derived from its Tests)', () => {
  const t = (state: Exclude<TestState, 'Cancelled'>) => ({ state });
  const cancelled = (acceptedBeforeCancel: boolean) => ({ state: 'Cancelled' as const, acceptedBeforeCancel });
  it.each([
    ['a Draft', { submitted: false, cancelled: false, tests: [t('Requested')] }, 'Draft'],
    ['a cancelled Submission', { submitted: true, cancelled: true, tests: [t('Ready')] }, 'Cancelled'],
    ['every Test awaiting Acceptance', { submitted: true, cancelled: false, tests: [t('Requested'), t('Requested')] }, 'Submitted'],
    ['one Test accepted, one waiting', { submitted: true, cancelled: false, tests: [t('Accepted'), t('Requested')] }, 'Accepted'],
    ['one Test accepted, one rejected', { submitted: true, cancelled: false, tests: [t('Rejected'), t('Reported')] }, 'Accepted'],
    ['every Test rejected', { submitted: true, cancelled: false, tests: [t('Rejected'), t('Rejected')] }, 'Rejected'],
    ['a Test accepted, then cancelled', { submitted: true, cancelled: false, tests: [cancelled(true), t('Rejected')] }, 'Accepted'],
    ['rejected or cancelled before Acceptance', { submitted: true, cancelled: false, tests: [cancelled(false), t('Rejected')] }, 'Rejected'],
  ] as const)('%s', (_, facts, expected) => {
    expect(submissionState(facts)).toBe(expected);
  });
});

describe('runState (derived from standing signatures on its effective version)', () => {
  it.each([
    [{ performed: false, reviewed: false }, 'Open'],
    [{ performed: true, reviewed: false }, 'Performed'],
    [{ performed: true, reviewed: true }, 'Reviewed'],
    [{ performed: false, reviewed: true }, 'Open'],
  ] as const)('%o is %s', (standing, expected) => {
    expect(runState(standing)).toBe(expected);
  });
});
