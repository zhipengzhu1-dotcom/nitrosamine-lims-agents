// What a signer needs before the first business signature: Training Records they acknowledge
// themselves, and Authorisations QA grants and signs Approved.

import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { COMPANY_LEDGER, ledgerOf } from '@lims/db';
import { MeaningSchema } from '@lims/contract';
import { PersonIdSchema } from '../wire.ts';
import type { RecordId } from '@lims/domain/ids';
import { receipt } from '../commit.ts';
import { defineCommand } from '../doors.ts';

export const openTrainingRecord = defineCommand({
  name: 'training.open',
  input: z.object({ documentVersion: z.string().min(1).max(100), level: z.enum(['read-and-understood', 'demonstrated']) }),
  acting: { as: 'session' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const a = tx.actor;
    if (a.kind === 'nobody' || a.kind === 'locked') throw new Error('training.open acts in a live session');
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id, kind: 'training_record' }).execute();
    await tx.db.insertInto('training_record').values({ id, person_id: a.person, document_version: input.documentVersion, level: input.level }).execute();
    const sealed = await tx.records.seal(id);
    return receipt(`Opened your Training Record on ${input.documentVersion}. Sign it Acknowledged.`, 'audited', { recordId: id, version: sealed.version });
  },
});

export const grantAuthorisation = defineCommand({
  name: 'authorisation.grant',
  input: z.object({
    personId: PersonIdSchema,
    meaning: MeaningSchema,
    scope: z.string().min(1).max(200),
    validFrom: z.iso.date(),
    validUntil: z.iso.date(),
  }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const a = tx.actor;
    const lab = a.kind === 'staff' ? a.lab : a.kind === 'service' ? a.lab : null;
    if (!lab) return { kind: 'not-permitted', message: 'An Authorisation is granted in a Lab.' };
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab), id, kind: 'authorisation' }).execute();
    await tx.db.insertInto('authorisation').values({
      lab_id: lab, id, person_id: input.personId, meaning: input.meaning, scope: input.scope,
      valid_from: sql`${input.validFrom}::date`, valid_until: sql`${input.validUntil}::date`,
    }).execute();
    const sealed = await tx.records.seal(id);
    return receipt(`Drafted the ${input.meaning} Authorisation for ${input.scope}. It takes effect when QA signs it Approved.`, 'audited', { recordId: id, version: sealed.version });
  },
});

export const enablementCommands = [openTrainingRecord, grantAuthorisation];
