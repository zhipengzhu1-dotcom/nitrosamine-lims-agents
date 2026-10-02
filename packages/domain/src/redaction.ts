import { auditedRecords, isAuditedTable } from './audit.ts';
import type { ExportedEntry, RowSnapshot, ShownValue, TrailEntry } from './http.ts';

export const REDACTED = '[redacted]';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const folded = (s: string) => s.toLocaleLowerCase('en');
const alone = (body: string) => `(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`;
/** What a record ID, a Submission number or a Lab's Sample or Test Report number looks like, whichever Lab it is from. */
const IDENTIFIER_SHAPES = new RegExp(
  alone('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{2,4}-[SR]-\\d{4}-\\d{6}|SUB-\\d{4}-\\d{6}'),
  'giu',
);

/** The IDs the entries hold as references and keys, which name only this Lab's and the company's records. */
export function referencedIds(entries: readonly TrailEntry[]): string[] {
  return entries.flatMap((e) => {
    const fields = isAuditedTable(e.record.table) ? auditedRecords[e.record.table].fields : {};
    const keys = (row: RowSnapshot | null) =>
      Object.entries(row ?? {}).flatMap(([column, value]) => {
        const field = fields[column];
        const isKey =
          column === 'id' || column === 'lab_id' || field?.ref !== undefined || field?.refTableIn !== undefined;
        return isKey && typeof value === 'string' ? [value] : [];
      });
    return [e.record.id, ...keys(e.raw.oldRow), ...keys(e.raw.newRow)];
  });
}

/**
 * Replaces every identifier in `others`, in any case, with REDACTED in readable and raw values alike, and never
 * touches one in `own`, even where it contains one in `others`. Any other text shaped like a record ID or record
 * number, such as another Lab's Sample number typed into a shared record, is redacted too unless `own` or `shown`
 * holds it.
 */
export function redactionFor(
  own: readonly string[],
  others: readonly string[],
  shown: readonly string[],
): (entry: TrailEntry) => ExportedEntry {
  const mine = new Set(own.map((s) => folded(s)));
  const allowed = new Set([...mine, ...shown.map((s) => folded(s))]);
  const theirs = others.filter((s) => s.trim() !== '' && !mine.has(folded(s)));
  const named =
    theirs.length === 0
      ? null
      : new RegExp(
          alone(
            [...new Set([...theirs, ...own.filter((s) => s.trim() !== '')])]
              .sort((a, b) => b.length - a.length)
              .map((s) => escaped(s))
              .join('|'),
          ),
          'giu',
        );
  return (entry) => {
    let redacted = false;
    const unless = (keep: Set<string>) => (found: string) => {
      if (keep.has(folded(found))) return found;
      redacted = true;
      return REDACTED;
    };
    const text = (value: string) =>
      (named === null ? value : value.replace(named, unless(mine))).replace(IDENTIFIER_SHAPES, unless(allowed));
    const deep = (value: unknown): unknown => {
      if (typeof value === 'string') return text(value);
      if (Array.isArray(value)) return value.map((v) => deep(v));
      if (typeof value === 'object' && value !== null)
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]));
      return value;
    };
    const row = (snapshot: RowSnapshot | null): RowSnapshot | null =>
      snapshot && Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, deep(v)]));
    const value = (v: ShownValue | null): ShownValue | null =>
      v && { text: text(v.text), ref: v.ref && { table: v.ref.table, id: text(v.ref.id) } };
    const out: TrailEntry = {
      ...entry,
      actor: { label: text(entry.actor.label), role: entry.actor.role },
      reason: text(entry.reason),
      record: { ...entry.record, id: text(entry.record.id), label: text(entry.record.label) },
      changes: entry.changes.map((c) => ({ ...c, old: value(c.old), new: value(c.new) })),
      raw: {
        ...entry.raw,
        actor: text(entry.raw.actor),
        reason: text(entry.raw.reason),
        oldRow: row(entry.raw.oldRow),
        newRow: row(entry.raw.newRow),
      },
    };
    return { ...out, redacted };
  };
}
