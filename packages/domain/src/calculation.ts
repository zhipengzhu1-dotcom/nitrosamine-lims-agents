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

export type Calculated =
  | { readonly kind: 'calculated'; readonly results: PreparationResults }
  | { readonly kind: 'weight-not-positive'; readonly preparation: PreparationId };

const ZERO: Rational = { num: 0n, den: 1n };

export function calculatePreparation(p: PreparationInputs): Calculated {
  const weight = toRational(p.weightMg);
  if (compare(weight, ZERO) <= 0) return { kind: 'weight-not-positive', preparation: p.preparation };
  const factor = mul(toRational(p.dilutionVolumeMl), toRational(p.dilutionFactor));
  const results = new Map<AnalyteKey, Rational>();
  for (const [analyte, c] of p.concentrations) results.set(analyte, div(mul(toRational(c), factor), weight));
  return { kind: 'calculated', results: { preparation: p.preparation, results } };
}

/** The Reportable Result: the mean of the Test's Preparations, at full precision (decision 29). */
export const reportableResult = (preparations: NonEmpty<Rational>): Rational => mean(preparations);
