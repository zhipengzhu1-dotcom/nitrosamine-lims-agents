import type { Sentence } from './sentence.ts';

/** The decided password rule (#13): at least 15 characters, with an uppercase and a lowercase letter, a digit and a symbol. */
export const DECIDED_PASSWORD = { minLength: 15, allTypes: true } as const;
/** The demo-login exception's rule (ADR 0002), which the real-data gate refuses. */
export const DEMO_PASSWORD = { minLength: 4, allTypes: false } as const;
export type PasswordRule = typeof DECIDED_PASSWORD | typeof DEMO_PASSWORD;

const TYPES = [
  { pattern: /\p{Lu}/u, name: 'an uppercase letter' },
  { pattern: /\p{Ll}/u, name: 'a lowercase letter' },
  { pattern: /\p{Nd}/u, name: 'a digit' },
  { pattern: /[^\p{L}\p{Nd}]/u, name: 'a symbol' },
] as const;

/** Why `rule` refuses `password`, as a sentence for the person choosing it; null when the rule accepts it. */
export function passwordRefusal(rule: PasswordRule, password: string): Sentence | null {
  const length = Array.from(password).length;
  if (length < rule.minLength) return `A password needs at least ${rule.minLength} characters.`;
  const missing = rule.allTypes ? TYPES.filter((type) => !type.pattern.test(password)).map((type) => type.name) : [];
  if (missing.length === 0) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return `A password needs ${list}.`;
}
