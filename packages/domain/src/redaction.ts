import type { ExportedEntry, RowSnapshot, ShownValue, TrailEntry } from './http.ts';

export const REDACTED = '[redacted]';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces every identifier in `others` with REDACTED in readable and raw values alike, and never touches one in `own`, even where it contains one in `others`. */
export function redactionFor(own: readonly string[], others: readonly string[]): (entry: TrailEntry) => ExportedEntry {
  const mine = new Set(own);
  const theirs = others.filter((s) => s.trim() !== '' && !mine.has(s));
  const pattern =
    theirs.length === 0
      ? null
      : new RegExp(
          `(?<![\\p{L}\\p{N}])(?:${[...new Set([...theirs, ...own.filter((s) => s.trim() !== '')])]
            .sort((a, b) => b.length - a.length)
            .map((s) => escaped(s))
            .join('|')})(?![\\p{L}\\p{N}])`,
          'gu',
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
