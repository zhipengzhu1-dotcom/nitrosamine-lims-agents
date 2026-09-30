// Passwords: argon2id with a keyed pepper (the login research, OWASP parameters), and the rules
// decisions 7 and 22 set. The hash never leaves this module except into account.password_hash.

import { hash, verify } from '@node-rs/argon2';
import { BREACHED } from './breached.ts';

// Algorithm.Argon2id is a const enum, which verbatimModuleSyntax cannot import; its value is 2.
const PARAMS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pepper: Buffer, password: string): Promise<string> => hash(password, { ...PARAMS, secret: pepper });

export const verifyPassword = (pepper: Buffer, stored: string, password: string): Promise<boolean> =>
  verify(stored, password, { secret: pepper }).catch(() => false);

export type PasswordProblem =
  | 'too-short' // fewer than 15 characters
  | 'missing-character-type' // upper, lower, digit and symbol are all required
  | 'contains-name' // the user ID, the person's name or another forbidden name
  | 'breached'; // on the bundled breach list

export const MIN_PASSWORD_LENGTH = 15;

/**
 * Every rule the password breaks. `forbidden` carries the names it may not contain: the user ID,
 * the words of the printed name, and whatever else the caller knows (company, Customer, Product).
 */
export function passwordProblems(password: string, forbidden: readonly string[]): readonly PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if ([...password].length < MIN_PASSWORD_LENGTH) problems.push('too-short');
  if (!(/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && /\p{Nd}/u.test(password) && /[^\p{L}\p{Nd}]/u.test(password))) {
    problems.push('missing-character-type');
  }
  const lower = password.toLowerCase();
  if (forbidden.some((f) => f.length >= 3 && lower.includes(f.toLowerCase()))) problems.push('contains-name');
  if (BREACHED.has(lower)) problems.push('breached');
  return problems;
}

export const PASSWORD_PROBLEM_TEXT: { readonly [P in PasswordProblem]: string } = {
  'too-short': `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
  'missing-character-type': 'The password needs an upper-case letter, a lower-case letter, a digit and a symbol.',
  'contains-name': 'The password must not contain your user ID or name.',
  'breached': 'That password appears in a published breach; choose another.',
};
