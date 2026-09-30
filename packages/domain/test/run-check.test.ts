import { describe, expect, it } from 'vitest';
import { formatWritten, written } from '../src/decimal.ts';
import { judgeRunCheck, type ComputedRunCheck, type ExportedRunCheck } from '../src/verdict.ts';

const snCompendial: ExportedRunCheck = {
  name: 'S/N at the LOQ standard',
  comparedAs: 'as-exported',
  criterion: { op: 'NLT', limit: written('10'), source: { kind: 'compendial', citation: 'USP <621>' } },
};
const recovery: ExportedRunCheck = {
  name: 'CCV recovery',
  comparedAs: 'as-exported',
  criterion: { op: 'range', low: written('80.0'), high: written('120.0'), source: { kind: 'method', methodVersion: 'NA-LCMS-001 v3' } },
};
const rsd: ComputedRunCheck = {
  name: 'Replicate-injection RSD',
  comparedAs: 'lims-computed',
  statistic: 'rsd',
  criterion: { op: 'NMT', limit: written('5.0'), source: { kind: 'method', methodVersion: 'NA-LCMS-001 v3' } },
};

describe('judgeRunCheck (#37 §4)', () => {
  it('compares a typed value of an instrument-displayed Run Check as exported, never rounding it again', () => {
    const outcome = judgeRunCheck({ check: recovery, typed: written('79.9') });
    expect(outcome).toMatchObject({ kind: 'judged', conforms: false });
    if (outcome.kind !== 'judged') throw new Error(outcome.kind);
    expect(formatWritten(outcome.comparisons[0].compared)).toBe('79.9');
  });

  it('says a Run Check with no typed value is not recorded', () => {
    expect(judgeRunCheck({ check: recovery, typed: null })).toEqual({ kind: 'not-recorded' });
  });

  it('refuses a LIMS-computed statistic as not built rather than judging a typed figure', () => {
    expect(judgeRunCheck({ check: rsd, raw: [written('1021'), written('1030'), written('1012')] }))
      .toEqual({ kind: 'not-built', statistic: 'rsd' });
  });

  it('carries the criterion\'s source into a decimals mismatch, so the message can say what may change', () => {
    expect(judgeRunCheck({ check: snCompendial, typed: written('25.3') })).toEqual({
      kind: 'criterion-coarser-than-export', valueDecimals: 1, limitDecimals: 0,
      source: { kind: 'compendial', citation: 'USP <621>' },
    });
  });
});
