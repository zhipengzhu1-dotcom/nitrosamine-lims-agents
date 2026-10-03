import type { Meaning, Signature } from './http.ts';

/**
 * The Signature Meanings a record's Signatures leave unsigned, in signing order: those given only on content the record
 * no longer holds. A meaning given again on the record as it reads now, such as Performed on a corrected Result, is not
 * one of them, though its earlier Signature stays listed as unsigned.
 */
export function unsignedMeanings(rows: readonly Pick<Signature, 'meaning' | 'unsigned'>[]): Meaning[] {
  const covered = new Set(rows.filter((s) => !s.unsigned).map((s) => s.meaning));
  return [...new Set(rows.filter((s) => s.unsigned && !covered.has(s.meaning)).map((s) => s.meaning))];
}
