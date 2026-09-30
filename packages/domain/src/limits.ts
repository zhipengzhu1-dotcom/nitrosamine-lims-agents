// How a Specification Line's limit is derived (decision 29). An AI-derived limit is the Acceptable
// Intake over the Section's maximum daily dose, ng/day ÷ mg/day = ppm, computed exactly and rounded
// down to the decimals the limit is written to, never half up: rounding up would allow more than
// the Acceptable Intake.

import { div, formatWritten, toRational, type Written } from './decimal.ts';
import type { GateResult } from './gates.ts';
import type { GateReason } from './refusal.ts';
import type { Jurisdiction } from './verdict.ts';

/** AI ÷ MDD, rounded down to `decimals`. Both inputs are positive, parsed so at the boundary. */
export function aiDerivedLimit(acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written, decimals: number): Written {
  const exact = div(toRational(acceptableIntakeNgPerDay), toRational(maximumDailyDoseMgPerDay));
  return { unscaled: (exact.num * 10n ** BigInt(decimals)) / exact.den, decimals };
}

/** The limit as written equals AI ÷ MDD rounded down to the limit's own decimals. */
export function aiDerivationHolds(limit: Written, acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written): boolean {
  return aiDerivedLimit(acceptableIntakeNgPerDay, maximumDailyDoseMgPerDay, limit.decimals).unscaled === limit.unscaled;
}

export type DerivedLine = { readonly analyte: string; readonly limit: Written; readonly acceptableIntakeNgPerDay: Written };
export type DerivedSection = { readonly jurisdiction: Jurisdiction; readonly maximumDailyDoseMgPerDay: Written; readonly lines: readonly DerivedLine[] };

/** Every AI-derived line of a Specification version holds its derivation, or the version is refused. */
export function derivationGate(sections: readonly DerivedSection[]): GateResult {
  const reasons: GateReason[] = sections.flatMap((s) => s.lines
    .filter((l) => !aiDerivationHolds(l.limit, l.acceptableIntakeNgPerDay, s.maximumDailyDoseMgPerDay))
    .map((l): GateReason => ({
      code: 'limit-not-derived', jurisdiction: s.jurisdiction, analyte: l.analyte, limit: formatWritten(l.limit),
      derived: formatWritten(aiDerivedLimit(l.acceptableIntakeNgPerDay, s.maximumDailyDoseMgPerDay, l.limit.decimals)),
      acceptableIntake: formatWritten(l.acceptableIntakeNgPerDay), maximumDailyDose: formatWritten(s.maximumDailyDoseMgPerDay),
    })));
  const [first, ...rest] = reasons;
  return first === undefined ? { go: true } : { go: false, reasons: [first, ...rest] };
}
