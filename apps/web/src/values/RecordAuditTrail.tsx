import type { AuditEntryDto } from '@lims/contract';
import { useView } from '../api/hooks';
import { AuditTrailPanel } from '../components/AuditTrailPanel';
import type { AuditEntry } from '../model';
import { roleLabel } from '../session/store';

/** The audited tables a record's trail touches, named as a person reads them. */
const TABLE: { readonly [table: string]: string } = {
  record: 'Record',
  record_version: 'Record Version',
  record_version_cite: 'Record Version citation',
  recorded_value: 'Recorded Value',
  recorded_value_version: 'Recorded Value version',
  signature: 'Electronic Signature',
  version_rejection: 'Turned-down change',
  record_lock: 'Release lock',
};

const text = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * One panel row per changed column, since the trail stores each entry's columns as
 * {column: [old, new]}; an entry that changed no column (an event) is one row of its own. Each
 * ledger numbers its own chain, so a row's key is its place in the answer, not its seq.
 */
export function auditRows(entries: readonly AuditEntryDto[], zone: string): AuditEntry[] {
  return entries.flatMap((e, i): AuditEntry[] => {
    const base = {
      at: { utc: e.atUtc, zone },
      actor: { printedName: e.person, nativeName: null, username: '', role: roleLabel(e.role) },
      action: e.action,
      record: TABLE[e.table] ?? e.table,
      reason: e.reasonText ? `${e.reasonCode}: ${e.reasonText}` : e.reasonCode,
      afterFirstSave: e.afterFirstSave,
    };
    const changes = Object.entries(e.changes);
    if (changes.length === 0) return [{ ...base, id: `${i}`, field: null, oldValue: null, newValue: null }];
    return changes.map(([column, [from, to]]) => ({ ...base, id: `${i}:${column}`, field: column, oldValue: text(from), newValue: text(to) }));
  });
}

/** A record's Audit Trail, inline, read from the record.audit View (decision 23 rule 12). */
export function RecordAuditTrail({ recordId, zone, title }: { recordId: string; zone: string; title?: string }) {
  const trail = useView<{ entries: AuditEntryDto[] }>('record.audit', { recordId });
  if (trail.status === 'loading') return <p className="sub">Reading the Audit Trail.</p>;
  if (trail.status !== 'ok') return <p className="refusal">{trail.status === 'refused' ? trail.refusal.message : trail.message}</p>;
  return <AuditTrailPanel entries={auditRows(trail.data.entries, zone)} {...(title ? { title } : {})} />;
}
