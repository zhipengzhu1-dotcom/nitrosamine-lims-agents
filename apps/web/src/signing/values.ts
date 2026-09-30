import type { PreparedSigningDto } from '@lims/contract';
import { sha256Hex, type SignedValue, type SourceFile } from '../model';


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

const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObject) : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const cited = (c: Record<string, unknown>): string => `Record Version ${str(c['version'])}, SHA-256 ${str(c['sha256'])}`;
const line = (label: string, value: string): SignedValue => ({ label, value, unit: null, draft: false });

/** A Section's Reportable Results as the version's judgement recorded them: rounded once, beside the limit as written. */
function judgementLines(judgement: unknown): SignedValue[] {
  if (!isObject(judgement)) return [];
  if (judgement['kind'] !== 'judged') return [line('Judgement', 'Not judged: a result is missing')];
  return list(judgement['sections']).flatMap((s) =>
    list(s['reportable']).map((r) =>
      line(
        `${str(s['jurisdiction'])} Section, ${str(r['analyte'])} Reportable Result`,
        r['kind'] === 'judged'
          ? `${str(r['compared'])} ppm against NMT ${str(r['limit'])} ppm: ${r['conforms'] ? 'conforms' : 'does not conform'}, ${str(r['sharePercent'])} % of limit`
          : `not judged (${str(r['because'])}); NMT ${str(r['limit'])} ppm`,
      ),
    ),
  );
}

/**
 * What each body schema lists under "What you are signing" beyond its typed values: a Test's Run
 * Versions and verdicts (rule 13), a Run's instrument and Run Checks, a report's Test Versions. A
 * schema this table does not know lists only its values, version and hash.
 */
const LISTERS: { readonly [schema: string]: (body: Record<string, unknown>) => readonly SignedValue[] } = {
  'value@1': (body) => {
    const v = valueText(body['value']);
    const subject = typeof body['subject'] === 'string' && body['subject'] !== '' ? ` (${body['subject']})` : '';
    return [{ label: `${String(body['field'])}${subject}`, value: v.text, unit: v.unit, draft: false }];
  },
  'test@1': (body) => [
    ...list(body['runs']).map((r) => line(`Run ${str(r['number'])}`, cited(r))),
    ...judgementLines(body['judgement']),
  ],
  'run@1': (body) => [
    ...(isObject(body['instrument']) ? [line('Instrument', str(body['instrument']['equipment']))] : []),
    ...list(body['runChecks']).map((c) => line(`Run Check ${str(c['name'])}`, str(c['outcome']))),
  ],
  'test_report@1': (body) => list(body['tests']).map((t) => line(`Test ${str(t['number'])}`, cited(t))),
};

type Item = PreparedSigningDto['items'][number];

export const shownValue = (v: Item['values'][number]): SignedValue => ({ label: v.label, value: v.text, unit: v.unit, draft: false, by: v.by });

export function signedValues(item: Pick<Item, 'body' | 'values' | 'pendingChanges'>): readonly SignedValue[] {
  const body = item.body;
  const own = isObject(body) && typeof body['schema'] === 'string' ? (LISTERS[body['schema']]?.(body) ?? []) : [];
  const changes = item.pendingChanges.map((p): SignedValue => {
    const from = valueText(bodyValue(p.from));
    const to = valueText(bodyValue(p.to));
    return { label: `${p.label}, proposed change`, value: `${from.text} → ${to.text}`, unit: to.unit, draft: false };
  });
  return [...item.values.map(shownValue), ...own, ...changes];
}

/** The source files a version cites: a Run's True Copy, by its SHA-256. */
export function sourceFilesOf(item: Pick<Item, 'body'>): SourceFile[] {
  const body = item.body;
  if (!isObject(body) || !isObject(body['trueCopy'])) return [];
  const sha = str(body['trueCopy']['fileSha256']);
  return /^[0-9a-f]{64}$/.test(sha) ? [{ name: 'True Copy', sha256: sha256Hex(sha) }] : [];
}
