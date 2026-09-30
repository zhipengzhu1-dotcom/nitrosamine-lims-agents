// Verdicts, all pure:
//   judgeCriterion  an Acceptance Criterion (ADR 0006, #37).
//   judgeRunCheck   a Run Check, by how its value is compared (#37 §4).
//   judgeTest       a Test's Preparation results: the Method's variability criterion, then every
//                   Specification Section, Preparation-first (decision 29, ADR 0003).
// Every verdict records the Calculation Version that produced it, and is stored with the version it
// judged, so a later Calculation Version never changes a recorded verdict.

import { reportableResult, type PreparationResults } from './calculation.ts';
import {
  add, compare, div, formatWritten, mul, roundTo, sub, toRational,
  type Rational, type RoundingMode, type Written,
} from './decimal.ts';
import type { AnalyteKey, PreparationId } from './ids.ts';
import { mapNonEmpty, type NonEmpty } from './nonempty.ts';

export const CALCULATION_VERSION = 'calc-2026.1'; // QA-approved; changing it is change control
export type CalculationVersion = typeof CALCULATION_VERSION;

// ---------------------------------------------------------------------------------------------
// Acceptance Criteria (ADR 0006)
// ---------------------------------------------------------------------------------------------

/**
 * Where a criterion comes from. A compendial criterion keeps its printed decimals (GN 7.10), so only
 * the instrument's export can move to meet it; the lab's own may be written to the export's decimals.
 */
export type CriterionSource =
  | { readonly kind: 'compendial'; readonly citation: string } // 'USP <621>'
  | { readonly kind: 'method'; readonly methodVersion: string }
  | { readonly kind: 'sop'; readonly sopVersion: string };

export type Criterion = (
  | { readonly op: 'NMT'; readonly limit: Written }
  | { readonly op: 'NLT'; readonly limit: Written }
  | { readonly op: 'range'; readonly low: Written; readonly high: Written }
) & { readonly source: CriterionSource };

/**
 * Where a measured value came from. A value the instrument already rounded is never rounded again:
 * 79.46 exported as 79.5 must not become 80 and pass NLT 80.
 */
export type Measured =
  | { readonly provenance: 'full-precision'; readonly value: Rational }
  | { readonly provenance: 'instrument-rounded'; readonly value: Written };

/** One inclusive bound and the value compared with it. A range is an NLT bound and an NMT bound. */
export type BoundComparison = {
  readonly op: 'NLT' | 'NMT';
  readonly limit: Written;
  readonly compared: Written;
  readonly within: boolean;
};

export type CriterionVerdict =
  | {
      readonly kind: 'judged';
      readonly conforms: boolean;
      readonly comparisons: NonEmpty<BoundComparison>;
      readonly calculation: CalculationVersion;
    }
  /** Configuration, not data: an exported value is compared only with a limit written to its decimals. */
  | {
      readonly kind: 'criterion-coarser-than-export' | 'export-coarser-than-criterion';
      readonly valueDecimals: number;
      readonly limitDecimals: number;
      readonly source: CriterionSource;
    };

const boundsOf = (c: Criterion): NonEmpty<{ readonly op: 'NLT' | 'NMT'; readonly limit: Written }> =>
  c.op === 'range' ? [{ op: 'NLT', limit: c.low }, { op: 'NMT', limit: c.high }] : [{ op: c.op, limit: c.limit }];

const isWithin = (op: 'NLT' | 'NMT', value: Written, limit: Written): boolean => {
  const order = compare(toRational(value), toRational(limit));
  return op === 'NMT' ? order <= 0 : order >= 0;
};

/**
 * ADR 0006: a full-precision value is rounded once, half away from zero, to each bound's written
 * decimals and compared with the bound as written, inclusive. An exported value is compared as
 * exported, and only with a bound written to the same decimals.
 */
export function judgeCriterion(measured: Measured, criterion: Criterion): CriterionVerdict {
  const bounds = boundsOf(criterion);
  if (measured.provenance === 'instrument-rounded') {
    const valueDecimals = measured.value.decimals;
    for (const { limit } of bounds) {
      const mismatch = { valueDecimals, limitDecimals: limit.decimals, source: criterion.source };
      if (limit.decimals < valueDecimals) return { kind: 'criterion-coarser-than-export', ...mismatch };
      if (limit.decimals > valueDecimals) return { kind: 'export-coarser-than-criterion', ...mismatch };
    }
  }
  const compareWith = (b: { readonly op: 'NLT' | 'NMT'; readonly limit: Written }): BoundComparison => {
    const compared = measured.provenance === 'full-precision'
      ? roundTo(measured.value, b.limit.decimals, 'half-away-from-zero')
      : measured.value;
    return { op: b.op, limit: b.limit, compared, within: isWithin(b.op, compared, b.limit) };
  };
  const comparisons = mapNonEmpty(bounds, compareWith);
  return {
    kind: 'judged',
    conforms: comparisons.every((c) => c.within),
    comparisons,
    calculation: CALCULATION_VERSION,
  };
}

// ---------------------------------------------------------------------------------------------
// Run Checks (#37 §4)
// ---------------------------------------------------------------------------------------------

/** A statistic the LIMS computes from raw values and rounds once. None is built in the skeleton. */
export type ComputedStatistic = 'rsd' | 'ion-ratio-deviation' | 'rt-deviation' | 'ccv-drift';

/**
 * A Run Check as the Method version defines it. Its value is either compared as the instrument
 * exported or displayed it (S/N, %Rec), or computed by the LIMS from raw values.
 */
export type ExportedRunCheck = { readonly name: string; readonly criterion: Criterion; readonly comparedAs: 'as-exported' };
export type ComputedRunCheck = {
  readonly name: string; readonly criterion: Criterion; readonly comparedAs: 'lims-computed'; readonly statistic: ComputedStatistic;
};
export type RunCheck = ExportedRunCheck | ComputedRunCheck;

/** A typed value is Measured as exported; a computed statistic takes its raw inputs instead. */
export type RecordedRunCheck =
  | { readonly check: ExportedRunCheck; readonly typed: Written | null }
  | { readonly check: ComputedRunCheck; readonly raw: readonly Written[] };

export type RunCheckOutcome =
  | CriterionVerdict
  | { readonly kind: 'not-recorded' }
  | { readonly kind: 'not-built'; readonly statistic: ComputedStatistic };

export function judgeRunCheck(r: RecordedRunCheck): RunCheckOutcome {
  if ('raw' in r) return { kind: 'not-built', statistic: r.check.statistic };
  if (r.typed === null) return { kind: 'not-recorded' };
  return judgeCriterion({ provenance: 'instrument-rounded', value: r.typed }, r.check.criterion);
}

// ---------------------------------------------------------------------------------------------
// Specification Sections (decision 29, ADR 0003)
// ---------------------------------------------------------------------------------------------

export type Jurisdiction = 'FDA' | 'EMA' | 'NMPA' | 'MHLW';

/**
 * One Analyte's NMT limit in ppm, as written, from the pinned Specification version. Report-only
 * lines, limit tests and multiple-nitrosamine sums are not built, so they cannot be expressed.
 */
export type SpecificationLine = {
  readonly analyte: AnalyteKey;
  readonly limit: Written;
  readonly uspClaim: boolean; // GN 7.20 rounding overrides the Rule Set's
};

export type SpecificationSection = {
  readonly jurisdiction: Jurisdiction;
  readonly ruleSetVersion: string;
  readonly rounding: RoundingMode; // from the pinned Jurisdiction Rule Set version
  readonly lines: NonEmpty<SpecificationLine>;
};

export type LineVerdict = {
  readonly analyte: AnalyteKey;
  readonly limit: Written;
  readonly rounding: RoundingMode;
  readonly compared: Written; // the value rounded once to the limit's decimals
  readonly conforms: boolean;
};

/** A Reportable Result as a share of its limit (decision 29), a server-computed fact. */
export type ShareOfLimit = {
  /** Reportable Result ÷ limit × 100, exact. Bands and triggers compare this, never the printed figure. */
  readonly percent: Rational;
  /** The same to one decimal, as text for display only: 29.99… prints 30.0 and is still below 30. */
  readonly displayPercent: string;
};

/** Decision 29's share-of-limit triggers are "> 30 %" and "> 10 %": exact, on the full-precision share. */
export const exceedsShare = (share: ShareOfLimit, bandPercent: Written): boolean =>
  compare(share.percent, toRational(bandPercent)) > 0;

export type ReportableLineVerdict =
  | (LineVerdict & { readonly kind: 'judged'; readonly value: Rational; readonly share: ShareOfLimit })
  /** Decision 29: a failing or missing variability result blocks the Reportable Result. */
  | { readonly kind: 'not-judged'; readonly analyte: AnalyteKey; readonly limit: Written; readonly value: Rational; readonly because: 'variability' };

export type Outcome = 'conforms' | 'does-not-conform' | 'not-judged';

export type SectionVerdict = {
  readonly jurisdiction: Jurisdiction;
  readonly ruleSetVersion: string;
  /** Preparation-first: every Preparation judged on its own, in the order given. */
  readonly preparations: NonEmpty<{ readonly preparation: PreparationId; readonly lines: NonEmpty<LineVerdict> }>;
  readonly reportable: NonEmpty<ReportableLineVerdict>;
  /** The Reportable Results' verdict, worst first. A failing Preparation is reported above. */
  readonly outcome: Outcome;
  readonly calculation: CalculationVersion;
};

// ---------------------------------------------------------------------------------------------
// Variability between Preparations: the Method's Acceptance Criterion (decision 29, #37 §1, §3)
// ---------------------------------------------------------------------------------------------

/** The statistic the Method names. Only the relative difference of a pair is built. */
export type VariabilityStatistic = 'relative-difference' | 'rsd' | 'absolute-difference';

/** An NMT limit, in percent for a relative statistic, judged by ADR 0006's rule. */
export type VariabilityCriterion = {
  readonly statistic: VariabilityStatistic;
  readonly limit: Written;
  readonly source: CriterionSource;
};

export type PairVariability = {
  readonly preparations: readonly [PreparationId, PreparationId];
  readonly value: Rational; // |a − b| / mean × 100, from the unrounded results
  readonly compared: Written;
  readonly within: boolean;
};

export type VariabilityVerdict =
  | {
      readonly kind: 'judged'; readonly analyte: AnalyteKey; readonly limit: Written;
      readonly pairs: NonEmpty<PairVariability>; readonly conforms: boolean; readonly calculation: CalculationVersion;
    }
  | { readonly kind: 'missing'; readonly analyte: AnalyteKey; readonly because: 'one-preparation' | 'zero-mean' }
  | { readonly kind: 'not-built'; readonly analyte: AnalyteKey; readonly statistic: VariabilityStatistic };

const ZERO: Rational = { num: 0n, den: 1n };
const TWO: Rational = { num: 2n, den: 1n };
const HUNDRED: Rational = { num: 100n, den: 1n };
const abs = (x: Rational): Rational => (x.num < 0n ? { num: -x.num, den: x.den } : x);

/** Decision 29 checks every pair of Preparations; the LOQ exclusion is not built. */
function judgeVariability(
  criterion: VariabilityCriterion, analyte: AnalyteKey, results: NonEmpty<{ readonly preparation: PreparationId; readonly value: Rational }>,
): VariabilityVerdict {
  if (criterion.statistic !== 'relative-difference') return { kind: 'not-built', analyte, statistic: criterion.statistic };
  const pairs: PairVariability[] = [];
  for (const [i, a] of results.entries()) {
    for (const b of results.slice(i + 1)) {
      const mean = abs(div(add(a.value, b.value), TWO));
      if (compare(mean, ZERO) === 0) return { kind: 'missing', analyte, because: 'zero-mean' };
      const value = mul(div(abs(sub(a.value, b.value)), mean), HUNDRED);
      const compared = roundTo(value, criterion.limit.decimals, 'half-away-from-zero');
      pairs.push({ preparations: [a.preparation, b.preparation], value, compared,
                   within: compare(toRational(compared), toRational(criterion.limit)) <= 0 });
    }
  }
  const [first, ...rest] = pairs;
  if (!first) return { kind: 'missing', analyte, because: 'one-preparation' };
  return { kind: 'judged', analyte, limit: criterion.limit, pairs: [first, ...rest],
           conforms: pairs.every((p) => p.within), calculation: CALCULATION_VERSION };
}

// ---------------------------------------------------------------------------------------------
// The Test
// ---------------------------------------------------------------------------------------------

export type TestJudgementInput = {
  readonly sections: NonEmpty<SpecificationSection>;
  readonly preparations: NonEmpty<PreparationResults>;
  /** From the Method version; null when the Method sets no variability limit. */
  readonly variability: VariabilityCriterion | null;
};

export type TestJudgement =
  | {
      readonly kind: 'judged';
      /** One per Analyte, judged once whatever the Sections. Empty when the Method sets no limit. */
      readonly variability: readonly VariabilityVerdict[];
      readonly sections: NonEmpty<SectionVerdict>;
      readonly outcome: Outcome;
    }
  | { readonly kind: 'result-missing'; readonly preparation: PreparationId; readonly analyte: AnalyteKey };

const worst = (outcomes: readonly Outcome[]): Outcome =>
  outcomes.includes('does-not-conform') ? 'does-not-conform' : outcomes.includes('not-judged') ? 'not-judged' : 'conforms';

function judgeLine(line: SpecificationLine, rounding: RoundingMode, value: Rational): LineVerdict {
  const compared = roundTo(value, line.limit.decimals, rounding);
  return { analyte: line.analyte, limit: line.limit, rounding, compared,
           conforms: compare(toRational(compared), toRational(line.limit)) <= 0 };
}

function shareOf(value: Rational, limit: Written): ShareOfLimit {
  const percent = mul(div(value, toRational(limit)), HUNDRED);
  return { percent, displayPercent: formatWritten(roundTo(percent, 1, 'half-away-from-zero')) };
}

/**
 * Judges the Method's variability between Preparations, every Preparation, then the Reportable
 * Result (their mean at full precision) against every Section. Each Section rounds the same
 * full-precision values once, by its own Rule Set; one Section's rounding never feeds another's.
 * A Reportable Result whose variability failed or is missing is not judged.
 */
export function judgeTest({ sections, preparations, variability }: TestJudgementInput): TestJudgement {
  for (const section of sections) {
    for (const line of section.lines) {
      const missing = preparations.find((p) => !p.results.has(line.analyte));
      if (missing) return { kind: 'result-missing', preparation: missing.preparation, analyte: line.analyte };
    }
  }
  const resultOf = (p: PreparationResults, analyte: AnalyteKey): Rational => p.results.get(analyte)!;
  const analytes = [...new Set(sections.flatMap((s) => s.lines.map((l) => l.analyte)))];
  const variabilityVerdicts = variability === null ? [] : analytes.map((analyte) =>
    judgeVariability(variability, analyte, mapNonEmpty(preparations, (p) => ({ preparation: p.preparation, value: resultOf(p, analyte) }))));
  const variabilityHolds = (analyte: AnalyteKey): boolean => {
    const v = variabilityVerdicts.find((x) => x.analyte === analyte);
    return v === undefined || (v.kind === 'judged' && v.conforms);
  };

  const judgeSection = (section: SpecificationSection): SectionVerdict => {
    const roundingOf = (line: SpecificationLine): RoundingMode => (line.uspClaim ? 'half-away-from-zero' : section.rounding);
    const linesFor = (p: PreparationResults): NonEmpty<LineVerdict> =>
      mapNonEmpty(section.lines, (line) => judgeLine(line, roundingOf(line), resultOf(p, line.analyte)));
    const reportableFor = (line: SpecificationLine): ReportableLineVerdict => {
      const value = reportableResult(mapNonEmpty(preparations, (p) => resultOf(p, line.analyte)));
      if (!variabilityHolds(line.analyte)) return { kind: 'not-judged', analyte: line.analyte, limit: line.limit, value, because: 'variability' };
      return { ...judgeLine(line, roundingOf(line), value), kind: 'judged', value, share: shareOf(value, line.limit) };
    };
    const reportable = mapNonEmpty(section.lines, reportableFor);
    return {
      jurisdiction: section.jurisdiction,
      ruleSetVersion: section.ruleSetVersion,
      preparations: mapNonEmpty(preparations, (p) => ({ preparation: p.preparation, lines: linesFor(p) })),
      reportable,
      outcome: worst(reportable.map((l) => (l.kind === 'not-judged' ? 'not-judged' : l.conforms ? 'conforms' : 'does-not-conform'))),
      calculation: CALCULATION_VERSION,
    };
  };

  const verdicts = mapNonEmpty(sections, judgeSection);
  return { kind: 'judged', variability: variabilityVerdicts, sections: verdicts, outcome: worst(verdicts.map((s) => s.outcome)) };
}
