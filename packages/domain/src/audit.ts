import type {
  AuditedTable,
  ChainBreak,
  ChainKind,
  ChainReading,
  Instant,
  RawEntry,
  RecordRef,
  RowSnapshot,
  ShownValue,
  TrailChange,
  TrailEntry,
} from './http.ts';

type LabelOf = (table: AuditedTable, id: unknown) => string;

type Shows = 'utf8' | 'hex' | 'recordKind' | 'instant';

interface FieldSpec {
  label: string;
  ref?: AuditedTable;
  refTableIn?: string;
  shows?: Shows;
  movedByStep?: true;
}

interface RecordSpec {
  kind: string;
  chain: ChainKind;
  label: (row: RowSnapshot, labelOf: LabelOf) => string;
  fields: Record<string, FieldSpec>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));
const plain = (shown: string): ShownValue => ({ text: shown, ref: null, instant: null });

/** The one place that says how each audited table reads: its glossary noun, its chain, its label and its fields' names. */
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
      identity_verification_id: { label: 'Identity Verification' },
      failed_logins: { label: 'Failed sign-ins', movedByStep: true },
      locked_at: { label: 'Locked at', shows: 'instant', movedByStep: true },
      reduced_motion: { label: 'Reduce motion', movedByStep: true },
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
    label: (row, labelOf) => `from ${labelOf('customer', row.customer_id)}`,
    fields: {
      number: { label: 'Number' },
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
      received_at: { label: 'Received', shows: 'instant', movedByStep: true },
      submission_id: { label: 'Submission', ref: 'submission' },
    },
  },
  test: {
    kind: 'Test',
    chain: 'lab',
    label: (row, labelOf) => labelOf('sample', row.sample_id),
    fields: {
      state: { label: 'State', movedByStep: true },
      gxp_class: { label: 'GxP Class' },
      assignee_id: { label: 'Analyst', ref: 'person', movedByStep: true },
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
  record_version: {
    kind: 'Record Version',
    chain: 'lab',
    label: (row) => text(row.version),
    fields: {
      record_table: { label: 'Record kind', shows: 'recordKind' },
      record_id: { label: 'Record', refTableIn: 'record_table' },
      version: { label: 'Version' },
      canonical_form: { label: 'Canonical form' },
      content: { label: 'Canonical content', shows: 'utf8' },
      content_hash: { label: 'SHA-256 of the content', shows: 'hex' },
      saved_at: { label: 'Saved at', shows: 'instant' },
    },
  },
  signature: {
    kind: 'Signature',
    chain: 'lab',
    label: (row) => text(row.meaning),
    fields: {
      meaning: { label: 'Meaning' },
      person_id: { label: 'Signer', ref: 'person' },
      printed_name: { label: 'Printed name at signing' },
      username: { label: 'Username at signing' },
      role: { label: 'Role at signing' },
      record_version_id: { label: 'Record Version', ref: 'record_version' },
      content_hash: { label: 'SHA-256 of the signed content', shows: 'hex' },
      canonical_form: { label: 'Canonical form' },
      statement_version: { label: 'Signature statement version' },
      statement_hash: { label: 'Signature statement hash', shows: 'hex' },
      authenticator: { label: 'Authenticator' },
      session_id: { label: 'Session' },
      app_release: { label: 'App release' },
      reauthentication_id: { label: 'Re-authentication', ref: 'reauthentication' },
      signed_at: { label: 'Signed at', shows: 'instant' },
    },
  },
  audit_export: {
    kind: 'Audit Export',
    chain: 'lab',
    label: (row, labelOf) => `for ${labelOf('customer', row.customer_id)}`,
    fields: {
      customer_id: { label: 'Customer', ref: 'customer' },
      requested_by: { label: 'Requested by', ref: 'person' },
      requested_role: { label: 'Requested as' },
      format: { label: 'Format' },
      entry_count: { label: 'Entries' },
      data_sha256: { label: 'SHA-256 of the data file' },
      pdf_sha256: { label: 'SHA-256 of the PDF' },
      generated_at: { label: 'Generated at' },
    },
  },
  signing_role: {
    kind: 'Signing role',
    chain: 'company',
    label: (row) => `${text(row.role)} signs ${text(row.meaning)}`,
    fields: { role: { label: 'Role' }, meaning: { label: 'Meaning' } },
  },
  signature_statement: {
    kind: 'Signature statement',
    chain: 'company',
    label: (row) => `version ${text(row.version)}`,
    fields: {
      version: { label: 'Version' },
      statement: { label: 'Statement', shows: 'utf8' },
      statement_hash: { label: 'SHA-256', shows: 'hex' },
      approved_at: { label: 'Approved at', shows: 'instant' },
    },
  },
  chain_verification: {
    kind: 'Chain Verification',
    chain: 'company',
    label: (row) => `${row.chain === 'company' ? 'company' : 'Lab'} chain through entry ${text(row.through)}`,
    fields: {
      chain: { label: 'Chain' },
      through: { label: 'Verified through entry' },
      head: { label: 'Hash of that entry', shows: 'hex' },
      recomputed_from: { label: 'Recomputed from entry' },
      verified_by: { label: 'Verified by', ref: 'person' },
      verified_at: { label: 'Verified at', shows: 'instant' },
    },
  },
  reauthentication: {
    kind: 'Re-authentication',
    chain: 'lab',
    label: (row, labelOf) => `${labelOf('person', row.person_id)} to sign ${text(row.meaning)}`,
    fields: {
      person_id: { label: 'Person', ref: 'person' },
      meaning: { label: 'Meaning' },
      authenticator: { label: 'Authenticator' },
      session_id: { label: 'Session' },
      at: { label: 'At', shows: 'instant' },
    },
  },
};

/** Every table `auditedRecords` reads, in registry order. */
export const auditedTables = Object.keys(auditedRecords).filter((key): key is AuditedTable =>
  Object.hasOwn(auditedRecords, key),
);
/** True only for a table name `auditedRecords` reads. */
export const isAuditedTable = (value: unknown): value is AuditedTable => auditedTables.some((t) => t === value);
/** The glossary noun of an audited table's records, such as "Test Report" for `test_report`; any other name as it is. */
export const recordKind = (table: unknown): string =>
  isAuditedTable(table) ? auditedRecords[table].kind : text(table);
/** The chain an entry sits on: the Lab's when its chain is that Lab's id, the company's otherwise. */
export const chainKindOf = (chain: string, labId: string): ChainKind => (chain === labId ? 'lab' : 'company');

function referenceOf(field: FieldSpec, row: RowSnapshot): AuditedTable | null {
  const table = field.ref ?? (field.refTableIn === undefined ? undefined : row[field.refTableIn]);
  return isAuditedTable(table) ? table : null;
}

/** The username behind a `person:` actor, and null for a service actor such as `svc:seed`. */
export const actorUsername = (actor: string): string | null =>
  actor.startsWith('person:') ? actor.slice('person:'.length) : null;

const UNLISTED = new Set(['id', 'lab_id']);

/** One row of an audited record as it stood at one instant. */
export interface RowImage {
  table: AuditedTable;
  at: Instant;
  row: RowSnapshot;
}
/** The records of one table whose images a trail still needs. */
export interface RecordIds {
  table: AuditedTable;
  ids: string[];
}

/** Each entry's own row image: the new row, or the old row of a deletion. */
export function imagesOf(entries: readonly RawEntry[]): RowImage[] {
  return entries.flatMap((e) => {
    const row = e.newRow ?? e.oldRow;
    return row && isAuditedTable(e.table) ? [{ table: e.table, at: e.at, row }] : [];
  });
}

const hexOf = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith('\\x') ? value.slice(2) : null;

function decodeUtf8Bytes(value: unknown): string {
  const hex = hexOf(value);
  if (hex === null || hex.length % 2 !== 0) return text(value);
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  return new TextDecoder().decode(bytes);
}

/** An instant a row snapshot stores, as the database renders it in UTC and on the owning Lab's wall clock. */
export interface StoredInstant {
  at: Instant;
  atLab: Instant;
}

/** Every instant the entries' row snapshots store, as stored, so that the API can have the database render each. */
export function storedInstants(entries: readonly RawEntry[]): string[] {
  const found = new Set<string>();
  for (const e of entries) {
    const spec = isAuditedTable(e.table) ? auditedRecords[e.table] : null;
    for (const row of [e.oldRow, e.newRow])
      for (const [column, field] of Object.entries(spec?.fields ?? {}))
        if (field.shows === 'instant' && row?.[column] !== undefined && row[column] !== null)
          found.add(text(row[column]));
  }
  return [...found];
}

const byAt = (a: RowImage, b: RowImage) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

function indexImages(images: readonly RowImage[]) {
  const byRecord = new Map<string, RowImage[]>();
  const byUsername = new Map<string, RowImage[]>();
  const push = (map: Map<string, RowImage[]>, key: string, image: RowImage) =>
    map.set(key, [...(map.get(key) ?? []), image]);
  for (const image of images) {
    if (typeof image.row.id === 'string') push(byRecord, `${image.table}:${image.row.id}`, image);
    if (image.table === 'person' && typeof image.row.username === 'string') push(byUsername, image.row.username, image);
  }
  for (const list of [...byRecord.values(), ...byUsername.values()]) list.sort(byAt);
  // The image at or before `at`; a record whose images all come later shows its first.
  const imageAt = (list: readonly RowImage[] | undefined, at: Instant): RowSnapshot | null => {
    let found = list?.[0];
    for (const image of list ?? []) if (image.at <= at) found = image;
    return found?.row ?? null;
  };
  return (at: Instant) => {
    const labelOf: LabelOf = (table, id) => {
      const row = typeof id === 'string' ? imageAt(byRecord.get(`${table}:${id}`), at) : null;
      return row ? auditedRecords[table].label(row, labelOf) : text(id);
    };
    const actorLabel = (actor: string): string => {
      const username = actorUsername(actor);
      const row = username === null ? null : imageAt(byUsername.get(username), at);
      return row ? text(row.display_name) : actor;
    };
    return { labelOf, actorLabel };
  };
}

/** The label of a record as its latest image gives it. */
export function currentLabel(images: readonly RowImage[], table: AuditedTable, id: string): string {
  const latest = [...images].sort(byAt).at(-1);
  return latest ? indexImages(images)(latest.at).labelOf(table, id) : id;
}

/** Every record the images reference, their own records included, so that `describeTrail` can label each. */
export function referencedRecords(images: readonly RowImage[]): RecordIds[] {
  const ids = new Map<AuditedTable, Set<string>>();
  const add = (table: AuditedTable | null, id: unknown) => {
    if (table === null || typeof id !== 'string') return;
    ids.set(table, (ids.get(table) ?? new Set()).add(id));
  };
  for (const { table, row } of images) {
    add(table, row.id);
    for (const [column, field] of Object.entries(auditedRecords[table].fields))
      add(referenceOf(field, row), row[column]);
  }
  return [...ids].map(([table, set]) => ({ table, ids: [...set] }));
}

/** An entry with its instant on the owning Lab's wall clock, which the API reads from the database beside `at`. */
export type TimedEntry = RawEntry & { atLab: Instant | null };

const bySeq = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: RawEntry, b: RawEntry) =>
  (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || a.chain.localeCompare(b.chain) || bySeq(a.seq, b.seq);

/** Every entry in time order, its people and records labelled as they stood at its time from `images` and the entries' own rows. */
export function describeTrail(
  entries: readonly TimedEntry[],
  images: readonly RowImage[],
  labId: string,
  instants: ReadonlyMap<string, StoredInstant>,
): TrailEntry[] {
  const labelsAt = indexImages([...images, ...imagesOf(entries)]);
  return [...entries].sort(byTime).map(({ atLab, ...e }) => {
    const { labelOf, actorLabel } = labelsAt(e.at);
    const row = e.newRow ?? e.oldRow ?? {};
    const spec = isAuditedTable(e.table) ? auditedRecords[e.table] : null;
    const record: RecordRef = {
      table: e.table,
      id: text(row.id),
      kind: recordKind(e.table),
      label: isAuditedTable(e.table) ? labelOf(e.table, row.id) : text(row.id),
    };
    const chain = chainKindOf(e.chain, labId);
    const shown = (column: string, value: unknown): ShownValue | null => {
      if (value === null || value === undefined) return null;
      const field = spec?.fields[column];
      const refTable = field ? referenceOf(field, row) : null;
      if (refTable) return { text: labelOf(refTable, value), ref: { table: refTable, id: text(value) }, instant: null };
      switch (field?.shows) {
        case 'utf8':
          return plain(decodeUtf8Bytes(value));
        case 'hex':
          return plain(hexOf(value) ?? text(value));
        case 'recordKind':
          return plain(recordKind(value));
        case 'instant': {
          const stored = instants.get(text(value));
          return {
            text: text(value),
            ref: null,
            instant: stored ? { at: stored.at, atLab: chain === 'lab' ? stored.atLab : null } : null,
          };
        }
        case undefined:
          return plain(text(value));
      }
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
      chain,
      seq: e.seq,
      at: e.at,
      atLab: chain === 'lab' ? atLab : null,
      actor: { label: actorLabel(e.actor), role: e.role },
      reason: e.reason,
      op: e.op,
      record,
      changes,
      afterFirstSave: e.op === 'UPDATE' && changes.some((c) => !spec?.fields[c.field]?.movedByStep),
      raw: e,
    };
  });
}

/**
 * What a break is, as `lims.chain_breaks` finds it: an entry that fails to verify, a run of entries that are gone, or,
 * after the last entry, a chain head that does not match it. `More` is every break after the ones a verification
 * records one by one, taken together.
 */
export type BreakKind = 'Changed' | 'Missing' | 'HeadMoved' | 'More';

/**
 * A break as the database found it, with the System Incident that records it, before it is read for QA; `through` is
 * the last entry it covers, and `breaks` how many breaks it is, one but for `More`.
 */
export type ChainBreakFound = Omit<ChainBreak, 'failure'> & { kind: BreakKind; through: string; breaks: number };

const failureOf = ({ entry, kind, through, breaks }: Omit<ChainBreakFound, 'incident' | 'incidentState'>) =>
  ({
    Changed: `entry ${entry} fails to verify`,
    Missing: through === entry ? `entry ${entry} is missing` : `entries ${entry} to ${through} are missing`,
    HeadMoved: `the chain head does not match entry ${String(BigInt(entry) - 1n)}`,
    More: `${breaks} more ${breaks === 1 ? 'break' : 'breaks'}, from entry ${entry} to entry ${through}`,
  })[kind];

/** A break as the screen reads it before its Status: where the chain fails and the System Incident that records it. */
export const breakLine = (b: ChainBreak) => `${b.failure}, recorded as System Incident ${b.incident}`;

/** A break as one line of text: `breakLine` and the System Incident's state now. */
export const breakReport = (b: ChainBreak) => `${breakLine(b)} (${b.incidentState})`;

export type Resumed = Pick<ChainReading, 'recomputedFrom' | 'verifiedBefore'>;

export const fromTheFirstEntry: Resumed = { recomputedFrom: '1', verifiedBefore: null };

/** Which entries a reading recomputed, and the Chain Verification before them that it trusted; `when` renders the Instant. */
export const resumedLine = (c: Resumed, when: (at: Instant) => string) =>
  c.verifiedBefore === null
    ? 'Every entry recomputed.'
    : `Recomputed from entry ${c.recomputedFrom}; entries through ${c.verifiedBefore.through} were verified ${when(c.verifiedBefore.at)} by ${c.verifiedBefore.by}.`;

/**
 * How QA reads a recomputed chain: intact through its last entry, or through the entry before its first break, with
 * every break and the System Incident that records each, which `breakReport` reads out, and where the recompute began.
 */
export function chainReading(
  chain: ChainKind,
  lastEntry: string,
  found: ChainBreakFound[],
  resumed: Resumed = fromTheFirstEntry,
): ChainReading {
  const breaks = found.map(({ entry, kind, through, breaks: count, incident, incidentState }) => ({
    entry,
    failure: failureOf({ entry, kind, through, breaks: count }),
    incident,
    incidentState,
  }));
  const [first] = breaks;
  if (first === undefined)
    return {
      chain,
      verdict: 'Intact',
      lastEntry,
      intactThrough: lastEntry,
      breaks,
      report: `verified through entry ${lastEntry}`,
      ...resumed,
    };
  const intactThrough = String(BigInt(first.entry) - 1n);
  return {
    chain,
    verdict: 'Broken',
    lastEntry,
    intactThrough,
    breaks,
    report: `intact through entry ${intactThrough}`,
    ...resumed,
  };
}
