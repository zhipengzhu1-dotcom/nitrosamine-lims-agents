// Verdicts, both pure:
//   judgeCriterion      an Acceptance Criterion, such as a Run Check (ADR 0006).
//   judgeSpecification  Preparation Results against a Specification's Sections (decision 29, ADR 0003).
// Every verdict records the Calculation Version that produced it, and is stored with the version it
// judged, so a later Calculation Version never changes a recorded verdict.

import { reportableResult, type PreparationResults } from './calculation.ts';
import {
  compare, div, mul, roundTo, toRational,
  type Rational, type RoundingMode, type Written,
} from './decimal.ts';
import type { AnalyteKey, PreparationId } from './ids.ts';
import { mapNonEmpty, type NonEmpty } from './nonempty.ts';

export const CALCULATION_VERSION = 'calc-2026.1'; // QA-approved; changing it is change control
export type CalculationVersion = typeof CALCULATION_VERSION;

// ---------------------------------------------------------------------------------------------
// Acceptance Criteria (ADR 0006)
// ---------------------------------------------------------------------------------------------

export type Criterion =
  | { readonly op: 'NMT'; readonly limit: Written }
  | { readonly op: 'NLT'; readonly limit: Written }
  | { readonly op: 'range'; readonly low: Written; readonly high: Written };

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
    };

const boundsOf = (c: Criterion): NonEmpty<{ readonly op: 'NLT' | 'NMT'; readonly limit: Written }> =>
  c.op === 'range' ? [{ op: 'NLT', limit: c.low }, { op: 'NMT', limit: c.high }] : [c];

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
      if (limit.decimals < valueDecimals) return { kind: 'criterion-coarser-than-export', valueDecimals, limitDecimals: limit.decimals };
      if (limit.decimals > valueDecimals) return { kind: 'export-coarser-than-criterion', valueDecimals, limitDecimals: limit.decimals };
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

export type ReportableLineVerdict = LineVerdict & {
  readonly value: Rational; // the full-precision Reportable Result
  readonly percentOfLimit: Written; // server-computed, one decimal, never compared
};

export type SectionVerdict = {
  readonly jurisdiction: Jurisdiction;
  readonly ruleSetVersion: string;
  /** Preparation-first: every Preparation judged on its own, in the order given. */
  readonly preparations: NonEmpty<{ readonly preparation: PreparationId; readonly lines: NonEmpty<LineVerdict> }>;
  readonly reportable: NonEmpty<ReportableLineVerdict>;
  /** The Section's verdict: every Reportable Result conforms. A failing Preparation is reported above. */
  readonly conforms: boolean;
  readonly calculation: CalculationVersion;
};

export type SpecificationJudgement =
  | { readonly kind: 'judged'; readonly sections: NonEmpty<SectionVerdict>; readonly conforms: boolean }
  | { readonly kind: 'result-missing'; readonly preparation: PreparationId; readonly analyte: AnalyteKey };

const HUNDRED: Rational = { num: 100n, den: 1n };

function judgeLine(line: SpecificationLine, rounding: RoundingMode, value: Rational): LineVerdict {
  const compared = roundTo(value, line.limit.decimals, rounding);
  return { analyte: line.analyte, limit: line.limit, rounding, compared,
           conforms: compare(toRational(compared), toRational(line.limit)) <= 0 };
}

/**
 * Judges every Preparation, then the Reportable Result (their mean at full precision), against
 * every Section. Each Section rounds the same full-precision values once, by its own Rule Set; one
 * Section's rounding never feeds another's.
 */
export function judgeSpecification(
  sections: NonEmpty<SpecificationSection>,
  preparations: NonEmpty<PreparationResults>,
): SpecificationJudgement {
  for (const section of sections) {
    for (const line of section.lines) {
      const missing = preparations.find((p) => !p.results.has(line.analyte));
      if (missing) return { kind: 'result-missing', preparation: missing.preparation, analyte: line.analyte };
    }
  }
  const resultOf = (p: PreparationResults, analyte: AnalyteKey): Rational => p.results.get(analyte)!;

  const judgeSection = (section: SpecificationSection): SectionVerdict => {
    const roundingOf = (line: SpecificationLine): RoundingMode => (line.uspClaim ? 'half-away-from-zero' : section.rounding);
    const linesFor = (p: PreparationResults): NonEmpty<LineVerdict> =>
      mapNonEmpty(section.lines, (line) => judgeLine(line, roundingOf(line), resultOf(p, line.analyte)));
    const reportableFor = (line: SpecificationLine): ReportableLineVerdict => {
      const value = reportableResult(mapNonEmpty(preparations, (p) => resultOf(p, line.analyte)));
      return {
        ...judgeLine(line, roundingOf(line), value),
        value,
        percentOfLimit: roundTo(mul(div(value, toRational(line.limit)), HUNDRED), 1, 'half-away-from-zero'),
      };
    };
    const reportable = mapNonEmpty(section.lines, reportableFor);
    return {
      jurisdiction: section.jurisdiction,
      ruleSetVersion: section.ruleSetVersion,
      preparations: mapNonEmpty(preparations, (p) => ({ preparation: p.preparation, lines: linesFor(p) })),
      reportable,
      conforms: reportable.every((l) => l.conforms),
      calculation: CALCULATION_VERSION,
    };
  };

  const verdicts = mapNonEmpty(sections, judgeSection);
  return { kind: 'judged', sections: verdicts, conforms: verdicts.every((s) => s.conforms) };
}
