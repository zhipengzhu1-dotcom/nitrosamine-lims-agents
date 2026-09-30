import { describe, expect, it } from 'vitest';
import {
  compare, div, formatWritten, mean, parseWritten, roundTo, toRational, written,
  type Rational, type RoundingMode,
} from '../src/decimal.ts';

const r = (text: string): Rational => toRational(written(text));
const round = (text: string, decimals: number, mode: RoundingMode): string =>
  formatWritten(roundTo(r(text), decimals, mode));

describe('parseWritten', () => {
  it('keeps the written decimals, trailing zeros included', () => {
    expect(formatWritten(written('0.050'))).toBe('0.050');
    expect(formatWritten(written('0.05'))).toBe('0.05');
    expect(formatWritten(written('-12.340'))).toBe('-12.340');
    expect(formatWritten(written('10'))).toBe('10');
    expect(written('0.050')).toEqual({ unscaled: 50n, decimals: 3 });
    expect(compare(r('0.050'), r('0.05'))).toBe(0);
  });

  it.each(['1e-3', '.5', '+1', '1,5', '', ' 1', '1 ', '01', '1.', 'NaN', 'Infinity', '0x10', '1_000'])(
    'refuses %j as a value, not by throwing',
    (text) => {
      expect(parseWritten(text)).toEqual({ error: 'not-a-decimal', text });
    },
  );
});

describe('roundTo', () => {
  it.each([
    ['0.105', 2, '0.11'], ['-0.105', 2, '-0.11'], ['0.10495', 2, '0.10'], ['2.5', 0, '3'],
    ['-2.5', 0, '-3'], ['0.0549', 2, '0.05'], ['79.46', 0, '79'], ['1', 3, '1.000'],
  ] as const)('half away from zero: %s to %i places is %s', (value, decimals, expected) => {
    expect(round(value, decimals, 'half-away-from-zero')).toBe(expected);
  });

  it.each([
    ['0.105', 2, '0.10'], ['0.115', 2, '0.12'], ['0.125', 2, '0.12'], ['-0.125', 2, '-0.12'],
    ['0.1251', 2, '0.13'], ['2.5', 0, '2'], ['3.5', 0, '4'],
  ] as const)('half even (GB/T 8170): %s to %i places is %s', (value, decimals, expected) => {
    expect(round(value, decimals, 'half-even')).toBe(expected);
  });

  it('rounds a value that never terminates in decimal, exactly', () => {
    const third = div(r('1'), r('3'));
    expect(formatWritten(roundTo(third, 4, 'half-away-from-zero'))).toBe('0.3333');
    const twoThirds = div(r('2'), r('3'));
    expect(formatWritten(roundTo(twoThirds, 2, 'half-even'))).toBe('0.67');
  });
});

describe('mean', () => {
  it('is exact for a mean that does not terminate', () => {
    const m = mean([r('0.0344'), r('0.0348'), r('0.0348')]);
    expect(compare(m, div(r('0.1040'), r('3')))).toBe(0);
    expect(formatWritten(roundTo(m, 2, 'half-away-from-zero'))).toBe('0.03');
  });
});
