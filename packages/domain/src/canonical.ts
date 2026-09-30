// Canonical content: the bytes a Record Version stores and a signature binds to.
//
// The type has no number. Quantities are decimal strings as written, counts and version numbers are
// strings, times are ISO-8601 UTC strings. So no float formatting, locale or "1e-7" can reach signed
// content. Keys are sorted by UTF-16 code units and strings are escaped as RFC 8785 does.
//
// These bytes are written once, when a version is sealed, and the database hashes the stored bytes.
// Nothing rebuilds them to check an old signature, so a later change to this serialiser can never
// flip a historic signature.

export type Canon =
  | string
  | boolean
  | null
  | readonly Canon[]
  | { readonly [key: string]: Canon };

const isList = (v: Canon): v is readonly Canon[] => Array.isArray(v);
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function quote(s: string): string {
  if (!s.isWellFormed()) throw new RangeError('string is not well-formed UTF-16; the boundary must refuse it');
  return JSON.stringify(s); // ECMAScript's escaping is the one RFC 8785 §3.2.2.2 specifies
}

export function canonicalText(value: Canon): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return quote(value);
  if (isList(value)) return `[${value.map(canonicalText).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError(`${typeof value} is not canonical content`);
  const members = Object.keys(value).sort(byCodeUnits).map((k) => `${quote(k)}:${canonicalText(value[k]!)}`);
  return `{${members.join(',')}}`;
}

export const canonicalBytes = (value: Canon): Uint8Array => new TextEncoder().encode(canonicalText(value));

/** Every version body starts with its schema tag, so a reader knows which builder wrote it. */
export type VersionBody<Schema extends string> = { readonly schema: Schema } & { readonly [key: string]: Canon };

/** A cited version inside a body: the Merkle link. */
export const cite = (ref: { readonly versionId: string; readonly hash: string }): Canon =>
  ({ version: ref.versionId, sha256: ref.hash });
