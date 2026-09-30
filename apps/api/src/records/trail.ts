// A record's Audit Trail as a person reads it (decision 23 rule 12, decision 13): the record's own
// entries and those of every record under it (its Recorded Values, by record.parent_id), each
// naming the person with username and role, the record by its label, every changed field by name
// with old -> new as text, and the Reason for Change in words. Rows filed under a version (a
// value's typed text, a turned-down proposal, a stored verdict) come with their version's record.
// Stored bytes and internal ids are never printed; a person column prints the person's name.

import type { DB, ReadDb } from '@lims/db';
import type { AuditEntryDto } from '@lims/contract';
import { CHANGE_REASONS, STAFF_ROLE_LABEL } from '@lims/contract/session';
import type { RecordId } from '@lims/domain/ids';
import type { KindRegistry } from './kinds.ts';
import { labelOf } from './values.ts';

type Q = ReadDb<DB>;
type Change = AuditEntryDto['changes'][number];
type Columns = Readonly<Record<string, readonly [unknown, unknown]>>;

/** Columns that identify a row or repeat the entry's own who and when; the entry already says both. */
const QUIET = new Set(['id', 'lab_id', 'ledger_id', 'record_id', 'parent_id', 'version_id', 'created_at', 'created_by', 'app_release', 'content', 'content_hash', 'content_schema']);

const PERSON_COLUMNS = new Set(['assigned_analyst', 'acquired_by', 'reviewer_id', 'entered_by', 'received_by', 'person_id']);

const COLUMN_LABEL: Readonly<Record<string, string>> = {
  state: 'State',
  number: 'Number',
  seq: 'Test number on the Sample',
  assigned_analyst: 'Assigned Analyst',
  acceptance_reason: 'Reason given at Acceptance',
  method_id: 'Method requested',
  method_version_id: 'Method version',
  specification_version_id: 'Specification version',
  gxp_class: 'GxP Class',
  customer_id: 'Customer',
  sample_id: 'Sample',
  acquired_by: 'Acquired by',
  entry_mode: 'Entry mode',
  reviews_record_id: 'Reviews',
  checklist_version: 'Review Checklist',
  reviewer_id: 'Reviewer',
  prep_no: 'Preparation',
  test_id: 'Test',
  run_id: 'Run',
  report_id: 'Test Report',
  submission_id: 'Submission',
};

const REASON: Readonly<Record<string, string>> = {
  first_save: 'First save',
  action: 'Workflow step',
  ...Object.fromEntries(CHANGE_REASONS.map((r) => [r.code, r.label])),
};

const humanize = (column: string): string => {
  const words = column.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const text = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : JSON.stringify(v));

const reasonOf = (code: string, reasonText: string | null): string => {
  if (code === 'other') return reasonText ?? 'Other';
  const label = REASON[code] ?? code;
  return reasonText ? `${label}: ${reasonText}` : label;
};

/** The record and every record under it, by record.parent_id. */
async function descendants(q: Q, root: RecordId): Promise<{ id: string; kind: string }[]> {
  const out: { id: string; kind: string }[] = [];
  let level = await q.selectFrom('record').select(['id', 'kind']).where('id', '=', root).execute();
  while (level.length > 0) {
    out.push(...level);
    level = await q.selectFrom('record').select(['id', 'kind']).where('parent_id', 'in', level.map((r) => r.id)).execute();
  }
  return out;
}

export async function readTrail(q: Q, kinds: KindRegistry, root: RecordId): Promise<AuditEntryDto[]> {
  const records = await descendants(q, root);
  if (records.length === 0) return [];
  const recordIds = records.map((r) => r.id);
  const labels = new Map<string, string>();
  for (const r of records) labels.set(r.id, await kinds.get(r.kind).label(q, r.id as RecordId));

  const versions = await q.selectFrom('record_version').select(['id', 'record_id', 'version_no', 'content_hash', 'requires_approval']).where('record_id', 'in', recordIds).execute();
  const versionOf = new Map(versions.map((v) => [v.id, v]));

  const values = await q.selectFrom('recorded_value as rv').innerJoin('record as p', 'p.id', 'rv.parent_id')
    .select(['rv.record_id', 'rv.field', 'rv.subject', 'rv.unit', 'rv.critical', 'p.kind as parent_kind']).where('rv.record_id', 'in', recordIds).execute();
  const valueOf = new Map(values.map((v) => [v.record_id, { ...v, label: labelOf(kinds.get(v.parent_kind).fields, v) }]));

  // A signature row names its version, not a record, so its entry is found by its key.
  const signatures = versions.length === 0 ? [] : await q.selectFrom('signature').select('id').where('record_version_id', 'in', versions.map((v) => v.id)).execute();
  const rows = await q.selectFrom('audit_entry as e').innerJoin('person as p', 'p.id', 'e.person_id').leftJoin('account as a', 'a.person_id', 'e.person_id')
    .select(['e.ledger_id', 'e.seq', 'e.at', 'e.role', 'e.action', 'e.reason_code', 'e.reason_text', 'e.table_name', 'e.op', 'e.changes', 'e.record_id', 'p.printed_name', 'a.username'])
    .where((eb) => eb.or([
      eb('e.record_id', 'in', [...recordIds, ...versions.map((v) => v.id)]),
      ...(signatures.length === 0 ? [] : [eb.and([eb('e.table_name', '=', 'signature'), eb('e.row_pk', 'in', signatures.map((x) => JSON.stringify([x.id])))])]),
    ]))
    .orderBy('e.at').orderBy('e.seq').execute();

  const people = new Map<string, string>();
  const personName = async (id: unknown): Promise<string | null> => {
    if (typeof id !== 'string') return text(id);
    if (!people.has(id)) {
      const p = await q.selectFrom('person').select('printed_name').where('id', '=', id).executeTakeFirst();
      people.set(id, p?.printed_name ?? id);
    }
    return people.get(id) ?? id;
  };

  const lastText = new Map<string, string>();
  const withUnit = (t: string, unit: string | null) => (unit ? `${t} ${unit}` : t);

  const entries: AuditEntryDto[] = [];
  for (const r of rows) {
    const cols = r.changes as unknown as Columns;
    const now = (column: string): unknown => cols[column]?.[1];
    const versionKey = r.table_name === 'record_version' ? now('id') : r.table_name === 'signature' ? now('record_version_id') : r.record_id;
    const version = typeof versionKey === 'string' ? versionOf.get(versionKey) : undefined;
    const owner = version ? version.record_id : (r.record_id ?? root);
    const value = valueOf.get(owner);
    let changes: Change[];
    switch (r.table_name) {
      case 'record':
        changes = [];
        break;
      case 'recorded_value':
        changes = [{ field: 'Recorded Value', from: null, to: `${value?.label ?? text(now('field'))}${value?.unit ? `, in ${value.unit}` : ''}${value?.critical ? ', critical' : ''}` }];
        break;
      case 'record_version':
        changes = version ? [{ field: 'Record Version', from: null, to: `Version ${version.version_no}, SHA-256 ${version.content_hash.toString('hex').slice(0, 8)}${version.requires_approval ? ', needs a second person\'s approval' : ''}` }] : [];
        break;
      case 'recorded_value_version': {
        const typed = text(now('value_text')) ?? '';
        const shown = withUnit(typed, value?.unit ?? null);
        changes = [{ field: value?.label ?? 'Value', from: lastText.get(owner) ?? null, to: shown }];
        lastText.set(owner, shown);
        break;
      }
      case 'signature':
        changes = [{
          field: 'Electronic Signature', from: null,
          to: `${text(now('meaning'))} by ${text(now('printed_name'))} (${text(now('username'))}), ${STAFF_ROLE_LABEL[text(now('role')) ?? ''] ?? text(now('role'))}${version ? `, on Version ${version.version_no}` : ''}`,
        }];
        break;
      case 'version_rejection':
        changes = [{ field: `Proposed change${version ? ` (Version ${version.version_no})` : ''}`, from: null, to: 'Turned down' }];
        break;
      case 'record_lock':
        changes = [{ field: 'Release lock', from: null, to: 'Locked' }];
        break;
      case 'record_version_cite':
        changes = [{ field: 'Cites', from: null, to: `Record Version ${text(now('cited_version'))}` }];
        break;
      case 'section_verdict':
        changes = [{ field: `${text(now('jurisdiction'))} verdict, ${text(now('analyte'))}`, from: null, to: `${text(now('outcome'))}: ${text(now('compared_text')) ?? 'not judged'} against NMT ${text(now('limit_text'))} ppm` }];
        break;
      default: {
        changes = [];
        for (const [column, [from, to]] of Object.entries(cols)) {
          if (QUIET.has(column)) continue;
          const person = PERSON_COLUMNS.has(column);
          changes.push({ field: COLUMN_LABEL[column] ?? humanize(column), from: person ? await personName(from) : text(from), to: person ? await personName(to) : text(to) });
        }
      }
    }
    entries.push({
      seq: Number(r.seq), atUtc: r.at.toISOString(), person: r.printed_name, username: r.username ?? '', role: r.role, action: r.action,
      reason: reasonOf(r.reason_code, r.reason_text), record: labels.get(owner) ?? 'Record', changes,
      afterFirstSave: r.op === 'update' || (r.reason_code !== 'first_save' && r.reason_code !== 'action'),
    });
  }
  return entries;
}
