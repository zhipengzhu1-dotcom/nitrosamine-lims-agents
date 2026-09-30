// How a Specification Line's limit is derived (decision 29). An AI-derived limit is the Acceptable
// Intake over the Section's maximum daily dose, ng/day ÷ mg/day = ppm, computed exactly and rounded
// down to the decimals the limit is written to, never half up: rounding up would allow more than
// the Acceptable Intake.

import { div, toRational, type Written } from './decimal.ts';

/** AI ÷ MDD, rounded down to `decimals`. Both inputs are positive, parsed so at the boundary. */
export function aiDerivedLimit(acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written, decimals: number): Written {
  const exact = div(toRational(acceptableIntakeNgPerDay), toRational(maximumDailyDoseMgPerDay));
  return { unscaled: (exact.num * 10n ** BigInt(decimals)) / exact.den, decimals };
}

/** The limit as written equals AI ÷ MDD rounded down to the limit's own decimals. */
export function aiDerivationHolds(limit: Written, acceptableIntakeNgPerDay: Written, maximumDailyDoseMgPerDay: Written): boolean {
  return aiDerivedLimit(acceptableIntakeNgPerDay, maximumDailyDoseMgPerDay, limit.decimals).unscaled === limit.unscaled;
}
