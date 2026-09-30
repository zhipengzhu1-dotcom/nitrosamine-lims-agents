import { describe, expect, it } from 'vitest';
import { calculatePreparation, reportableResult } from '../src/calculation.ts';
import { compare, div, toRational, written } from '../src/decimal.ts';
import type { AnalyteKey, PreparationId } from '../src/ids.ts';

const NDMA = 'NDMA' as AnalyteKey;
const NDEA = 'NDEA' as AnalyteKey;
const prep = 'prep-1' as PreparationId;

describe('calculatePreparation', () => {
  it('gives ppm = C [pg/µL] × V [mL] × DF / W [mg], exactly, per Analyte', () => {
    const c = calculatePreparation({
      preparation: prep,
      weightMg: written('100.12'),
      dilutionVolumeMl: written('10.00'),
      dilutionFactor: written('1'),
      concentrations: new Map([[NDMA, written('1.234')], [NDEA, written('0.500')]]),
    });
    if (c.kind !== 'calculated') throw new Error(c.kind);
    expect(c.results.preparation).toBe(prep);
    // 1.234 × 10.00 × 1 / 100.12 = 12.34 / 100.12
    expect(compare(c.results.results.get(NDMA)!, div(toRational(written('12.34')), toRational(written('100.12'))))).toBe(0);
    expect(compare(c.results.results.get(NDEA)!, div(toRational(written('5')), toRational(written('100.12'))))).toBe(0);
  });

  it.each(['0', '0.000', '-1.5'])('refuses a weight of %s as a value, not by dividing', (w) => {
    expect(calculatePreparation({
      preparation: prep, weightMg: written(w), dilutionVolumeMl: written('10'),
      dilutionFactor: written('1'), concentrations: new Map([[NDMA, written('1')]]),
    })).toEqual({ kind: 'weight-not-positive', preparation: prep });
  });

  it.each(['0', '0.00', '-10'])('refuses a dilution volume of %s (usp 3): a volume is positive', (v) => {
    expect(calculatePreparation({
      preparation: prep, weightMg: written('100.12'), dilutionVolumeMl: written(v),
      dilutionFactor: written('1'), concentrations: new Map([[NDMA, written('1')]]),
    })).toEqual({ kind: 'dilution-not-positive', preparation: prep });
  });

  it('refuses a negative concentration and names the Analyte; zero is a real reading', () => {
    const inputs = { preparation: prep, weightMg: written('100.12'), dilutionVolumeMl: written('10'), dilutionFactor: written('1') };
    expect(calculatePreparation({ ...inputs, concentrations: new Map([[NDMA, written('0.5')], [NDEA, written('-0.001')]]) }))
      .toEqual({ kind: 'concentration-negative', preparation: prep, analyte: NDEA });
    const zero = calculatePreparation({ ...inputs, concentrations: new Map([[NDMA, written('0')]]) });
    expect(zero.kind).toBe('calculated');
  });
});

describe('reportableResult', () => {
  it('is the mean of the Preparations at full precision', () => {
    const m = reportableResult([toRational(written('0.030')), toRational(written('0.036'))]);
    expect(compare(m, toRational(written('0.033')))).toBe(0);
  });
});
