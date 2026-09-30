import type { AuditEntryDto } from '@lims/contract';
import { useView } from '../api/hooks';
import { AuditTrailPanel } from '../components/AuditTrailPanel';
import type { AuditEntry } from '../model';
import { roleLabel } from '../session/store';

/**
 * One panel row per changed field; an entry that changed no field (an event) is one row of its
 * own. Each ledger numbers its own chain, so a row's key is its place in the answer, not its seq.
 */
export function auditRows(entries: readonly AuditEntryDto[], zone: string): AuditEntry[] {
  return entries.flatMap((e, i): AuditEntry[] => {
    const base = {
      at: { utc: e.atUtc, zone },
      actor: { printedName: e.person, nativeName: null, username: e.username, role: roleLabel(e.role) },
      action: e.action,
      record: e.record,
      reason: e.reason,
      afterFirstSave: e.afterFirstSave,
    };
    if (e.changes.length === 0) return [{ ...base, id: `${i}`, field: null, oldValue: null, newValue: null }];
    return e.changes.map((c, j) => ({ ...base, id: `${i}:${j}`, field: c.field, oldValue: c.from, newValue: c.to }));
  });
}

/** A record's Audit Trail, inline, read from the record.audit View (decision 23 rule 12). */
export function RecordAuditTrail({ recordId, zone, title }: { recordId: string; zone: string; title?: string }) {
  const trail = useView<{ entries: AuditEntryDto[] }>('record.audit', { recordId });
  if (trail.status === 'loading') return <p className="sub">Reading the Audit Trail.</p>;
  if (trail.status !== 'ok') return <p className="refusal">{trail.status === 'refused' ? trail.refusal.message : trail.message}</p>;
  return <AuditTrailPanel entries={auditRows(trail.data.entries, zone)} {...(title ? { title } : {})} />;
}
