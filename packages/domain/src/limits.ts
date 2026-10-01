// How a Specification Line's limit is derived: decision 29, as the owner ruled on 2026-09-30. An
// AI-derived limit is the Acceptable Intake over the Section's maximum daily dose, ng/day ÷ mg/day
// = ppm, computed exactly and rounded half up to two significant figures, as FDA prints it
// (metformin IR: 96 ÷ 2550 = 0.0376… is 0.038). A line states that value, or a lower one written to
// at least its decimals.

import { compare, div, formatWritten, roundTo, toRational, type Rational, type Written } from './decimal.ts';
import type { GateResult } from './gates.ts';
import type { GateReason } from './refusal.ts';
import type { Jurisdiction } from './verdict.ts';

const SIGNIFICANT_FIGURES = 2;

const pow10 = (e: number): Rational => (e >= 0 ? { num: 10n ** BigInt(e), den: 1n } : { num: 1n, den: 10n ** BigInt(-e) });

/** The exponent e with 10^e ≤ x < 10^(e+1), for a positive x. */
function decade(x: Rational): number {
  let e = x.num.toString().length - x.den.toString().length;
  while (compare(pow10(e), x) > 0) e -= 1;
  while (compare(pow10(e + 1), x) <= 0) e += 1;
  return e;
}

/** A positive x rounded half up to `figures` significant figures, written with exactly that many where the decimals allow. */
function roundToSignificant(x: Rational, figures: number): Written {
  let shift = figures - 1 - decade(x);
  let digits = roundTo(shift >= 0 ? { num: x.num * 10n ** BigInt(shift), den: x.den } : { num: x.num, den: x.den * 10n ** BigInt(-shift) }, 0, 'half-away-from-zero').unscaled;
  if (digits === 10n ** BigInt(figures)) {
    digits /= 10n;
    shift -= 1;
  }
  return shift >= 0 ? { unscaled: digits, decimals: shift } : { unscaled: digits * 10n ** BigInt(-shift), decimals: 0 };
}

/** AI ÷ MDD to two significant figures. Both inputs are positive, parsed so at the boundary. */
export function aiDerivedLimit(acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written): Written {
  return roundToSignificant(div(toRational(acceptableIntakeNgPerDay), toRational(maximumDailyDoseMgPerDay)), SIGNIFICANT_FIGURES);
}

/**
 * The limit is the derived value as written, or a lower value written to at least its decimals.
 * GN 7.20 rounds a result to the limit's decimals, so fewer decimals loosen it: `0.3` would pass
 * 0.34 where a derived `0.30` or `0.31` fails it.
 */
export function aiDerivationHolds(limit: Written, acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written): boolean {
  const derived = aiDerivedLimit(acceptableIntakeNgPerDay, maximumDailyDoseMgPerDay);
  const exact = limit.unscaled === derived.unscaled && limit.decimals === derived.decimals;
  return exact || (limit.decimals >= derived.decimals && compare(toRational(limit), toRational(derived)) < 0);
}

export type DerivedLine = { readonly analyte: string; readonly limit: Written; readonly acceptableIntakeNgPerDay: Written };
export type DerivedSection = { readonly jurisdiction: Jurisdiction; readonly maximumDailyDoseMgPerDay: Written; readonly lines: readonly DerivedLine[] };

/** Every AI-derived line of a Specification version holds its derivation, or the version is refused. */
export function derivationGate(sections: readonly DerivedSection[]): GateResult {
  const reasons: GateReason[] = sections.flatMap((s) => s.lines
    .filter((l) => !aiDerivationHolds(l.limit, l.acceptableIntakeNgPerDay, s.maximumDailyDoseMgPerDay))
    .map((l): GateReason => ({
      code: 'limit-not-derived', jurisdiction: s.jurisdiction, analyte: l.analyte, limit: formatWritten(l.limit),
      derived: formatWritten(aiDerivedLimit(l.acceptableIntakeNgPerDay, s.maximumDailyDoseMgPerDay)),
      acceptableIntake: formatWritten(l.acceptableIntakeNgPerDay), maximumDailyDose: formatWritten(s.maximumDailyDoseMgPerDay),
    })));
  const [first, ...rest] = reasons;
  return first === undefined ? { go: true } : { go: false, reasons: [first, ...rest] };
}
