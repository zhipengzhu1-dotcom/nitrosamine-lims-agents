import type { ExportedEntry, RowSnapshot, ShownValue, TrailEntry } from './http.ts';

/** What an Audit Export prints in place of another Customer's identifier. */
export const REDACTED = '[redacted]';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Redacts Audit Trail entries for one Customer: every occurrence of an identifier in `others` becomes REDACTED, in
 * readable and raw values alike, and an identifier in `own` is never touched, even where it contains one in `others`.
 * The match is by value, so it holds for any record that names another Customer's Sample, whatever its fields.
 */
export function redactionFor(own: readonly string[], others: readonly string[]): (entry: TrailEntry) => ExportedEntry {
  const mine = new Set(own);
  const theirs = others.filter((s) => s.trim() !== '' && !mine.has(s));
  const pattern =
    theirs.length === 0
      ? null
      : new RegExp(
          [...new Set([...theirs, ...own.filter((s) => s.trim() !== '')])]
            .sort((a, b) => b.length - a.length)
            .map((s) => escaped(s))
            .join('|'),
          'g',
        );
  return (entry) => {
    let redacted = false;
    const text = (value: string) =>
      pattern === null
        ? value
        : value.replace(pattern, (found) => {
            if (mine.has(found)) return found;
            redacted = true;
            return REDACTED;
          });
    const deep = (value: unknown): unknown => {
      if (typeof value === 'string') return text(value);
      if (Array.isArray(value)) return value.map((v) => deep(v));
      if (typeof value === 'object' && value !== null)
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]));
      return value;
    };
    const row = (snapshot: RowSnapshot | null): RowSnapshot | null =>
      snapshot && Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, deep(v)]));
    const shown = (value: ShownValue | null): ShownValue | null =>
      value && { text: text(value.text), ref: value.ref && { table: value.ref.table, id: text(value.ref.id) } };
    const out: TrailEntry = {
      ...entry,
      actor: { label: text(entry.actor.label), role: entry.actor.role },
      reason: text(entry.reason),
      record: { ...entry.record, id: text(entry.record.id), label: text(entry.record.label) },
      changes: entry.changes.map((c) => ({ ...c, old: shown(c.old), new: shown(c.new) })),
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
