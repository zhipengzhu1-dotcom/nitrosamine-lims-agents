// The Result of one Preparation (decision 20 §3 "Calculation"), exact:
//
//   result [ppm = µg/g] = C [pg/µL] × V [mL] × DF / W [mg]      (pg/µL × mL = ng; ng / mg = µg/g)
//
// Every input is a Written as typed and Verified. The output stays a full-precision Rational until
// a verdict rounds it once.

import { compare, div, mean, mul, toRational, type Rational, type Written } from './decimal.ts';
import type { AnalyteKey, PreparationId } from './ids.ts';
import type { NonEmpty } from './nonempty.ts';

export type PreparationInputs = {
  readonly preparation: PreparationId;
  readonly weightMg: Written;
  readonly dilutionVolumeMl: Written;
  readonly dilutionFactor: Written; // from the Method version
  readonly concentrations: ReadonlyMap<AnalyteKey, Written>; // typed pg/µL per Analyte
};

export type PreparationResults = {
  readonly preparation: PreparationId;
  readonly results: ReadonlyMap<AnalyteKey, Rational>;
};

/** A weight or a volume is positive; a concentration is a reading, so zero is real and only a negative is refused (usp 3). */
export type Calculated =
  | { readonly kind: 'calculated'; readonly results: PreparationResults }
  | { readonly kind: 'weight-not-positive'; readonly preparation: PreparationId }
  | { readonly kind: 'dilution-not-positive'; readonly preparation: PreparationId }
  | { readonly kind: 'concentration-negative'; readonly preparation: PreparationId; readonly analyte: AnalyteKey };

const ZERO: Rational = { num: 0n, den: 1n };

export function calculatePreparation(p: PreparationInputs): Calculated {
  const weight = toRational(p.weightMg);
  if (compare(weight, ZERO) <= 0) return { kind: 'weight-not-positive', preparation: p.preparation };
  const volume = toRational(p.dilutionVolumeMl);
  if (compare(volume, ZERO) <= 0) return { kind: 'dilution-not-positive', preparation: p.preparation };
  const negative = [...p.concentrations].find(([, c]) => compare(toRational(c), ZERO) < 0);
  if (negative) return { kind: 'concentration-negative', preparation: p.preparation, analyte: negative[0] };
  const factor = mul(volume, toRational(p.dilutionFactor));
  const results = new Map<AnalyteKey, Rational>();
  for (const [analyte, c] of p.concentrations) results.set(analyte, div(mul(toRational(c), factor), weight));
  return { kind: 'calculated', results: { preparation: p.preparation, results } };
}

/** The Reportable Result: the mean of the Test's Preparations, at full precision (decision 29). */
export const reportableResult = (preparations: NonEmpty<Rational>): Rational => mean(preparations);
