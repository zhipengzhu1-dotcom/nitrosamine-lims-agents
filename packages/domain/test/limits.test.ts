import { describe, expect, it } from 'vitest';
import { formatWritten, written } from '../src/decimal.ts';
import { toRefusal } from '../src/gates.ts';
import { aiDerivedLimit, aiDerivationHolds, derivationGate } from '../src/limits.ts';

// Decision 29: an AI-derived limit is AI ÷ MDD, computed exactly and rounded down to the limit's
// written decimals. NDMA 96 ng/day and NDEA 26.5 ng/day are FDA, Control of Nitrosamine Impurities
// in Human Drugs, Rev. 2 (Sept 2024), Table 1. How many decimals a limit must be written to is an
// open map question, so no vector here decides it.
describe('an AI-derived limit is AI ÷ MDD rounded down to its written decimals', () => {
  it.each([
    // AI ng/day, MDD mg/day, limit as written, AI ÷ MDD rounded down to the limit's decimals, holds
    ['96', '320', '0.30', '0.30', true], // exactly 0.3
    ['96', '320', '0.3', '0.3', true], // fewer decimals is the map question, not refused here
    ['96', '320', '0.31', '0.30', false],
    ['96', '320', '0.29', '0.30', false], // stricter than derived is still not the derivation
    ['26.5', '1000', '0.026', '0.026', true], // 0.0265 rounds down, never half up to 0.027
    ['26.5', '1000', '0.027', '0.026', false],
    ['96', '330', '0.29', '0.29', true], // 0.290909… does not terminate
    ['96', '7', '13.71', '13.71', true], // 13.714285…
    ['96', '7', '13.72', '13.71', false],
    ['96', '50', '1', '1', true], // 1.92 at no decimals
    ['96', '50', '2', '1', false],
    ['96', '1200', '0.1', '0.0', false], // 0.08 at one decimal is 0.0
    ['96', '1200', '0.0', '0.0', true], // a zero limit matches: the stated digits are the map question
  ])('AI %s over MDD %s: limit %s against %s', (ai, mdd, limit, expected, holds) => {
    expect(formatWritten(aiDerivedLimit(written(ai), written(mdd), written(limit).decimals))).toBe(expected);
    expect(aiDerivationHolds(written(limit), written(ai), written(mdd))).toBe(holds);
  });

  it('keeps the limit\'s decimals in the derived value, so 0.30 and 0.3 are different writtens', () => {
    expect(aiDerivedLimit(written('96'), written('320'), 2)).toEqual({ unscaled: 30n, decimals: 2 });
    expect(aiDerivedLimit(written('96'), written('320'), 1)).toEqual({ unscaled: 3n, decimals: 1 });
  });
});

describe('the Specification refuses a line whose limit is not its derivation', () => {
  const ndma = { analyte: 'NDMA', acceptableIntakeNgPerDay: written('96') };
  const ndea = { analyte: 'NDEA', acceptableIntakeNgPerDay: written('26.5') };

  it('lets every derived line through', () => {
    expect(derivationGate([{ jurisdiction: 'FDA', maximumDailyDoseMgPerDay: written('1000'), lines: [{ ...ndma, limit: written('0.096') }, { ...ndea, limit: written('0.026') }] }]))
      .toEqual({ go: true });
  });

  it('names each line that differs, with the derivation it should have matched', () => {
    const gate = derivationGate([
      { jurisdiction: 'FDA', maximumDailyDoseMgPerDay: written('1000'), lines: [{ ...ndma, limit: written('0.096') }, { ...ndea, limit: written('0.027') }] },
      { jurisdiction: 'EMA', maximumDailyDoseMgPerDay: written('320'), lines: [{ ...ndma, limit: written('0.31') }] },
    ]);
    expect(gate).toEqual({ go: false, reasons: [
      { code: 'limit-not-derived', jurisdiction: 'FDA', analyte: 'NDEA', limit: '0.027', derived: '0.026', acceptableIntake: '26.5', maximumDailyDose: '1000' },
      { code: 'limit-not-derived', jurisdiction: 'EMA', analyte: 'NDMA', limit: '0.31', derived: '0.30', acceptableIntake: '96', maximumDailyDose: '320' },
    ] });
    if (gate.go) throw new Error('expected a refusal');
    expect(toRefusal(gate).message).toBe(
      'The FDA limit for NDEA is written 0.027 ppm, but 26.5 ng/day ÷ 1000 mg/day rounded down to 3 decimals is 0.026 ppm. '
      + 'The EMA limit for NDMA is written 0.31 ppm, but 96 ng/day ÷ 320 mg/day rounded down to 2 decimals is 0.30 ppm.');
  });
});
