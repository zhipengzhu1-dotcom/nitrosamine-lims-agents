import type { PreparedSigningDto } from '@lims/contract';
import type { SignedValue } from '../model';

type Body = PreparedSigningDto['items'][number]['body'];
type Pending = PreparedSigningDto['items'][number]['pendingChanges'][number];

/** A stored canonical value, printed from its stored string (rule 20), never from a number. */
type CanonValue =
  | { readonly type: 'decimal'; readonly value: string; readonly unit: string }
  | { readonly type: 'text' | 'ref'; readonly value: string }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'blob'; readonly sha256: string; readonly mediaType: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function valueText(v: unknown): { text: string; unit: string | null } {
  if (!isObject(v)) return { text: JSON.stringify(v), unit: null };
  const c = v as CanonValue;
  switch (c.type) {
    case 'decimal':
      return { text: c.value, unit: c.unit };
    case 'text':
    case 'ref':
      return { text: c.value, unit: null };
    case 'boolean':
      return { text: c.value ? 'Yes' : 'No', unit: null };
    case 'blob':
      return { text: `File ${c.sha256}`, unit: null };
  }
}

/** The value inside a value@1 body, which is the typed value its version holds. */
const bodyValue = (body: unknown): unknown => (isObject(body) ? body['value'] : body);

/**
 * What each body schema lists under "What you are signing". A schema this table does not know
 * lists nothing beyond its version and hash, which is what the signature binds to anyway; the
 * sample-chain unit adds its Test and Run schemas here.
 */
const LISTERS: { readonly [schema: string]: (body: Record<string, unknown>) => readonly SignedValue[] } = {
  'value@1': (body) => {
    const v = valueText(body['value']);
    const subject = typeof body['subject'] === 'string' && body['subject'] !== '' ? ` (${body['subject']})` : '';
    return [{ label: `${String(body['field'])}${subject}`, value: v.text, unit: v.unit, draft: false }];
  },
};

export function signedValues(body: Body, pending: readonly Pending[]): readonly SignedValue[] {
  const own = isObject(body) && typeof body['schema'] === 'string' ? (LISTERS[body['schema']]?.(body) ?? []) : [];
  const changes = pending.map((p): SignedValue => {
    const from = valueText(bodyValue(p.from));
    const to = valueText(bodyValue(p.to));
    return { label: `${p.label}, proposed change`, value: `${from.text} → ${to.text}`, unit: to.unit, draft: false };
  });
  return [...own, ...changes];
}
