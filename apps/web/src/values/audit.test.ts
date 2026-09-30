import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '@lims/contract';
import { auditRows } from './RecordAuditTrail';

const entry = (over: Partial<AuditEntryDto>): AuditEntryDto => ({
  seq: 7, atUtc: '2026-09-30T14:40:00.000Z', person: 'Ann Analyst', username: 'ann', role: 'Analyst', action: 'value.change', reason: 'Balance printout misread',
  record: 'P1 weight on Test RD-S-2026-000001/T1', changes: [], afterFirstSave: true, ...over,
});

describe('auditRows', () => {
  it('prints one row per changed field with who, username, role, old and new, the reason and the Lab zone', () => {
    const rows = auditRows([entry({ changes: [{ field: 'P1 weight', from: '100.12 mg', to: '100.21 mg' }, { field: 'Record Version', from: null, to: 'Version 2' }] })], 'America/New_York');
    expect(rows).toEqual([
      expect.objectContaining({
        id: '0:0', field: 'P1 weight', oldValue: '100.12 mg', newValue: '100.21 mg', record: 'P1 weight on Test RD-S-2026-000001/T1', reason: 'Balance printout misread', afterFirstSave: true,
        at: { utc: '2026-09-30T14:40:00.000Z', zone: 'America/New_York' }, actor: expect.objectContaining({ printedName: 'Ann Analyst', username: 'ann', role: 'Analyst' }),
      }),
      expect.objectContaining({ id: '0:1', field: 'Record Version', oldValue: null, newValue: 'Version 2' }),
    ]);
  });

  it('keeps an entry that changed no field as one row', () => {
    expect(auditRows([entry({ record: 'Test RD-S-2026-000001/T1', action: 'test.start', changes: [] })], 'UTC')).toEqual([expect.objectContaining({ id: '0', field: null, action: 'test.start', record: 'Test RD-S-2026-000001/T1' })]);
  });
});
