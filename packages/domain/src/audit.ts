import type {
  AuditedTable,
  ChainKind,
  ChainVerification,
  Instant,
  RawEntry,
  RecordRef,
  RowSnapshot,
  ShownValue,
  TrailChange,
  TrailEntry,
} from './http.ts';

type LabelOf = (table: AuditedTable, id: unknown) => string;

interface FieldSpec {
  label: string;
  /** A reference to another audited record, shown by that record's label as it stood at the entry's time. */
  ref?: AuditedTable;
  /** A reference whose table is named by another column of the same row. */
  refBy?: string;
  /** Bytes the database stored as text, decoded for reading. */
  utf8?: true;
  /** A field a forward step moves, so a change to it is not a change to a saved value. */
  workflow?: true;
}

interface RecordSpec {
  kind: string;
  chain: ChainKind;
  label: (row: RowSnapshot, labelOf: LabelOf) => string;
  fields: Record<string, FieldSpec>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

/** How each audited table reads in a trail: its glossary noun, which chain it is captured on, its label and its fields' names. */
export const auditedRecords: { readonly [T in AuditedTable]: RecordSpec } = {
  customer: { kind: 'Customer', chain: 'company', label: (row) => text(row.name), fields: { name: { label: 'Name' } } },
  person: {
    kind: 'Person',
    chain: 'company',
    label: (row) => text(row.display_name),
    fields: {
      username: { label: 'Username' },
      display_name: { label: 'Printed name' },
      customer_id: { label: 'Customer', ref: 'customer' },
      failed_logins: { label: 'Failed sign-ins', workflow: true },
      locked_at: { label: 'Locked at', workflow: true },
    },
  },
  method: {
    kind: 'Method',
    chain: 'company',
    label: (row) => `${text(row.code)} v${text(row.version)}`,
    fields: { code: { label: 'Code' }, version: { label: 'Version' }, title: { label: 'Title' } },
  },
  submission: {
    kind: 'Submission',
    chain: 'company',
    label: (row, labelOf) => `Submission from ${labelOf('customer', row.customer_id)}`,
    fields: {
      customer_id: { label: 'Customer', ref: 'customer' },
      submitted_by: { label: 'Submitted by', ref: 'person' },
    },
  },
  sample: {
    kind: 'Sample',
    chain: 'lab',
    label: (row) => text(row.number),
    fields: {
      number: { label: 'Number' },
      description: { label: 'Description' },
      received_at: { label: 'Received', workflow: true },
      submission_id: { label: 'Submission', ref: 'submission' },
    },
  },
  test: {
    kind: 'Test',
    chain: 'lab',
    // A Test is named by its Sample, as the Test page's heading names it.
    label: (row, labelOf) => labelOf('sample', row.sample_id),
    fields: {
      state: { label: 'State', workflow: true },
      gxp_class: { label: 'GxP Class' },
      assignee_id: { label: 'Analyst', ref: 'person', workflow: true },
      method_id: { label: 'Method', ref: 'method' },
      sample_id: { label: 'Sample', ref: 'sample' },
    },
  },
  result: {
    kind: 'Result',
    chain: 'lab',
    label: (row) => `${text(row.analyte)} ${text(row.value)} ${text(row.unit)}`,
    fields: {
      analyte: { label: 'Analyte' },
      value: { label: 'Value' },
      unit: { label: 'Unit' },
      injection_sequence_ref: { label: 'Injection sequence' },
      notebook_ref: { label: 'Notebook reference' },
      performed_on: { label: 'Performed on' },
      entered_by: { label: 'Entered by', ref: 'person' },
      test_id: { label: 'Test', ref: 'test' },
    },
  },
  test_report: {
    kind: 'Test Report',
    chain: 'lab',
    label: (row) => text(row.number),
    fields: { number: { label: 'Number' }, test_id: { label: 'Test', ref: 'test' } },
  },
  signature: {
    kind: 'Signature',
    chain: 'lab',
    label: (row) => text(row.meaning),
    fields: {
      meaning: { label: 'Meaning' },
      person_id: { label: 'Signer', ref: 'person' },
      record_table: { label: 'Record kind' },
      record_id: { label: 'Record', refBy: 'record_table' },
      content: { label: 'Signed Record Version', utf8: true },
      content_hash: { label: 'SHA-256 of the Record Version' },
      signed_at: { label: 'Signed at' },
    },
  },
};

export const auditedTables = Object.keys(auditedRecords).filter((key): key is AuditedTable =>
  Object.hasOwn(auditedRecords, key),
);
export const isAuditedTable = (value: unknown): value is AuditedTable => auditedTables.some((t) => t === value);

/** The columns every row carries that say nothing about the change. */
const UNLISTED = new Set(['id', 'lab_id']);

/** One captured row image of an audited record, from which its label at that time is read. */
export interface HistoryEntry {
  table: AuditedTable;
  at: Instant;
  row: RowSnapshot;
}

function decodeUtf8Bytes(value: unknown): string {
  const hex = typeof value === 'string' && value.startsWith('\\x') ? value.slice(2) : null;
  if (hex === null || hex.length % 2 !== 0) return text(value);
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  return new TextDecoder().decode(bytes);
}

/** Labels at the time of one entry: the latest captured image of the record at or before `at`, or its first image when the record's history starts later. */
function labelsAt(history: readonly HistoryEntry[], at: Instant) {
  const imageAt = (table: AuditedTable, matches: (row: RowSnapshot) => boolean): RowSnapshot | null => {
    let latest: HistoryEntry | null = null;
    let first: HistoryEntry | null = null;
    for (const h of history) {
      if (h.table !== table || !matches(h.row)) continue;
      if (h.at <= at && (latest === null || h.at >= latest.at)) latest = h;
      if (first === null || h.at < first.at) first = h;
    }
    return (latest ?? first)?.row ?? null;
  };
  const labelOf: LabelOf = (table, id) => {
    const row = imageAt(table, (r) => r.id === id);
    return row ? auditedRecords[table].label(row, labelOf) : text(id);
  };
  const actorLabel = (actor: string): string => {
    const username = actor.startsWith('person:') ? actor.slice('person:'.length) : null;
    const row = username === null ? null : imageAt('person', (r) => r.username === username);
    return row ? text(row.display_name) : actor;
  };
  return { labelOf, actorLabel };
}

/** An instant rendered on the wall clock of `zone`: `YYYY-MM-DD HH:MM:SS` and the zone's offset from UTC at that instant. */
export function inZone(at: Instant, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
    // oxlint-disable-next-line no-restricted-globals -- parses the database's instant to render it; reads no clock
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const offset = part('timeZoneName').replace(/^GMT$/, 'GMT+00:00').slice('GMT'.length);
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} ${offset}`;
}

/** The records whose history a trail needs for its labels: each entry's own record and every record its rows reference. */
export function referencedRecords(entries: readonly RawEntry[]): { table: AuditedTable; ids: string[] }[] {
  const ids = new Map<AuditedTable, Set<string>>();
  const add = (table: unknown, id: unknown) => {
    if (!isAuditedTable(table) || typeof id !== 'string') return;
    ids.set(table, (ids.get(table) ?? new Set()).add(id));
  };
  for (const e of entries) {
    for (const row of [e.oldRow, e.newRow]) {
      if (!row) continue;
      add(e.table, row.id);
      if (!isAuditedTable(e.table)) continue;
      for (const [column, field] of Object.entries(auditedRecords[e.table].fields))
        add(field.ref ?? (field.refBy === undefined ? undefined : row[field.refBy]), row[column]);
    }
  }
  return [...ids].map(([table, set]) => ({ table, ids: [...set] }));
}

const byTime = (a: RawEntry, b: RawEntry) =>
  a.at.localeCompare(b.at) || a.chain.localeCompare(b.chain) || Number(BigInt(a.seq) - BigInt(b.seq));

/**
 * Reads raw Audit Trail entries into the panel's entries, in time order: each with its chain, its actor and records
 * labelled as they stood at the entry's time (from `history` and from the entries' own row images), its fields by
 * their glossary names, and the raw entry it was read from.
 */
export function describeTrail(
  entries: readonly RawEntry[],
  history: readonly HistoryEntry[],
  lab: { id: string; zone: string },
): TrailEntry[] {
  const images: HistoryEntry[] = entries.flatMap((e) => {
    const row = e.newRow ?? e.oldRow;
    return row && isAuditedTable(e.table) ? [{ table: e.table, at: e.at, row }] : [];
  });
  const known = [...history, ...images];
  return [...entries].sort(byTime).map((e) => {
    const { labelOf, actorLabel } = labelsAt(known, e.at);
    const row = e.newRow ?? e.oldRow ?? {};
    const spec = isAuditedTable(e.table) ? auditedRecords[e.table] : null;
    const record: RecordRef = {
      table: e.table,
      id: text(row.id),
      kind: spec?.kind ?? e.table,
      label: spec && isAuditedTable(e.table) ? labelOf(e.table, row.id) : text(row.id),
    };
    const shown = (column: string, value: unknown): ShownValue | null => {
      if (value === null || value === undefined) return null;
      const field = spec?.fields[column];
      const refTable = field?.ref ?? (field?.refBy === undefined ? undefined : row[field.refBy]);
      if (isAuditedTable(refTable))
        return { text: labelOf(refTable, value), ref: { table: refTable, id: text(value) } };
      return { text: field?.utf8 ? decodeUtf8Bytes(value) : text(value), ref: null };
    };
    const before: RowSnapshot = e.oldRow ?? {};
    const after: RowSnapshot = e.newRow ?? {};
    const listed = Object.keys(spec?.fields ?? {});
    const position = (column: string) => (listed.includes(column) ? listed.indexOf(column) : listed.length);
    const changes: TrailChange[] = Object.keys({ ...before, ...after })
      .sort((a, b) => position(a) - position(b) || a.localeCompare(b))
      .filter(
        (column) =>
          !UNLISTED.has(column) && JSON.stringify(before[column] ?? null) !== JSON.stringify(after[column] ?? null),
      )
      .map((column) => ({
        field: column,
        label: spec?.fields[column]?.label ?? column,
        old: shown(column, before[column]),
        new: shown(column, after[column]),
      }));
    return {
      chain: e.chain === lab.id ? 'lab' : 'company',
      seq: e.seq,
      at: e.at,
      atLab: e.chain === lab.id ? inZone(e.at, lab.zone) : null,
      actor: { label: actorLabel(e.actor), role: e.role },
      reason: e.reason,
      op: e.op,
      record,
      changes,
      afterFirstSave: e.op === 'UPDATE' && changes.some((c) => !spec?.fields[c.field]?.workflow),
      raw: e,
    };
  });
}

/** What QA reads after a chain is recomputed: how far it is intact, and the first entry that fails, when one does. */
export function chainVerification(chain: ChainKind, lastEntry: string, firstFailure: string | null): ChainVerification {
  if (firstFailure === null)
    return { chain, lastEntry, intactThrough: lastEntry, firstFailure, report: `intact through entry ${lastEntry}` };
  if (BigInt(firstFailure) > BigInt(lastEntry))
    return {
      chain,
      lastEntry,
      intactThrough: lastEntry,
      firstFailure,
      report: `the chain head does not match entry ${lastEntry}; intact through entry ${lastEntry}`,
    };
  const intactThrough = String(BigInt(firstFailure) - 1n);
  return {
    chain,
    lastEntry,
    intactThrough,
    firstFailure,
    report: `entry ${firstFailure} fails to verify; intact through entry ${intactThrough}`,
  };
}
