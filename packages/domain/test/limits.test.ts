import { describe, expect, it } from 'vitest';
import { formatWritten, written } from '../src/decimal.ts';
import { toRefusal } from '../src/gates.ts';
import { aiDerivedLimit, aiDerivationHolds, derivationGate } from '../src/limits.ts';

// The owner's 2026-09-30 ruling on decision 29: an AI-derived limit is AI ÷ MDD, computed exactly
// and rounded half up to two significant figures. A line states exactly that value or a lower one
// written to at least its decimals, since GN 7.20 rounds a result to the limit's decimals.
// NDMA 96 ng/day and NDEA 26.5 ng/day are FDA, Control of Nitrosamine Impurities in Human Drugs,
// Rev. 2 (Sept 2024), Table 1.
describe('an AI-derived limit is AI ÷ MDD rounded half up to two significant figures', () => {
  it.each([
    // AI ng/day, MDD mg/day, derived
    ['96', '2550', '0.038'], // metformin IR: 0.037647…, FDA prints 0.038
    ['96', '320', '0.30'], // exactly 0.3: the trailing zero is the second significant figure
    ['26.5', '1000', '0.027'], // an exact tie, 0.0265, goes up
    ['99.5', '1000', '0.10'], // 0.0995 carries into the next decade, still two figures
    ['99.5', '10', '10'], // 9.95 carries to 10
    ['96', '330', '0.29'], // 0.290909… does not terminate
    ['96', '7', '14'], // 13.714285…
    ['96', '50', '1.9'],
    ['96', '1200', '0.080'],
    ['96', '0.5', '190'], // 192: two figures above the units place
    ['99.5', '1', '100'], // 99.5 carries to three digits, two of them significant
    ['1.234', '100000', '0.000012'],
  ])('AI %s over MDD %s is %s', (ai, mdd, derived) => {
    expect(formatWritten(aiDerivedLimit(written(ai), written(mdd)))).toBe(derived);
  });

  it.each([
    // AI ng/day, MDD mg/day, limit as written, holds
    ['96', '2550', '0.038', true],
    ['96', '2550', '0.04', false], // looser than 0.038
    ['96', '2550', '0.0381', false], // looser, with more decimals
    ['96', '2550', '0.037', true], // tighter
    ['96', '2550', '0.0375', true], // tighter, with more decimals
    ['96', '2550', '0.030', true],
    ['96', '2550', '0.03', false], // lower, but written with fewer decimals than 0.038: write 0.030
    ['96', '310', '0.3', false], // lower than 0.31, yet a result of 0.34 rounds to 0.3 and would conform
    ['96', '320', '0.30', true],
    ['96', '320', '0.3', false], // the same number, but a result is then rounded to one decimal: 0.34 would conform
    ['96', '320', '0.300', false], // the same number, not the derived value as written
    ['26.5', '1000', '0.026', true], // tighter than the tie rounded up
    ['99.5', '1000', '0.10', true],
    ['99.5', '1000', '0.1', false],
  ])('AI %s over MDD %s: limit %s holds %s', (ai, mdd, limit, holds) => {
    expect(aiDerivationHolds(written(limit), written(ai), written(mdd))).toBe(holds);
  });
});

describe('the Specification refuses a line looser than its derivation', () => {
  const ndma = { analyte: 'NDMA', acceptableIntakeNgPerDay: written('96') };
  const ndea = { analyte: 'NDEA', acceptableIntakeNgPerDay: written('26.5') };

  it('lets every derived or tighter line through', () => {
    expect(derivationGate([{ jurisdiction: 'FDA', maximumDailyDoseMgPerDay: written('1000'), lines: [{ ...ndma, limit: written('0.096') }, { ...ndea, limit: written('0.027') }] }]))
      .toEqual({ go: true });
    expect(derivationGate([{ jurisdiction: 'FDA', maximumDailyDoseMgPerDay: written('2550'), lines: [{ ...ndma, limit: written('0.0375') }] }]))
      .toEqual({ go: true });
  });

  it('names each looser line, with the derived value it must not exceed', () => {
    const gate = derivationGate([
      { jurisdiction: 'FDA', maximumDailyDoseMgPerDay: written('2550'), lines: [{ ...ndma, limit: written('0.04') }] },
      { jurisdiction: 'EMA', maximumDailyDoseMgPerDay: written('320'), lines: [{ ...ndma, limit: written('0.30') }, { ...ndea, limit: written('0.084') }] },
    ]);
    expect(gate).toEqual({ go: false, reasons: [
      { code: 'limit-not-derived', jurisdiction: 'FDA', analyte: 'NDMA', limit: '0.04', derived: '0.038', acceptableIntake: '96', maximumDailyDose: '2550' },
      { code: 'limit-not-derived', jurisdiction: 'EMA', analyte: 'NDEA', limit: '0.084', derived: '0.083', acceptableIntake: '26.5', maximumDailyDose: '320' },
    ] });
    if (gate.go) throw new Error('expected a refusal');
    expect(toRefusal(gate).message).toBe(
      'The FDA limit for NDMA is written 0.04 ppm, but 96 ng/day ÷ 2550 mg/day rounded half up to two significant figures is 0.038 ppm. Write 0.038, or a lower limit with at least as many decimals. '
      + 'The EMA limit for NDEA is written 0.084 ppm, but 26.5 ng/day ÷ 320 mg/day rounded half up to two significant figures is 0.083 ppm. Write 0.083, or a lower limit with at least as many decimals.');
  });
});
