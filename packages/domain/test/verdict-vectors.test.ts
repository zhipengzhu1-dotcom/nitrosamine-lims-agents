import { describe, expect, it } from 'vitest';
import { div, formatWritten, toRational, written, type Rational, type RoundingMode } from '../src/decimal.ts';
import type { AnalyteKey, PreparationId } from '../src/ids.ts';
import { mapNonEmpty, nonEmpty } from '../src/nonempty.ts';
import {
  exceedsShare, judgeCriterion, judgeTest,
  type Criterion, type CriterionVerdict, type Jurisdiction, type TestJudgement, type VariabilityCriterion,
} from '../src/verdict.ts';
import table from './verdict-vectors.md?raw';

const COLUMNS = ['n', 'checks', 'kind', 'values', 'limit', 'rounding', 'compared', 'verdict', 'percent', 'variabilityLimit', 'variability', 'band'] as const;
type Row = { readonly [C in (typeof COLUMNS)[number]]: string };

function readTable(): readonly Row[] {
  return table.split('\n')
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      return Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i]!])) as Row;
    });
}

const LAB_SOP = { kind: 'sop', sopVersion: 'SOP-QA-010 v1' } as const;

function parseCriterion(text: string): Criterion {
  const one = /^(NMT|NLT) (\S+)$/.exec(text);
  if (one) return { op: one[1] as 'NMT' | 'NLT', limit: written(one[2]!), source: LAB_SOP };
  const [low, high] = text.split('–');
  return { op: 'range', low: written(low!), high: written(high!), source: LAB_SOP };
}

/** A decimal, or `a/b` for an exact quotient that may not terminate. */
function parseValue(text: string): Rational {
  const [a, b] = text.split('/');
  return b === undefined ? toRational(written(a!)) : div(toRational(written(a!)), toRational(written(b)));
}

function parseVariability(text: string): VariabilityCriterion | null {
  if (text === 'none') return null;
  const m = /^(RD|RSD) NMT (\S+)$/.exec(text);
  if (!m) throw new Error(`unknown variability limit: ${text}`);
  return { statistic: m[1] === 'RD' ? 'relative-difference' : 'rsd', limit: written(m[2]!), source: { kind: 'method', methodVersion: 'NA-LCMS-001 v3' } };
}

const ROUNDING_WORDS: { readonly [M in RoundingMode]: string } = { 'half-away-from-zero': 'half away', 'half-even': 'half even' };
const OUTCOME_WORDS = { 'conforms': 'conforms', 'does-not-conform': 'does not conform', 'not-judged': 'not judged' } as const;

function describeCriterion(v: CriterionVerdict): { compared: string; verdict: string } {
  switch (v.kind) {
    case 'judged':
      return { compared: v.comparisons.map((c) => formatWritten(c.compared)).join(' / '), verdict: v.conforms ? 'conforms' : 'does not conform' };
    case 'criterion-coarser-than-export':
      return { compared: '—', verdict: 'criterion coarser than export' };
    case 'export-coarser-than-criterion':
      return { compared: '—', verdict: 'export coarser than criterion' };
  }
}

const NDMA = 'NDMA' as AnalyteKey;
const BAND = written('30');

function describeJudgement(j: TestJudgement) {
  if (j.kind !== 'judged') throw new Error(`expected a judged Test, got ${j.kind}`);
  const [section] = j.sections;
  const preps = section.preparations.map((p) => formatWritten(p.lines[0].compared)).join('; ');
  const reportable = section.reportable[0];
  const failing = section.preparations.flatMap((p, i) => (p.lines[0].conforms ? [] : [`preparation ${i + 1} does not conform`]));
  const v = j.variability[0];
  return {
    compared: `${preps} → ${reportable.kind === 'judged' ? formatWritten(reportable.compared) : '—'}`,
    verdict: [OUTCOME_WORDS[section.outcome], ...failing].join('; '),
    percent: reportable.kind === 'judged' ? reportable.share.displayPercent : '—',
    band: reportable.kind === 'judged' ? (exceedsShare(reportable.share, BAND) ? 'yes' : 'no') : '—',
    rounding: ROUNDING_WORDS[section.preparations[0].lines[0].rounding],
    variability: v === undefined ? '—'
      : v.kind === 'judged' ? `${v.pairs.map((p) => formatWritten(p.compared)).join('; ')} ${v.conforms ? 'conforms' : 'does not conform'}`
      : v.kind === 'missing' ? 'missing'
      : 'not built',
  };
}

const rows = readTable();

describe('verdict golden vectors (verdict-vectors.md)', () => {
  it('reads every row of the table', () => {
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => String(i + 1)));
    expect(rows.length).toBeGreaterThanOrEqual(47);
  });

  for (const row of rows) {
    it(`${row.n}. ${row.checks}`, () => {
      if (row.kind === 'full precision' || row.kind === 'as exported') {
        const measured = row.kind === 'full precision'
          ? { provenance: 'full-precision' as const, value: parseValue(row.values) }
          : { provenance: 'instrument-rounded' as const, value: written(row.values) };
        expect(row.rounding).toBe(row.kind === 'full precision' ? 'half away' : 'none');
        expect([row.percent, row.variabilityLimit, row.variability, row.band]).toEqual(['—', '—', '—', '—']);
        expect(describeCriterion(judgeCriterion(measured, parseCriterion(row.limit))))
          .toEqual({ compared: row.compared, verdict: row.verdict });
        return;
      }
      const section = /^(FDA|EMA|NMPA|MHLW) Section(, USP claim)?$/.exec(row.kind);
      if (!section) throw new Error(`unknown Kind: ${row.kind}`);
      const jurisdiction = section[1] as Jurisdiction;
      const judgement = judgeTest({
        sections: [{
          jurisdiction,
          ruleSetVersion: `${jurisdiction}-rules-v1`,
          rounding: jurisdiction === 'NMPA' ? 'half-even' : 'half-away-from-zero',
          lines: [{ analyte: NDMA, limit: written(/^NMT (\S+)$/.exec(row.limit)![1]!), uspClaim: section[2] !== undefined }],
        }],
        preparations: mapNonEmpty(nonEmpty(row.values.split(';'))!, (v, i) => ({
          preparation: `prep-${i + 1}` as PreparationId,
          results: new Map([[NDMA, parseValue(v.trim())]]),
        })),
        variability: parseVariability(row.variabilityLimit),
      });
      expect(describeJudgement(judgement)).toEqual({
        compared: row.compared, verdict: row.verdict, percent: row.percent, band: row.band,
        rounding: row.rounding, variability: row.variability,
      });
    });
  }
});

describe('a Test judgement', () => {
  const fda = { jurisdiction: 'FDA', ruleSetVersion: 'fda-1', rounding: 'half-away-from-zero', lines: [{ analyte: NDMA, limit: written('0.10'), uspClaim: false }] } as const;
  const prep = (id: string, ppm: string) => ({ preparation: id as PreparationId, results: new Map([[NDMA, toRational(written(ppm))]]) });

  it('reports the missing result instead of judging without it', () => {
    const j = judgeTest({ sections: [fda], preparations: [{ preparation: 'p1' as PreparationId, results: new Map() }], variability: null });
    expect(j).toEqual({ kind: 'result-missing', preparation: 'p1', analyte: NDMA });
  });

  it('judges each Section on its own from the same full-precision values (ADR 0003)', () => {
    const j = judgeTest({
      sections: [fda, { ...fda, jurisdiction: 'NMPA', ruleSetVersion: 'nmpa-1', rounding: 'half-even' }],
      preparations: [prep('p1', '0.105')],
      variability: null,
    });
    if (j.kind !== 'judged') throw new Error(j.kind);
    expect(j.sections.map((s) => [s.jurisdiction, s.reportable[0].kind === 'judged' ? formatWritten(s.reportable[0].compared) : '—', s.outcome]))
      .toEqual([['FDA', '0.11', 'does-not-conform'], ['NMPA', '0.10', 'conforms']]);
    expect(j.outcome).toBe('does-not-conform');
    expect(j.sections.every((s) => s.calculation === 'calc-2026.1')).toBe(true);
  });

  it('checks variability on every pair of Preparations, once per Test whatever its Sections', () => {
    const j = judgeTest({
      sections: [fda, { ...fda, jurisdiction: 'EMA', ruleSetVersion: 'ema-1' }],
      preparations: [prep('p1', '0.040'), prep('p2', '0.050'), prep('p3', '0.045')],
      variability: { statistic: 'relative-difference', limit: written('25'), source: { kind: 'method', methodVersion: 'M v3' } },
    });
    if (j.kind !== 'judged') throw new Error(j.kind);
    expect(j.variability).toHaveLength(1);
    const [v] = j.variability;
    if (v?.kind !== 'judged') throw new Error(v?.kind);
    expect(v.pairs.map((p) => [...p.preparations, formatWritten(p.compared)])).toEqual([
      ['p1', 'p2', '22'], ['p1', 'p3', '12'], ['p2', 'p3', '11'],
    ]);
  });

  it('never lets the variability judgement move a Preparation verdict', () => {
    const j = judgeTest({
      sections: [fda],
      preparations: [prep('p1', '0.05'), prep('p2', '0.15')],
      variability: { statistic: 'relative-difference', limit: written('20.0'), source: { kind: 'method', methodVersion: 'M v3' } },
    });
    if (j.kind !== 'judged') throw new Error(j.kind);
    expect(j.sections[0].preparations.map((p) => p.lines[0].conforms)).toEqual([true, false]);
    expect(j.sections[0].reportable[0]).toMatchObject({ kind: 'not-judged', because: 'variability' });
    expect(j.outcome).toBe('not-judged');
  });
});
