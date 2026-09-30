// Recorded Values: the first save, a later change (a Critical Data Change proposal when the field
// is critical) and turning a proposal down. Each entry saves as it is made (decision 23 rule 23).

import { z } from 'zod';
import { written } from '@lims/domain/decimal';
import { RecordIdSchema, Sha256Schema, ValueRecordIdSchema, VersionRefSchema } from '../wire.ts';
import type { ReasonForChange } from '@lims/db';
import { receipt } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import type { TypedValue } from '../records/index.ts';

const DecimalText = z.string().regex(/^-?\d+(\.\d+)?$/);

export const TypedValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('decimal'), value: DecimalText, unit: z.string().min(1).max(16) }),
  z.object({ type: z.literal('text'), value: z.string().max(4000) }),
  z.object({ type: z.literal('ref'), value: z.string().min(1).max(200) }),
  z.object({ type: z.literal('blob'), sha256: Sha256Schema, mediaType: z.string().min(1).max(100) }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
]);

export const toTypedValue = (v: z.infer<typeof TypedValueSchema>): TypedValue =>
  v.type === 'decimal' ? { type: 'decimal', value: written(v.value), unit: v.unit } : v;

export const ReasonSchema = z.discriminatedUnion('code', [
  z.object({ code: z.enum(['transcription-error', 'wrong-unit', 'wrong-item-selected', 'instrument-reprint']) }),
  z.object({ code: z.literal('other'), text: z.string().min(1).max(500) }),
]);

export const toReason = (r: z.infer<typeof ReasonSchema>): ReasonForChange =>
  r.code === 'other' ? { kind: 'picklist', code: 'other', text: r.text } : { kind: 'picklist', code: r.code };

export const recordValue = defineCommand({
  name: 'value.record',
  input: z.object({ role: z.string().min(1), parent: RecordIdSchema, field: z.string().min(1).max(64), subject: z.string().max(64).default(''), value: TypedValueSchema }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const saved = await tx.records.record({ parent: input.parent, field: input.field, subject: input.subject, value: toTypedValue(input.value) });
    if ('kind' in saved) return saved;
    return receipt(`Recorded ${input.field}${input.subject ? ` (${input.subject})` : ''}.`, 'audited', saved);
  },
});

export const changeValue = defineCommand({
  name: 'value.change',
  input: z.object({ role: z.string().min(1), value: ValueRecordIdSchema, to: TypedValueSchema, reason: ReasonSchema }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: (i) => toReason(i.reason),
  ledgers: () => [],
  run: async (tx, input) => {
    const saved = await tx.records.change({ value: input.value, to: toTypedValue(input.to) });
    if ('kind' in saved) return saved;
    return receipt(saved.standing === 'pending' ? 'Proposed. The earlier value stays current until a second person approves the change.' : 'Changed.', 'audited', saved);
  },
});

export const rejectChange = defineCommand({
  name: 'value.reject',
  input: z.object({ role: z.string().min(1), version: VersionRefSchema, reason: ReasonSchema }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: (i) => toReason(i.reason),
  ledgers: () => [],
  run: async (tx, input) => {
    const r = await tx.records.reject(input.version);
    if (r) return r;
    return receipt('The proposed change was turned down; the earlier value stays current.');
  },
});

export const valueCommands = [recordValue, changeValue, rejectChange];
