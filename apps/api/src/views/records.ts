// Views the record screens share: a record's inline Audit Trail, and a version's standing for
// the SignatureLine. Both run in READ ONLY transactions through the door.

import { z } from 'zod';
import type { AuditEntryDto, StandingDto } from '@lims/contract';
import { RecordIdSchema, VersionIdSchema } from '../wire.ts';
import { defineView } from '../doors.ts';
import { readStanding } from '../records/standing.ts';

export const recordAudit = defineView({
  name: 'record.audit',
  input: z.object({ recordId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { recordId }): Promise<{ entries: AuditEntryDto[] }> => {
    const rows = await q.selectFrom('audit_entry').innerJoin('person', 'person.id', 'audit_entry.person_id')
      .select(['audit_entry.seq', 'audit_entry.at', 'audit_entry.role', 'audit_entry.action', 'audit_entry.reason_code', 'audit_entry.reason_text',
        'audit_entry.table_name', 'audit_entry.op', 'audit_entry.changes', 'person.printed_name'])
      .where('audit_entry.record_id', '=', recordId).orderBy('audit_entry.seq').execute();
    return {
      entries: rows.map((r) => ({
        seq: Number(r.seq), atUtc: r.at.toISOString(), person: r.printed_name, role: r.role, action: r.action,
        reasonCode: r.reason_code, reasonText: r.reason_text, table: r.table_name, op: r.op as 'insert' | 'update',
        changes: r.changes as unknown as AuditEntryDto['changes'], // the capture trigger writes {column: [old, new]}
        afterFirstSave: r.op === 'update' || (r.reason_code !== 'first_save' && r.reason_code !== 'action'),
      })),
    };
  },
});

export const signingStanding = defineView({
  name: 'signing.standing',
  input: z.object({ versionId: VersionIdSchema }),
  scope: 'lab',
  read: async (q, { versionId }): Promise<StandingDto> => readStanding(q, versionId),
});

export const recordViews = [recordAudit, signingStanding];
