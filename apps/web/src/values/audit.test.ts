import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '@lims/contract';
import { auditRows } from './RecordAuditTrail';

const entry = (over: Partial<AuditEntryDto>): AuditEntryDto => ({
  seq: 7, atUtc: '2026-09-30T14:40:00.000Z', person: 'Ann Analyst', role: 'Analyst', action: 'value.change', reasonCode: 'other',
  reasonText: 'Balance printout misread', table: 'recorded_value_version', op: 'insert', changes: {}, afterFirstSave: true, ...over,
});

describe('auditRows', () => {
  it('prints one row per changed column with who, role, old and new, reason and the Lab zone', () => {
    const rows = auditRows([entry({ changes: { value_text: [null, '100.21'], decimals: [null, 2] } })], 'America/New_York');
    expect(rows).toEqual([
      expect.objectContaining({ id: '0:value_text', field: 'value_text', oldValue: null, newValue: '100.21', record: 'Recorded Value version', reason: 'other: Balance printout misread', afterFirstSave: true, at: { utc: '2026-09-30T14:40:00.000Z', zone: 'America/New_York' }, actor: expect.objectContaining({ printedName: 'Ann Analyst', role: 'Analyst' }) }),
      expect.objectContaining({ id: '0:decimals', field: 'decimals', oldValue: null, newValue: '2' }),
    ]);
  });

  it('keeps an entry that changed no column as one row', () => {
    expect(auditRows([entry({ table: 'record', action: 'session.lock', changes: {} })], 'UTC')).toEqual([expect.objectContaining({ id: '0', field: null, action: 'session.lock', record: 'Record' })]);
  });
});
