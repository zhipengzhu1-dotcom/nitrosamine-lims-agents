import { describe, expect, it } from 'vitest';
import { toRefusal } from '../src/gates.ts';
import type { VersionId } from '../src/ids.ts';
import { TestMachine, transition } from '../src/machines.ts';
import { NOT_BUILT_MESSAGE, describeReason, refuse, specGapsOf, type GateReason, type NotBuilt } from '../src/refusal.ts';

describe('the not-built catalogue', () => {
  it('prints the fixed words for a failing Run Check, Preparation or verdict disagreement', () => {
    expect(NOT_BUILT_MESSAGE['deviation-workflow']).toBe('Deviation workflow not built in the skeleton');
    expect(refuse.notBuilt('deviation-workflow'))
      .toEqual({ kind: 'not-built', feature: 'deviation-workflow', message: 'Deviation workflow not built in the skeleton' });
  });

  it('says "not built in the skeleton" for every feature', () => {
    for (const message of Object.values(NOT_BUILT_MESSAGE)) expect(message).toMatch(/ not built in the skeleton/);
  });
});

const COMPENDIAL = { kind: 'compendial', citation: 'USP <621>' } as const;
const MISMATCHES: readonly GateReason[] = [
  { code: 'criterion-misconfigured', check: 'S/N', problem: 'criterion-coarser-than-export', valueDecimals: 1, limitDecimals: 0, source: COMPENDIAL },
  { code: 'criterion-misconfigured', check: 'S/N', problem: 'export-coarser-than-criterion', valueDecimals: 0, limitDecimals: 1, source: COMPENDIAL },
  { code: 'criterion-misconfigured', check: 'CCV recovery', problem: 'criterion-coarser-than-export', valueDecimals: 2, limitDecimals: 1, source: { kind: 'method', methodVersion: 'NA-LCMS-001 v3' } },
  { code: 'criterion-misconfigured', check: 'CCV recovery', problem: 'export-coarser-than-criterion', valueDecimals: 0, limitDecimals: 1, source: { kind: 'sop', sopVersion: 'SOP-QA-010 v1' } },
];

describe('a criterion whose decimals differ from the export (GN 7.10, #37 §4)', () => {
  const [compendialCoarser, compendialFiner, methodCoarser, sopFiner] = MISMATCHES.map(describeReason);

  it('tells the user to set the export to a compendial criterion\'s printed decimals, never to rewrite the criterion', () => {
    for (const m of [compendialCoarser!, compendialFiner!]) {
      expect(m).toMatch(/USP <621>/);
      expect(m).toMatch(/Set the instrument's export to/);
      expect(m).not.toMatch(/new .*version|write the criterion|correct/i);
    }
    expect(compendialCoarser).toMatch(/export to 0 decimals/);
    expect(compendialFiner).toMatch(/export to 1 decimal\b/);
  });

  it('offers either change for the lab\'s own criterion, naming the version that would change', () => {
    expect(methodCoarser).toMatch(/write the criterion to 2 decimals in a new version \(it cites NA-LCMS-001 v3\)/);
    expect(methodCoarser).toMatch(/or set the instrument's export to 1 decimal\b/);
    expect(sopFiner).toMatch(/write the criterion to 0 decimals in a new version \(it cites SOP-QA-010 v1\)/);
    expect(sopFiner).toMatch(/or set the instrument's export to 1 decimal\b/);
  });
});

describe('a gate refusal', () => {
  const reasons: readonly [GateReason, ...GateReason[]] = [
    { code: 'not-verified', value: 'Preparation 1 weight' },
    { code: 'not-built', feature: 'deviation-workflow', because: 'Run Check S/N at the LOQ standard does not conform (8.7 against NLT 10.0)' },
    { code: 'not-built', feature: 'deviation-workflow', because: 'Run Check CCV recovery does not conform (78.2 against 80.0–120.0)' },
  ];

  it('prints one sentence per reason, server-side', () => {
    const r = toRefusal({ go: false, reasons });
    expect(r.kind).toBe('gate');
    expect(r.message).toBe([
      'Preparation 1 weight is not Verified.',
      'Deviation workflow not built in the skeleton: Run Check S/N at the LOQ standard does not conform (8.7 against NLT 10.0).',
      'Deviation workflow not built in the skeleton: Run Check CCV recovery does not conform (78.2 against 80.0–120.0).',
    ].join(' '));
  });

  it('logs each not-built feature once as a spec gap', () => {
    expect(specGapsOf(toRefusal({ go: false, reasons }))).toEqual(['deviation-workflow']);
    expect(specGapsOf(refuse.notBuilt('import'))).toEqual(['import']);
    expect(specGapsOf(refuse.totpAlreadyUsed())).toEqual([]);
  });

  it('has a sentence for every reason code', () => {
    const every: readonly GateReason[] = [
      { code: 'training', standing: { kind: 'missing', documentVersion: 'M v3' } },
      { code: 'training', standing: { kind: 'superseded', documentVersion: 'M v2', by: 'M v3' } },
      { code: 'authorisation', standings: [{ kind: 'expired', meaning: 'Performed', scope: 'M', validUntil: '2026-09-01' }] },
      { code: 'authorisation', standings: [{ kind: 'missing', meaning: 'Performed', scope: 'M' }, { kind: 'suspended', meaning: 'Reviewed', scope: 'M' }] },
      { code: 'signing-not-enabled', missingSteps: ['identity-check', 'lims-use-training'] },
      { code: 'role-not-held', role: 'Analyst' },
      { code: 'separation-of-duties', rule: 'reviewer-signed-performed', subject: 'T1' },
      { code: 'separation-of-duties', rule: 'verifier-entered-value', subject: 'w' },
      { code: 'separation-of-duties', rule: 'self-approval', subject: 'w' },
      { code: 'separation-of-duties', rule: 'releaser-performed', subject: 'T1' },
      { code: 'separation-of-duties', rule: 'releaser-reviewed', subject: 'T1' },
      { code: 'not-assignee', test: 'T1' },
      { code: 'not-acquirer', run: 'R1' },
      { code: 'value-missing', field: 'w' },
      { code: 'not-verified', value: 'w' },
      { code: 'change-pending', value: 'w' },
      { code: 'unsigned-dependency', record: 'R1', needs: 'Performed' },
      { code: 'run-check-missing', check: 'S/N' },
      ...MISMATCHES,
      { code: 'variability-not-computed', analyte: 'NDMA', because: 'one-preparation' },
      { code: 'variability-not-computed', analyte: 'NDMA', because: 'zero-mean' },
      { code: 'equipment-not-in-use', equipment: 'LCMS-02', status: 'Suspended' },
      { code: 'open-hold', hold: 'HOLD-7' },
      { code: 'checklist-incomplete', items: ['LIMS audit trail reviewed'] },
      { code: 'verdict-not-confirmed', test: 'T1', jurisdiction: 'FDA' },
      { code: 'method-adoption', status: 'in-development' },
      { code: 'sample-not-received' },
      { code: 'work-linked', test: 'T1' },
      { code: 'not-built', feature: 'split-performed-signing', because: 'w was typed by someone else' },
    ];
    for (const reason of every) expect(describeReason(reason)).toMatch(/^[A-Z"].*\.$/);
    const distinct = new Set(every.map(describeReason));
    expect(distinct.size).toBe(every.length);
  });
});

describe('the other refusals', () => {
  it('asks for the next code when a TOTP step was already used', () => {
    expect(refuse.totpAlreadyUsed()).toEqual({ kind: 'totp-already-used', message: 'Wait for the next code.' });
  });

  it('renders a transition refusal from the machine\'s own labels', () => {
    const wrongState = transition(TestMachine, 'InProgress', 'assign', 'LabManager');
    const wrongActor = transition(TestMachine, 'Ready', 'assign', 'Analyst');
    const notBuilt = transition(TestMachine, 'Reviewed', 'invalidate', 'QA');
    if (wrongState.ok || wrongActor.ok || notBuilt.ok) throw new Error('expected refusals');
    expect(refuse.transition(TestMachine, 'RD-S-2026-000123/T1', wrongState).message)
      .toBe("Can't assign RD-S-2026-000123/T1: it is In Progress.");
    expect(refuse.transition(TestMachine, 'RD-S-2026-000123/T1', wrongActor).message)
      .toBe('Only the Lab Manager can assign RD-S-2026-000123/T1.');
    expect(refuse.transition(TestMachine, 'RD-S-2026-000123/T1', notBuilt))
      .toEqual(refuse.notBuilt('invalidation'));
  });

  it('carries the version shown and the one current now when the record moved', () => {
    const r = refuse.staleVersion('RUN-2026-0042', 'v1' as VersionId, 'v2' as VersionId);
    expect(r).toMatchObject({ kind: 'stale-version', shown: 'v1', current: 'v2' });
  });

  it('counts down the attempts left before lockout', () => {
    expect(refuse.credentials(1).message).toMatch(/1 attempt left/);
    expect(refuse.credentials(3).message).toMatch(/3 attempts left/);
  });

  it.each(['none', 'locked', 'ended'] as const)('names the session state %s', (state) => {
    expect(refuse.session(state)).toMatchObject({ kind: 'session', state });
  });

  it('has a message for every not-built feature', () => {
    const features = Object.keys(NOT_BUILT_MESSAGE) as NotBuilt[];
    for (const f of features) expect(refuse.notBuilt(f).message).toBe(NOT_BUILT_MESSAGE[f]);
  });
});
