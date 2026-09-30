// Exact numbers (ADR 0006). No float, Math.round or toFixed: they get the ties wrong, so an exact
// +0.105 % would compute as 0.10499… and pass.
//
// A Written is a value as typed, stored or printed. Its decimals are part of the value: "0.10" and
// "0.1" are different Writtens. A Rational is the result of arithmetic (a division by a weight, a
// mean of three Preparations), kept exact until the one rounding, `roundTo`, back to a Written at a
// limit's decimals.

import type { NonEmpty } from './nonempty.ts';

export type Written = Readonly<{ unscaled: bigint; decimals: number }>;
export type Rational = Readonly<{ num: bigint; den: bigint }>; // den > 0n

export type RoundingMode =
  | 'half-away-from-zero' // ADR 0006 and USP GN 7.20
  | 'half-even'; // GB/T 8170, when a Jurisdiction Rule Set says so (ADR 0003)

export type NotADecimal = { readonly error: 'not-a-decimal'; readonly text: string };

const DECIMAL_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** The only way a decimal enters the domain. Exponents, '+', '.5', separators and padding are refused. */
export function parseWritten(text: string): Written | NotADecimal {
  if (!DECIMAL_TEXT.test(text)) return { error: 'not-a-decimal', text };
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const magnitude = BigInt(whole + fraction);
  return { unscaled: negative ? -magnitude : magnitude, decimals: fraction.length };
}

/** A decimal literal in code or seed data. A malformed literal is a bug, so it throws. */
export function written(text: string): Written {
  const w = parseWritten(text);
  if ('error' in w) throw new RangeError(`not a decimal literal: ${JSON.stringify(text)}`);
  return w;
}

/** Prints exactly the written decimals. */
export function formatWritten(w: Written): string {
  const negative = w.unscaled < 0n;
  const digits = (negative ? -w.unscaled : w.unscaled).toString().padStart(w.decimals + 1, '0');
  const whole = digits.slice(0, digits.length - w.decimals);
  const fraction = digits.slice(digits.length - w.decimals);
  return (negative ? '-' : '') + whole + (w.decimals > 0 ? `.${fraction}` : '');
}

export const toRational = (w: Written): Rational => ({ num: w.unscaled, den: 10n ** BigInt(w.decimals) });

export const add = (a: Rational, b: Rational): Rational => ({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
export const sub = (a: Rational, b: Rational): Rational => add(a, { num: -b.num, den: b.den });
export const mul = (a: Rational, b: Rational): Rational => ({ num: a.num * b.num, den: a.den * b.den });

export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new RangeError('division by zero');
  return b.num < 0n ? { num: -a.num * b.den, den: -a.den * b.num } : { num: a.num * b.den, den: a.den * b.num };
}

export function mean(xs: NonEmpty<Rational>): Rational {
  const [first, ...rest] = xs;
  return div(rest.reduce(add, first), { num: BigInt(xs.length), den: 1n });
}

export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** The one rounding: to `decimals` places, exactly. +0.105 to 2 places half away from zero is 0.11. */
export function roundTo(x: Rational, decimals: number, mode: RoundingMode): Written {
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError(`decimals: ${decimals}`);
  const negative = x.num < 0n;
  const scaled = (negative ? -x.num : x.num) * 10n ** BigInt(decimals);
  let q = scaled / x.den;
  const twice = 2n * (scaled % x.den);
  const up = mode === 'half-away-from-zero'
    ? twice >= x.den
    : twice > x.den || (twice === x.den && q % 2n === 1n);
  if (up) q += 1n;
  return { unscaled: negative ? -q : q, decimals };
}
