import { describe, expect, it } from 'vitest';
import { toRational, written } from '../src/decimal.ts';
import {
  acceptanceGate, adoptionStatusGate, assignmentGate, authorisationEndsBy, cancelGate, eligibleAnalysts, readyGate, releasedGate, reviewedGate,
  runPerformedGate, testPerformedGate, toRefusal, verifiedGate,
  type AnalystFacts, type AuthorisationStanding, type GateResult, type PerformerFacts, type ReleasedFacts,
  type ReviewedFacts, type RunPerformedFacts, type TestPerformedFacts, type VerifiedFacts,
} from '../src/gates.ts';
import type { AnalyteKey, PersonId, PreparationId } from '../src/ids.ts';
import { mapNonEmpty, type NonEmpty } from '../src/nonempty.ts';
import type { GateReason } from '../src/refusal.ts';
import { judgeRunCheck, judgeTest, type ExportedRunCheck, type VariabilityCriterion } from '../src/verdict.ts';

const ana = 'ana' as PersonId;
const vic = 'vic' as PersonId;
const rex = 'rex' as PersonId;
const quinn = 'quinn' as PersonId;

const METHOD = 'NA-LCMS-001 v3';
const current = (meaning: AuthorisationStanding['meaning']): AuthorisationStanding =>
  ({ kind: 'current', meaning, scope: METHOD, validUntil: '2027-06-30' });

const performer = (person: PersonId): PerformerFacts => ({
  person,
  signing: { kind: 'enabled' },
  methodTraining: { kind: 'current', documentVersion: METHOD },
  prerequisiteTraining: [{ kind: 'current', documentVersion: 'SOP-QA-004 v2' }],
  authorisation: current('Performed'),
});

const codes = (g: GateResult): readonly string[] => (g.go ? [] : g.reasons.map((r) => r.code));
const reasons = (g: GateResult): readonly GateReason[] => (g.go ? [] : g.reasons);

// ---------------------------------------------------------------------------------------------
// Assignment: decision 19 §4's four conditions, with no override.
// ---------------------------------------------------------------------------------------------

const eligible: AnalystFacts = { ...performer(ana), holdsAnalystRole: true };
const noMethodTraining: AnalystFacts = { ...eligible, methodTraining: { kind: 'superseded', documentVersion: 'NA-LCMS-001 v2', by: METHOD } };
const noPrerequisite: AnalystFacts = { ...eligible, prerequisiteTraining: [{ kind: 'missing', documentVersion: 'SOP-QA-004 v2' }] };
const noAuthorisation: AnalystFacts = { ...eligible, authorisation: { kind: 'expired', meaning: 'Performed', scope: METHOD, validUntil: '2026-09-01' } };
const notEnabled: AnalystFacts = { ...eligible, signing: { kind: 'not-enabled', missingSteps: ['policy-acknowledged'] } };
const allFour: AnalystFacts = {
  ...eligible,
  methodTraining: noMethodTraining.methodTraining,
  prerequisiteTraining: noPrerequisite.prerequisiteTraining,
  authorisation: noAuthorisation.authorisation,
  signing: notEnabled.signing,
};

describe('assignmentGate', () => {
  const table = [
    ['every condition met', eligible, []],
    ['(1) no current Training Record on the Method version', noMethodTraining, ['training']],
    ['(2) no current Training Record on a prerequisite Document', noPrerequisite, ['training']],
    ['(3) no current Performed Authorisation on the Method in this Lab', noAuthorisation, ['authorisation']],
    ['(4) account not enabled for signing', notEnabled, ['signing-not-enabled']],
    ['all four missing: every reason, not the first', allFour, ['training', 'training', 'authorisation', 'signing-not-enabled']],
    ['not an Analyst in this Lab', { ...eligible, holdsAnalystRole: false }, ['role-not-held']],
  ] as const;

  it.each(table)('%s', (_, facts, expected) => {
    expect(codes(assignmentGate(facts))).toEqual(expected);
  });

  it('names what is missing', () => {
    expect(reasons(assignmentGate(allFour))).toEqual([
      { code: 'training', standing: { kind: 'superseded', documentVersion: 'NA-LCMS-001 v2', by: METHOD } },
      { code: 'training', standing: { kind: 'missing', documentVersion: 'SOP-QA-004 v2' } },
      { code: 'authorisation', standings: [{ kind: 'expired', meaning: 'Performed', scope: METHOD, validUntil: '2026-09-01' }] },
      { code: 'signing-not-enabled', missingSteps: ['policy-acknowledged'] },
    ]);
  });

  it('offers exactly the Analysts the gate lets through, on every row', () => {
    for (const [, facts] of table) {
      expect(eligibleAnalysts([facts]).length === 1).toBe(assignmentGate(facts).go);
    }
    expect(eligibleAnalysts(table.map(([, f]) => f))).toEqual([eligible]);
  });
});

// ---------------------------------------------------------------------------------------------
// Acceptance and Ready (decision 12)
// ---------------------------------------------------------------------------------------------

describe('an Authorisation lasts at most 12 calendar months (decision 19)', () => {
  it.each([
    ['2026-10-01', '2027-10-01'], ['2026-01-31', '2027-01-31'], ['2028-02-29', '2029-02-28'], ['2027-02-28', '2028-02-28'], ['2031-03-31', '2032-03-31'],
  ])('from %s it ends by %s, exclusive', (from, end) => {
    expect(authorisationEndsBy(from)).toBe(end);
  });
});

describe('adoptionStatusGate: which status a Method\'s basis allows (decision 36 §4, usp 6)', () => {
  const statuses = ['in-development', 'validated-here', 'transferred-in', 'verified', 'verified-basic-compendial', 'retired'] as const;
  const allowed = {
    'compendial': { plain: statuses, nitrosamine: statuses.filter((s) => s !== 'verified-basic-compendial') },
    'alternative': { plain: statuses.filter((s) => !s.startsWith('verified')), nitrosamine: statuses.filter((s) => !s.startsWith('verified')) },
    'in-house': { plain: statuses.filter((s) => !s.startsWith('verified')), nitrosamine: statuses.filter((s) => !s.startsWith('verified')) },
  } as const;

  it.each((['compendial', 'alternative', 'in-house'] as const).flatMap((basis) => [false, true].flatMap((nitro) => statuses.map((status) => [basis, nitro, status] as const))))(
    'a %s Method, nitrosamine Analytes %s, adopted as %s',
    (basis, nitro, status) => {
      const gate = adoptionStatusGate({ status, basis, nitrosamineAnalytes: nitro ? ['NDMA'] : [] });
      expect(gate.go).toBe((allowed[basis][nitro ? 'nitrosamine' : 'plain'] as readonly string[]).includes(status));
    },
  );

  it('says why, naming the basis or the nitrosamine Analytes', () => {
    const verified = adoptionStatusGate({ status: 'verified', basis: 'in-house', nitrosamineAnalytes: ['NDMA'] });
    expect(verified).toEqual({ go: false, reasons: [{ code: 'adoption-status-for-basis', status: 'verified', basis: 'in-house' }] });
    const basic = adoptionStatusGate({ status: 'verified-basic-compendial', basis: 'compendial', nitrosamineAnalytes: ['NDMA', 'NDEA'] });
    expect(basic).toEqual({ go: false, reasons: [{ code: 'basic-compendial-nitrosamine', analytes: ['NDMA', 'NDEA'] }] });
    if (verified.go || basic.go) throw new Error('expected refusals');
    expect(toRefusal(verified).message).toBe('An in-house Method can\'t be adopted as verified: verification is only for a compendial Method. Adopt it as validated here or transferred in.');
    expect(toRefusal(basic).message).toBe('A Method with nitrosamine Analytes (NDMA and NDEA) is never verified (basic compendial).');
  });
});

describe('acceptanceGate and readyGate', () => {
  it.each([
    ['validated-here', true], ['verified', true], ['transferred-in', true], ['verified-basic-compendial', true],
    ['in-development', false], ['retired', false], ['none', false],
  ] as const)('a GMP Test with Method Adoption %s: go is %s', (adoption, go) => {
    expect(acceptanceGate({ gxpClass: 'GMP', adoption }).go).toBe(go);
  });

  it('checks no Method status for a non-GMP Test', () => {
    expect(acceptanceGate({ gxpClass: 'non-GMP', adoption: 'in-development' }).go).toBe(true);
  });

  it.each([
    [{ sampleReceived: true, gxpClass: 'GMP', adoption: 'validated-here' }, []],
    [{ sampleReceived: false, gxpClass: 'GMP', adoption: 'validated-here' }, ['sample-not-received']],
    [{ sampleReceived: true, gxpClass: 'GMP', adoption: 'retired' }, ['method-adoption']],
    [{ sampleReceived: false, gxpClass: 'GMP', adoption: 'none' }, ['sample-not-received', 'method-adoption']],
  ] as const)('readyGate %o', (facts, expected) => {
    expect(codes(readyGate(facts))).toEqual(expected);
  });

  it('refuses cancelling a Test once work is linked to it', () => {
    expect(codes(cancelGate({ test: 'T1', preparations: 0, runs: 0 }))).toEqual([]);
    expect(codes(cancelGate({ test: 'T1', preparations: 1, runs: 0 }))).toEqual(['work-linked']);
    expect(codes(cancelGate({ test: 'T1', preparations: 0, runs: 1 }))).toEqual(['work-linked']);
  });
});

// ---------------------------------------------------------------------------------------------
// Verified (decision 19 §4, decision 13 SoD, ADR 0001; LS001 and LS002 refuse the same in SQL)
// ---------------------------------------------------------------------------------------------

describe('verifiedGate', () => {
  const verifier = {
    person: vic,
    signing: { kind: 'enabled' as const },
    authorisations: [
      { kind: 'missing' as const, meaning: 'Performed' as const, scope: METHOD },
      current('Reviewed'),
    ] as const,
  };
  const base: VerifiedFacts = {
    signer: verifier,
    values: [
      { label: 'Preparation 1 weight', authors: [ana], proposer: null },
      { label: 'Preparation 1 NDMA concentration', authors: [ana], proposer: null },
    ],
  };

  it.each([
    ['a second person with one current Authorisation of the two', base, []],
    ['no current Performed or Reviewed Authorisation', {
      ...base,
      signer: { ...verifier, authorisations: [{ kind: 'missing', meaning: 'Performed', scope: METHOD }, { kind: 'suspended', meaning: 'Reviewed', scope: METHOD }] },
    }, ['authorisation']],
    ['the verifier typed one of the values', {
      ...base, values: [...base.values, { label: 'Run sequence', authors: [vic], proposer: null }],
    }, ['separation-of-duties']],
    ['the verifier typed an earlier version of a value someone else corrected (LS002 is strict)', {
      ...base, values: [{ label: 'Preparation 2 weight', authors: [vic, ana], proposer: ana }],
    }, ['separation-of-duties']],
    ['the verifier proposed the pending change', {
      ...base, values: [{ label: 'Preparation 2 weight', authors: [ana, vic], proposer: vic }],
    }, ['separation-of-duties', 'separation-of-duties']],
    ['signing not enabled', { ...base, signer: { ...verifier, signing: { kind: 'not-enabled', missingSteps: ['identity-check'] } } }, ['signing-not-enabled']],
  ] as const)('%s', (_, facts, expected) => {
    expect(codes(verifiedGate(facts as VerifiedFacts))).toEqual(expected);
  });

  it('says which rule each value breaks', () => {
    const g = verifiedGate({ ...base, values: [{ label: 'Preparation 2 weight', authors: [ana, vic], proposer: vic }] });
    expect(reasons(g)).toEqual([
      { code: 'separation-of-duties', rule: 'verifier-entered-value', subject: 'Preparation 2 weight' },
      { code: 'separation-of-duties', rule: 'self-approval', subject: 'Preparation 2 weight' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Run Performed (decisions 19, 20; ADR 0006 for Run Checks)
// ---------------------------------------------------------------------------------------------

const sn = (limit: string): ExportedRunCheck => ({
  name: 'S/N at the LOQ standard', comparedAs: 'as-exported',
  criterion: { op: 'NLT', limit: written(limit), source: { kind: 'method', methodVersion: METHOD } },
});
const passing = judgeRunCheck({ check: sn('10.0'), typed: written('25.3') });
const failing = judgeRunCheck({ check: sn('10.0'), typed: written('8.7') });
const misconfigured = judgeRunCheck({ check: sn('10'), typed: written('25.3') });
const computed = judgeRunCheck({
  check: { name: 'Replicate-injection RSD', comparedAs: 'lims-computed', statistic: 'rsd', criterion: { op: 'NMT', limit: written('5.0'), source: { kind: 'method', methodVersion: METHOD } } },
  raw: [written('1021'), written('1030')],
});

describe('runPerformedGate', () => {
  const base: RunPerformedFacts = {
    run: 'RUN-2026-0042',
    signer: performer(ana),
    isAcquirer: true,
    missingValues: [], unverifiedValues: [], pendingChanges: [],
    equipment: { code: 'LCMS-02', fitness: 'In use' },
    runChecks: [{ check: 'S/N at the LOQ standard', outcome: passing }, { check: 'CCV recovery', outcome: passing }],
  };

  it.each([
    ['everything in place', base, []],
    ['not the Analyst who acquired it', { ...base, isAcquirer: false }, ['not-acquirer']],
    ['a value missing, one unverified, one change pending', {
      ...base, missingValues: ['Run sequence'], unverifiedValues: ['Injection 3 time'], pendingChanges: ['CCV recovery'],
    }, ['value-missing', 'not-verified', 'change-pending']],
    ['the instrument not In use', { ...base, equipment: { code: 'LCMS-02', fitness: 'Suspended' } }, ['equipment-not-in-use']],
    ['a Run Check not recorded', { ...base, runChecks: [{ check: 'CCV recovery', outcome: { kind: 'not-recorded' } }] }, ['run-check-missing']],
    ['a Run Check the LIMS must compute: not built', { ...base, runChecks: [{ check: 'Replicate-injection RSD', outcome: computed }] }, ['not-built']],
    ['a Run Check written coarser than its export', { ...base, runChecks: [{ check: 'S/N at the LOQ standard', outcome: misconfigured }] }, ['criterion-misconfigured']],
    ['a failing Run Check: the Deviation workflow is not built', { ...base, runChecks: [{ check: 'S/N at the LOQ standard', outcome: failing }] }, ['not-built']],
    ['a failing Run Check and an unverified value: both', {
      ...base, unverifiedValues: ['Injection 3 time'], runChecks: [{ check: 'S/N at the LOQ standard', outcome: failing }],
    }, ['not-verified', 'not-built']],
  ] as const)('%s', (_, facts, expected) => {
    expect(codes(runPerformedGate(facts as RunPerformedFacts))).toEqual(expected);
  });

  it('re-checks all four assignment conditions on the signer', () => {
    expect(codes(runPerformedGate({ ...base, signer: allFour }))).toEqual(['training', 'training', 'authorisation', 'signing-not-enabled']);
  });

  it('names the failing Run Check in the not-built reason', () => {
    expect(reasons(runPerformedGate({ ...base, runChecks: [{ check: 'S/N at the LOQ standard', outcome: failing }] })))
      .toEqual([{ code: 'not-built', feature: 'deviation-workflow', because: 'Run Check S/N at the LOQ standard does not conform (8.7 against NLT 10.0)' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Test Performed (decisions 12, 19, 20, 29)
// ---------------------------------------------------------------------------------------------

const NDMA = 'NDMA' as AnalyteKey;
const RD: VariabilityCriterion = { statistic: 'relative-difference', limit: written('20.0'), source: { kind: 'method', methodVersion: METHOD } };
const FDA = [{ jurisdiction: 'FDA', ruleSetVersion: 'fda-1', rounding: 'half-away-from-zero', lines: [{ analyte: NDMA, limit: written('0.03'), uspClaim: false }] }] as const;
const judgeWith = (variability: VariabilityCriterion | null, ...ppm: NonEmpty<string>) => judgeTest({
  sections: FDA,
  preparations: mapNonEmpty(ppm, (v, i) => ({ preparation: `p${i + 1}` as PreparationId, results: new Map([[NDMA, toRational(written(v))]]) })),
  variability,
});
const judge = (...ppm: NonEmpty<string>) => judgeWith(RD, ...ppm);

describe('testPerformedGate', () => {
  const base: TestPerformedFacts = {
    test: 'RD-S-2026-000123/T1',
    signer: performer(ana),
    isAssignee: true,
    valuesByOthers: [], missingValues: [], unverifiedValues: [], pendingChanges: [],
    runs: [{ run: 'RUN-2026-0042', performedStands: true }],
    judgement: judge('0.012', '0.014'),
    blockingHolds: [],
  };

  it.each([
    ['everything in place', base, []],
    ['not the assigned Analyst', { ...base, isAssignee: false }, ['not-assignee']],
    ['a feeding Run not Performed', { ...base, runs: [{ run: 'RUN-2026-0042', performedStands: false }] }, ['unsigned-dependency']],
    ['a Hold blocks Performed', { ...base, blockingHolds: ['HOLD-7'] }, ['open-hold']],
    ['a value another Analyst typed (split signing is not built)', { ...base, valuesByOthers: ['Preparation 1 weight'] }, ['not-built']],
    ['a Preparation fails although the mean passes (OOS)', { ...base, judgement: judge('0.030', '0.036') }, ['not-built']],
    ['the Reportable Result and each Preparation fail', { ...base, judgement: judge('0.045', '0.047') }, ['not-built', 'not-built', 'not-built']],
    ['a Preparation result missing', {
      ...base,
      judgement: judgeTest({ sections: FDA, preparations: [{ preparation: 'p1' as PreparationId, results: new Map() }], variability: RD }),
    }, ['value-missing']],
    ['variability between Preparations over its limit (a Deviation, not built)', { ...base, judgement: judge('0.024', '0.030') }, ['not-built']],
    ['variability missing: one Preparation', { ...base, judgement: judge('0.012') }, ['variability-not-computed']],
    ['a variability statistic the skeleton does not compute', {
      ...base, judgement: judgeWith({ ...RD, statistic: 'rsd' }, '0.012', '0.014'),
    }, ['not-built']],
    ['a Method with no variability limit', { ...base, judgement: judgeWith(null, '0.012') }, []],
  ] as const)('%s', (_, facts, expected) => {
    expect(codes(testPerformedGate(facts as TestPerformedFacts))).toEqual(expected);
  });

  it('names the variability that failed, rounded once to its limit\'s decimals', () => {
    expect(reasons(testPerformedGate({ ...base, judgement: judge('0.024', '0.030') }))).toEqual([{
      code: 'not-built', feature: 'deviation-workflow',
      because: 'the variability between Preparations 1 and 2 does not conform: NDMA 22.2 % against NMT 20.0 %',
    }]);
    expect(reasons(testPerformedGate({ ...base, judgement: judgeWith({ ...RD, statistic: 'rsd' }, '0.012', '0.014') }))).toEqual([{
      code: 'not-built', feature: 'variability-statistic', because: 'the Method\'s variability is an rsd limit',
    }]);
  });

  it('names the failing Preparation and its rounded result', () => {
    expect(reasons(testPerformedGate({ ...base, judgement: judge('0.030', '0.036') }))).toEqual([{
      code: 'not-built', feature: 'deviation-workflow',
      because: 'Preparation 2 does not conform: NDMA 0.04 ppm against FDA NMT 0.03 ppm',
    }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Reviewed, on a Test or a Run (decisions 13, 19, 20)
// ---------------------------------------------------------------------------------------------

describe('reviewedGate', () => {
  const reviewer = {
    person: rex,
    signing: { kind: 'enabled' as const },
    methodTraining: { kind: 'current' as const, documentVersion: METHOD },
    authorisation: current('Reviewed'),
  };
  const base: ReviewedFacts = {
    record: 'RD-S-2026-000123/T1',
    signer: reviewer,
    performedStands: true,
    performedSigners: [ana],
    feedingRuns: [{ run: 'RUN-2026-0042', reviewedStands: true }],
    pendingChanges: [],
    checklist: { required: ['LIMS audit trail reviewed', 'calculations checked'], ticked: ['LIMS audit trail reviewed', 'calculations checked'] },
    blockingHolds: [],
  };

  it.each([
    ['everything in place', base, []],
    ['the Reviewer signed Performed on it or a Run feeding it', { ...base, performedSigners: [ana, rex] }, ['separation-of-duties']],
    ['no Performed signature standing on the version shown', { ...base, performedStands: false }, ['unsigned-dependency']],
    ['a feeding Run not Reviewed', { ...base, feedingRuns: [{ run: 'RUN-2026-0042', reviewedStands: false }] }, ['unsigned-dependency']],
    ['"audit trail reviewed" not ticked', { ...base, checklist: { ...base.checklist, ticked: ['calculations checked'] } }, ['checklist-incomplete']],
    ['a change pending', { ...base, pendingChanges: ['Preparation 1 weight'] }, ['change-pending']],
    ['a Hold blocks Reviewed', { ...base, blockingHolds: ['HOLD-7'] }, ['open-hold']],
    ['no current Reviewed Authorisation', { ...base, signer: { ...reviewer, authorisation: { kind: 'missing', meaning: 'Reviewed', scope: METHOD } } }, ['authorisation']],
    ['no current Training Record on the pinned version', { ...base, signer: { ...reviewer, methodTraining: { kind: 'missing', documentVersion: METHOD } } }, ['training']],
  ] as const)('%s', (_, facts, expected) => {
    expect(codes(reviewedGate(facts as ReviewedFacts))).toEqual(expected);
  });

  it('lists the unticked checklist items', () => {
    expect(reasons(reviewedGate({ ...base, checklist: { ...base.checklist, ticked: [] } })))
      .toEqual([{ code: 'checklist-incomplete', items: ['LIMS audit trail reviewed', 'calculations checked'] }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Released (decisions 12, 13, 29): every SoD rule alone and together
// ---------------------------------------------------------------------------------------------

describe('releasedGate', () => {
  const releaser = {
    person: quinn,
    signing: { kind: 'enabled' as const },
    authorisation: { kind: 'current' as const, meaning: 'Released' as const, scope: 'Test Reports', validUntil: '2027-01-31' },
    conformityAuthorisation: { kind: 'current' as const, meaning: 'Released' as const, scope: 'conformity statements and opinions', validUntil: '2027-01-31' },
  };
  const test = (number: string) => ({
    test: number,
    performedStands: true, reviewedStands: true,
    performedBy: [ana], reviewedBy: [rex],
    blockingHolds: [] as string[],
    pendingChanges: [] as string[],
    verdicts: [{ jurisdiction: 'FDA' as const, confirmation: 'confirmed' as const }],
  });
  const base: ReleasedFacts = {
    report: 'TR-2026-0007',
    signer: releaser,
    tests: [test('T1'), test('T2')],
    checklist: { required: ['every verdict confirmed'], ticked: ['every verdict confirmed'] },
  };
  const withTests = (t1: object, t2: object = {}): ReleasedFacts => ({ ...base, tests: [{ ...test('T1'), ...t1 }, { ...test('T2'), ...t2 }] });

  it.each([
    ['no SoD rule broken', base, []],
    ['QA was an Analyst on a Test in it', withTests({ performedBy: [ana, quinn] }), ['releaser-performed']],
    ['QA reviewed a Test in it', withTests({}, { reviewedBy: [quinn] }), ['releaser-reviewed']],
    ['QA performed one Test and reviewed another', withTests({ performedBy: [quinn] }, { reviewedBy: [quinn] }), ['releaser-performed', 'releaser-reviewed']],
  ] as const)('%s', (_, facts, expected) => {
    expect(reasons(releasedGate(facts)).flatMap((r) => (r.code === 'separation-of-duties' ? [r.rule] : []))).toEqual(expected);
  });

  it.each([
    ['a Test whose Performed signature no longer stands', withTests({ performedStands: false }), ['unsigned-dependency']],
    ['a Test whose Reviewed signature no longer stands', withTests({ reviewedStands: false }), ['unsigned-dependency']],
    ['an open Hold on a Test', withTests({ blockingHolds: ['HOLD-7'] }), ['open-hold']],
    ['a change pending on a value behind a Test, which the release lock would leave unsettleable', withTests({}, { pendingChanges: ['prep.weight (P1)'] }), ['change-pending']],
    ['a verdict QA has not confirmed', withTests({ verdicts: [{ jurisdiction: 'FDA', confirmation: 'none' }] }), ['verdict-not-confirmed']],
    ['a verdict QA disagrees with: the Deviation workflow is not built', withTests({ verdicts: [{ jurisdiction: 'FDA', confirmation: 'disagreed' }] }), ['not-built']],
    ['the release checklist incomplete', { ...base, checklist: { required: ['every verdict confirmed'], ticked: [] } }, ['checklist-incomplete']],
    ['no current conformity-statement Authorisation', {
      ...base, signer: { ...releaser, conformityAuthorisation: { kind: 'missing', meaning: 'Released', scope: 'conformity statements and opinions' } },
    }, ['authorisation']],
  ] as const)('%s', (_, facts, expected) => {
    expect(codes(releasedGate(facts as ReleasedFacts))).toEqual(expected);
  });
});
