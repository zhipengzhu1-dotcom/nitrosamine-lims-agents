import { describe, expect, it } from 'vitest';
import { formatWritten, toRational, written, type RoundingMode } from '../src/decimal.ts';
import { nonEmpty } from '../src/nonempty.ts';
import table from './verdict-vectors.md?raw';
import type { AnalyteKey, PreparationId } from '../src/ids.ts';
import {
  judgeCriterion, judgeSpecification,
  type Criterion, type CriterionVerdict, type Jurisdiction, type SpecificationJudgement,
} from '../src/verdict.ts';

type Row = {
  readonly n: string; readonly checks: string; readonly kind: string; readonly values: string;
  readonly limit: string; readonly rounding: string; readonly compared: string;
  readonly verdict: string; readonly percent: string;
};

function readTable(): readonly Row[] {
  return table.split('\n')
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => {
      const [n, checks, kind, values, limit, rounding, compared, verdict, percent] =
        line.split('|').slice(1, -1).map((cell) => cell.trim());
      return { n: n!, checks: checks!, kind: kind!, values: values!, limit: limit!, rounding: rounding!,
               compared: compared!, verdict: verdict!, percent: percent! };
    });
}

function parseCriterion(text: string): Criterion {
  const one = /^(NMT|NLT) (\S+)$/.exec(text);
  if (one) return { op: one[1] as 'NMT' | 'NLT', limit: written(one[2]!) };
  const [low, high] = text.split('–');
  return { op: 'range', low: written(low!), high: written(high!) };
}

const ROUNDING_WORDS: { readonly [M in RoundingMode]: string } = {
  'half-away-from-zero': 'half away',
  'half-even': 'half even',
};

function describeCriterion(v: CriterionVerdict): { compared: string; verdict: string } {
  switch (v.kind) {
    case 'judged':
      return { compared: v.comparisons.map((c) => formatWritten(c.compared)).join(' / '),
               verdict: v.conforms ? 'conforms' : 'does not conform' };
    case 'criterion-coarser-than-export':
      return { compared: '—', verdict: 'criterion coarser than export' };
    case 'export-coarser-than-criterion':
      return { compared: '—', verdict: 'export coarser than criterion' };
  }
}

const NDMA = 'NDMA' as AnalyteKey;

function describeJudgement(j: SpecificationJudgement): { compared: string; verdict: string; percent: string; rounding: string } {
  if (j.kind !== 'judged') throw new Error(`expected a judged Section, got ${j.kind}`);
  const [section] = j.sections;
  const preps = section.preparations.map((p) => p.lines[0]);
  const reportable = section.reportable[0];
  const failing = section.preparations.flatMap((p, i) => (p.lines[0].conforms ? [] : [`preparation ${i + 1} does not conform`]));
  return {
    compared: `${preps.map((l) => formatWritten(l.compared)).join('; ')} → ${formatWritten(reportable.compared)}`,
    verdict: [section.conforms ? 'conforms' : 'does not conform', ...failing].join('; '),
    percent: formatWritten(reportable.percentOfLimit),
    rounding: ROUNDING_WORDS[reportable.rounding],
  };
}

const rows = readTable();

describe('verdict golden vectors (verdict-vectors.md)', () => {
  it('reads every row of the table', () => {
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => String(i + 1)));
    expect(rows.length).toBeGreaterThanOrEqual(27);
  });

  for (const row of rows) {
    it(`${row.n}. ${row.checks}`, () => {
      if (row.kind === 'full precision' || row.kind === 'as exported') {
        const measured = row.kind === 'full precision'
          ? { provenance: 'full-precision' as const, value: toRational(written(row.values)) }
          : { provenance: 'instrument-rounded' as const, value: written(row.values) };
        expect(row.rounding).toBe(row.kind === 'full precision' ? 'half away' : 'none');
        expect(row.percent).toBe('—');
        expect(describeCriterion(judgeCriterion(measured, parseCriterion(row.limit))))
          .toEqual({ compared: row.compared, verdict: row.verdict });
        return;
      }
      const section = /^(FDA|EMA|NMPA|MHLW) Section(, USP claim)?$/.exec(row.kind);
      if (!section) throw new Error(`unknown Kind: ${row.kind}`);
      const jurisdiction = section[1] as Jurisdiction;
      const limit = /^NMT (\S+)$/.exec(row.limit)![1]!;
      const judgement = judgeSpecification(
        [{
          jurisdiction,
          ruleSetVersion: `${jurisdiction}-rules-v1`,
          rounding: jurisdiction === 'NMPA' ? 'half-even' : 'half-away-from-zero',
          lines: [{ analyte: NDMA, limit: written(limit), uspClaim: section[2] !== undefined }],
        }],
        nonEmpty(row.values.split(';').map((v, i) => ({
          preparation: `prep-${i + 1}` as PreparationId,
          results: new Map([[NDMA, toRational(written(v.trim()))]]),
        })))!,
      );
      expect(describeJudgement(judgement))
        .toEqual({ compared: row.compared, verdict: row.verdict, percent: row.percent, rounding: row.rounding });
    });
  }
});

describe('a Specification judgement', () => {
  it('reports the missing result instead of judging without it', () => {
    const j = judgeSpecification(
      [{ jurisdiction: 'FDA', ruleSetVersion: 'r1', rounding: 'half-away-from-zero',
         lines: [{ analyte: NDMA, limit: written('0.03'), uspClaim: false }] }],
      [{ preparation: 'p1' as PreparationId, results: new Map() }],
    );
    expect(j).toEqual({ kind: 'result-missing', preparation: 'p1', analyte: NDMA });
  });

  it('judges each Section on its own from the same full-precision values (ADR 0003)', () => {
    const j = judgeSpecification(
      [
        { jurisdiction: 'FDA', ruleSetVersion: 'fda-1', rounding: 'half-away-from-zero',
          lines: [{ analyte: NDMA, limit: written('0.10'), uspClaim: false }] },
        { jurisdiction: 'NMPA', ruleSetVersion: 'nmpa-1', rounding: 'half-even',
          lines: [{ analyte: NDMA, limit: written('0.10'), uspClaim: false }] },
      ],
      [{ preparation: 'p1' as PreparationId, results: new Map([[NDMA, toRational(written('0.105'))]]) }],
    );
    if (j.kind !== 'judged') throw new Error(j.kind);
    expect(j.sections.map((s) => [s.jurisdiction, formatWritten(s.reportable[0].compared), s.conforms]))
      .toEqual([['FDA', '0.11', false], ['NMPA', '0.10', true]]);
    expect(j.conforms).toBe(false);
    expect(j.sections.every((s) => s.calculation === 'calc-2026.1')).toBe(true);
  });
});
