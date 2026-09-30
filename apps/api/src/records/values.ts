// The Recorded Values under a record, as facts: each value's effective version, whether a Verified
// or Approved signature stands on it, any pending change, and everyone who wrote it. Gates, content
// builders and views all read values through here.

import type { DB, ReadDb } from '@lims/db';
import type { ShownValueDto, ValueDto } from '@lims/contract';
import type { PersonId, RecordId, Sha256Hex, ValueRecordId, VersionId, VersionRef } from '@lims/domain/ids';
import { fieldLabel, type KindDef, type KindRegistry } from './kinds.ts';

type Q = ReadDb<DB>;

const hex = (b: Buffer | null | undefined): Sha256Hex => (b as Buffer).toString('hex') as Sha256Hex;

export type ValueVersionFact = { readonly versionId: VersionId; readonly versionNo: number; readonly hash: Sha256Hex; readonly text: string; readonly decimals: number | null; readonly createdBy: PersonId };

export type ValueFact = {
  readonly id: ValueRecordId;
  readonly field: string;
  readonly subject: string;
  readonly critical: boolean;
  readonly valueType: string;
  readonly unit: string | null;
  readonly effective: ValueVersionFact;
  /** A Verified or Approved signature stands on the effective version. */
  readonly verified: boolean;
  readonly pending: ValueVersionFact | null;
  /** Everyone who wrote any version, the first save's author first. */
  readonly authors: readonly PersonId[];
};

export async function valuesUnder(q: Q, parent: RecordId): Promise<ValueFact[]> {
  const rows = await q.selectFrom('recorded_value as rv')
    .innerJoin('effective_version as ev', 'ev.record_id', 'rv.record_id')
    .innerJoin('recorded_value_version as vv', 'vv.version_id', 'ev.id')
    .select(['rv.record_id', 'rv.field', 'rv.subject', 'rv.critical', 'rv.value_type', 'rv.unit',
      'ev.id as version_id', 'ev.version_no', 'ev.content_hash', 'ev.created_by', 'vv.value_text', 'vv.decimals'])
    .where('rv.parent_id', '=', parent).orderBy('rv.field').orderBy('rv.subject').execute();
  const out: ValueFact[] = [];
  for (const r of rows) {
    const versions = await q.selectFrom('record_version').select(['id', 'version_no', 'content_hash', 'created_by']).where('record_id', '=', r.record_id).orderBy('version_no').execute();
    const pendingRow = await q.selectFrom('pending_version as pv').innerJoin('recorded_value_version as vv', 'vv.version_id', 'pv.id')
      .select(['pv.id', 'pv.version_no', 'pv.content_hash', 'pv.created_by', 'vv.value_text', 'vv.decimals'])
      .where('pv.record_id', '=', r.record_id).orderBy('pv.version_no', 'desc').executeTakeFirst();
    const verified = await q.selectFrom('signature').select('id').where('record_version_id', '=', r.version_id as string)
      .where('meaning', 'in', ['Verified', 'Approved']).executeTakeFirst();
    out.push({
      id: r.record_id as ValueRecordId, field: r.field, subject: r.subject, critical: r.critical, valueType: r.value_type, unit: r.unit,
      effective: { versionId: r.version_id as VersionId, versionNo: r.version_no as number, hash: hex(r.content_hash), text: r.value_text, decimals: r.decimals, createdBy: r.created_by as PersonId },
      verified: verified !== undefined,
      pending: pendingRow ? { versionId: pendingRow.id as VersionId, versionNo: pendingRow.version_no as number, hash: hex(pendingRow.content_hash), text: pendingRow.value_text, decimals: pendingRow.decimals, createdBy: pendingRow.created_by as PersonId } : null,
      authors: [...new Set(versions.map((v) => v.created_by as PersonId))],
    });
  }
  return out;
}

export const valueRef = (v: ValueFact): VersionRef => ({ versionId: v.effective.versionId, hash: v.effective.hash });

export const find = (values: readonly ValueFact[], field: string, subject = ''): ValueFact | null =>
  values.find((v) => v.field === field && v.subject === subject) ?? null;

/** The field as the parent kind's register names it: "P1 weight". */
export const labelOf = (fields: KindDef['fields'], v: Pick<ValueFact, 'field' | 'subject'>): string => {
  const spec = fields[v.field];
  return spec ? fieldLabel(spec, v.subject) : `${v.field}${v.subject ? ` (${v.subject})` : ''}`;
};

export const valueDto = (fields: KindDef['fields'], v: ValueFact): ValueDto => ({
  valueId: v.id, field: v.field, subject: v.subject, label: labelOf(fields, v), critical: v.critical, type: v.valueType, unit: v.unit, text: v.effective.text,
  version: { versionId: v.effective.versionId, versionNo: v.effective.versionNo, hash: v.effective.hash }, verified: v.verified,
  pending: v.pending ? { text: v.pending.text, version: { versionId: v.pending.versionId, versionNo: v.pending.versionNo, hash: v.pending.hash } } : null,
});

const shownText = (v: ValueFact): string => (v.valueType === 'boolean' ? (v.effective.text === 'true' ? 'Yes' : 'No') : v.effective.text);

/**
 * The values a signing prompt lists for a record: label, effective value and unit, and who
 * recorded that version when. A ref value names Equipment, the only thing a ref field names, so
 * the prompt prints its code rather than its id.
 */
export async function shownValues(q: Q, kinds: KindRegistry, record: RecordId): Promise<ShownValueDto[]> {
  const r = await q.selectFrom('record').select('kind').where('id', '=', record).executeTakeFirstOrThrow();
  const fields = kinds.get(r.kind).fields;
  const out: ShownValueDto[] = [];
  for (const v of await valuesUnder(q, record)) {
    const who = await q.selectFrom('record_version as rv').innerJoin('person as p', 'p.id', 'rv.created_by').leftJoin('account as a', 'a.person_id', 'p.id')
      .select(['p.printed_name', 'a.username', 'rv.created_at']).where('rv.id', '=', v.effective.versionId).executeTakeFirstOrThrow();
    const equipment = v.valueType === 'ref' ? await q.selectFrom('equipment').select('code').where('id', '=', v.effective.text).executeTakeFirst() : undefined;
    out.push({
      label: labelOf(fields, v), text: equipment?.code ?? shownText(v), unit: v.unit,
      by: who.username ? `${who.printed_name} (${who.username})` : who.printed_name, at: who.created_at.toISOString(),
    });
  }
  return out;
}
