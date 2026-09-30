// Views the record screens share: a record's inline Audit Trail, and a version's standing for
// the SignatureLine. Both run in READ ONLY transactions through the door.

import { z } from 'zod';
import type { AuditEntryDto, LabDto, StandingDto, ValueDto } from '@lims/contract';
import { RecordIdSchema, VersionIdSchema } from '../wire.ts';
import { defineView } from '../doors.ts';
import { readStanding } from '../records/standing.ts';
import { readTrail } from '../records/trail.ts';
import { valueDto, valuesUnder } from '../records/values.ts';

/** The record's Audit Trail and every record's under it, readable (decision 23 rule 12). */
export const recordAudit = defineView({
  name: 'record.audit',
  input: z.object({ recordId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { recordId }, _actor, kinds): Promise<{ entries: AuditEntryDto[] }> => ({ entries: await readTrail(q, kinds, recordId) }),
});

/** A record's Recorded Values with its kind's field register: label, unit, critical, Verified, pending. */
export const recordValues = defineView({
  name: 'record.values',
  input: z.object({ parent: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { parent }, _actor, kinds): Promise<{ values: ValueDto[] }> => {
    const r = await q.selectFrom('record').select('kind').where('id', '=', parent).executeTakeFirst();
    if (!r) return { values: [] };
    const fields = kinds.get(r.kind).fields;
    return { values: (await valuesUnder(q, parent)).map((v) => valueDto(fields, v)) };
  },
});

export const signingStanding = defineView({
  name: 'signing.standing',
  input: z.object({ versionId: VersionIdSchema }),
  scope: 'lab',
  read: async (q, { versionId }, _actor, kinds): Promise<StandingDto> => readStanding(q, versionId, kinds),
});

/** The company's Labs, for the Admin granting roles in one (decision 13 §3). */
export const adminLabs = defineView({
  name: 'admin.labs',
  input: z.object({}),
  scope: 'company',
  read: async (q): Promise<{ labs: LabDto[] }> => {
    const labs = await q.selectFrom('lab').select(['id', 'code', 'iana_zone']).orderBy('code').execute();
    return { labs: labs.map((l) => ({ id: l.id, code: l.code, zone: l.iana_zone })) };
  },
});

export const recordViews = [recordAudit, recordValues, signingStanding, adminLabs];
