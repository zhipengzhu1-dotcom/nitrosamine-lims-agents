// Records: the deep module. Six operations hide Record Versions, canonical bytes, Merkle cites,
// Recorded Values, Critical Data Change, separation of duties, release locks and "UNSIGNED,
// changed after signature". Every signable record kind uses these and nothing else.
//
//   record   first save of a typed value            -> effective at once, attributed, db-timed
//   change   any later value                         -> critical: pending until approved; else effective
//   reject   turn a pending change down              -> audited, unsigned
//   seal     the version to sign now                 -> a Record Version (idempotent by bytes)
//   sign     bind signatures to versions as shown    -> needs a ReauthenticatedSigner (type-enforced)
//   standing is a version still what was signed?     -> signed / changed-after-signature / unsigned

import { randomUUID } from 'node:crypto';
import { seal as sealDoor, sign as signDoor, standingFailures, versionStands, type AuditedTx } from '@lims/db';
import { canonicalBytes, type Canon } from '@lims/domain/canonical';
import { formatWritten, type Written } from '@lims/domain/decimal';
import { toRefusal } from '@lims/domain/gates';
import type { LabId, LedgerId, PersonId, RecordId, Sha256Hex, SignatureId, ValueRecordId, VersionId, VersionRef } from '@lims/domain/ids';
import { refuse, type Refusal } from '@lims/domain/refusal';
import { NEEDS_ATTESTATION, type Meaning } from '@lims/domain/signing';
import type { ReauthenticatedSigner } from '../identity/reauth.ts';
import type { KindDef, KindRegistry, RuleContext, Signer } from './kinds.ts';

export type TypedValue =
  | { readonly type: 'decimal'; readonly value: Written; readonly unit: string }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'ref'; readonly value: string }
  | { readonly type: 'blob'; readonly sha256: Sha256Hex; readonly mediaType: string }
  | { readonly type: 'boolean'; readonly value: boolean };

export type VersionNo = VersionRef & { readonly versionNo: number };

export type ValueSaved = {
  readonly value: ValueRecordId;
  readonly version: VersionNo;
  /** 'effective' for first saves and non-critical changes; 'pending' for a Critical Data Change. */
  readonly standing: 'effective' | 'pending';
};

export type PendingChange = {
  readonly value: ValueRecordId;
  readonly label: string;
  readonly from: VersionNo;
  readonly to: VersionNo;
  readonly fromBody: Canon;
  readonly toBody: Canon;
};

export type Sealed = {
  readonly record: RecordId;
  readonly kind: string;
  readonly label: string;
  readonly version: VersionNo;
  /** The body as stored, parsed back, for the prompt's "What you are signing". Display only. */
  readonly body: Canon;
  /** Pending Critical Data Changes this signing would approve: the record's own, or its children's. */
  readonly pendingChanges: readonly PendingChange[];
};

export type SignRequest = {
  readonly signer: ReauthenticatedSigner;
  readonly meaning: Meaning;
  /** Exactly what the prompt displayed. Refused if any is no longer the version to sign. */
  readonly targets: readonly VersionRef[];
  readonly attestation: VersionRef | null;
};

export type SignatureRow = {
  readonly id: SignatureId;
  readonly record: RecordId;
  readonly version: VersionNo;
  readonly meaning: Meaning;
  readonly signedAt: Date;
  readonly printedName: string;
  readonly username: string;
  readonly role: string;
};

export type Standing =
  | { readonly kind: 'unsigned' }
  | { readonly kind: 'signed'; readonly signatures: readonly SignatureRow[] }
  | { readonly kind: 'changed-after-signature'; readonly signed: readonly SignatureRow[]; readonly because: readonly string[] };

export interface Records {
  record(input: { readonly parent: RecordId; readonly field: string; readonly subject?: string; readonly value: TypedValue }): Promise<ValueSaved | Refusal>;
  change(input: { readonly value: ValueRecordId; readonly to: TypedValue }): Promise<ValueSaved | Refusal>;
  reject(pending: VersionRef): Promise<null | Refusal>;
  seal(record: RecordId): Promise<Sealed>;
  sign(req: SignRequest): Promise<readonly SignatureRow[] | Refusal>;
  standing(version: VersionId): Promise<Standing>;
  /** The kind, label and version to sign now, for a prompt. */
  describe(record: RecordId): Promise<{ readonly def: KindDef; readonly label: string }>;
}

const canonValue = (v: TypedValue): Canon => {
  switch (v.type) {
    case 'decimal': return { type: 'decimal', value: formatWritten(v.value), unit: v.unit };
    case 'text': return { type: 'text', value: v.value };
    case 'ref': return { type: 'ref', value: v.value };
    case 'blob': return { type: 'blob', sha256: v.sha256, mediaType: v.mediaType };
    case 'boolean': return { type: 'boolean', value: v.value };
  }
};

const valueText = (v: TypedValue): { text: string; decimals: number | null; blob: Buffer | null } => {
  switch (v.type) {
    case 'decimal': return { text: formatWritten(v.value), decimals: v.value.decimals, blob: null };
    case 'blob': return { text: v.sha256, decimals: null, blob: Buffer.from(v.sha256, 'hex') };
    case 'boolean': return { text: v.value ? 'true' : 'false', decimals: null, blob: null };
    default: return { text: v.value, decimals: null, blob: null };
  }
};

type Acted = { readonly person: PersonId; readonly role: string; readonly lab: LabId | null };

export function records(tx: AuditedTx, kinds: KindRegistry, acted: Acted): Records {
  const q = tx.db;
  const ruleContext: RuleContext = { q, dbNow: tx.dbNow, lab: acted.lab };

  const recordRow = async (id: RecordId) => {
    const r = await q.selectFrom('record').select(['id', 'ledger_id', 'kind', 'parent_id']).where('id', '=', id).executeTakeFirst();
    if (!r) throw new Error(`record ${id} does not exist`);
    return { id: r.id as RecordId, ledger: r.ledger_id as LedgerId, kind: r.kind, parent: r.parent_id as RecordId | null };
  };

  const versionRow = async (id: VersionId) => {
    const v = await q.selectFrom('record_version').select(['id', 'record_id', 'version_no', 'content', 'content_hash', 'created_by', 'requires_approval']).where('id', '=', id).executeTakeFirst();
    return v ? { ...v, ref: { versionId: v.id as VersionId, hash: v.content_hash.toString('hex') as Sha256Hex, versionNo: v.version_no } } : null;
  };

  const parseBody = (content: Buffer): Canon => JSON.parse(content.toString('utf8')) as Canon;

  const effective = (record: RecordId) =>
    q.selectFrom('effective_version').select(['id', 'version_no', 'content', 'content_hash', 'created_by']).where('record_id', '=', record).executeTakeFirst();
  const pending = (record: RecordId) =>
    q.selectFrom('pending_version').select(['id', 'version_no', 'content', 'content_hash', 'created_by']).where('record_id', '=', record).orderBy('version_no', 'desc').executeTakeFirst();

  const refOf = (v: { id: string | null; version_no: number | null; content_hash: Buffer | null }): VersionNo =>
    ({ versionId: v.id as VersionId, hash: (v.content_hash as Buffer).toString('hex') as Sha256Hex, versionNo: v.version_no as number });

  /** A value's label: its parent's label, the field, and the subject if any. */
  const valueLabel = async (value: RecordId): Promise<string> => {
    const rv = await q.selectFrom('recorded_value').select(['parent_id', 'field', 'subject']).where('record_id', '=', value).executeTakeFirstOrThrow();
    const parent = await recordRow(rv.parent_id as RecordId);
    const parentLabel = await kinds.get(parent.kind).label(q, parent.id);
    return `${parentLabel} ${rv.field}${rv.subject ? ` (${rv.subject})` : ''}`;
  };

  /** The pending change on one value, if any. */
  const pendingChangeOf = async (value: RecordId): Promise<PendingChange | null> => {
    const p = await pending(value);
    if (!p) return null;
    const e = await effective(value);
    if (!e) return null;
    return { value: value as ValueRecordId, label: await valueLabel(value), from: refOf(e), to: refOf(p), fromBody: parseBody(e.content as Buffer), toBody: parseBody(p.content as Buffer) };
  };

  const pendingUnder = async (parent: RecordId): Promise<PendingChange[]> => {
    const children = await q.selectFrom('pending_version').innerJoin('record', 'record.id', 'pending_version.record_id')
      .select('record.id').where('record.parent_id', '=', parent).execute();
    const out: PendingChange[] = [];
    for (const c of children) {
      const p = await pendingChangeOf(c.id as RecordId);
      if (p) out.push(p);
    }
    return out;
  };

  const saveValueVersion = async (record: RecordId, ledger: LedgerId, body: Canon, value: TypedValue): Promise<ValueSaved> => {
    const v = await sealDoor(tx, record, canonicalBytes(body), 'value@1');
    if (!v.reused) {
      const t = valueText(value);
      await q.insertInto('recorded_value_version').values({ ledger_id: ledger, version_id: v.versionId, value_text: t.text, decimals: t.decimals, blob_hash: t.blob }).execute();
    }
    const row = await q.selectFrom('record_version').select('requires_approval').where('id', '=', v.versionId).executeTakeFirstOrThrow();
    return { value: record as ValueRecordId, version: { versionId: v.versionId, hash: v.hash, versionNo: v.versionNo }, standing: row.requires_approval ? 'pending' : 'effective' };
  };

  /** The version a signing binds to now: the pending one if a change awaits approval, else the effective one, else a fresh seal. */
  const versionToSign = async (record: RecordId, def: KindDef): Promise<VersionNo> => {
    if (def.content === null) {
      const p = (await pending(record)) ?? (await effective(record));
      if (!p) throw new Error(`record ${record} has no version`);
      return refOf(p);
    }
    const built = await def.content(q, record, tx.dbNow);
    const v = await sealDoor(tx, record, canonicalBytes(built.body), built.body.schema, built.cites);
    return { versionId: v.versionId, hash: v.hash, versionNo: v.versionNo };
  };

  const sealed = async (record: RecordId): Promise<Sealed> => {
    const r = await recordRow(record);
    const def = kinds.get(r.kind);
    const version = await versionToSign(record, def);
    const row = await versionRow(version.versionId);
    if (!row) throw new Error(`version ${version.versionId} vanished`);
    const label = r.kind === 'value' ? await valueLabel(record) : await def.label(q, record);
    const own = r.kind === 'value' ? await pendingChangeOf(record) : null;
    const pendingChanges = own ? [own] : await pendingUnder(record);
    return { record, kind: r.kind, label, version, body: parseBody(row.content), pendingChanges };
  };

  const signatureRows = async (version: VersionId): Promise<SignatureRow[]> => {
    const rows = await q.selectFrom('signature').innerJoin('record_version', 'record_version.id', 'signature.record_version_id')
      .select(['signature.id', 'signature.meaning', 'signature.signed_at', 'signature.printed_name', 'signature.username', 'signature.role',
        'record_version.record_id', 'record_version.version_no', 'signature.content_hash'])
      .where('signature.record_version_id', '=', version).orderBy('signature.signed_at').execute();
    return rows.map((s) => ({
      id: s.id as SignatureId, record: s.record_id as RecordId, meaning: s.meaning as Meaning, signedAt: s.signed_at,
      printedName: s.printed_name, username: s.username, role: s.role,
      version: { versionId: version, hash: s.content_hash.toString('hex') as Sha256Hex, versionNo: s.version_no },
    }));
  };

  return {
    async describe(record) {
      const r = await recordRow(record);
      const def = kinds.get(r.kind);
      return { def, label: r.kind === 'value' ? await valueLabel(record) : await def.label(q, record) };
    },

    async record({ parent, field, subject = '', value }) {
      const p = await recordRow(parent);
      const spec = kinds.get(p.kind).fields[field];
      if (!spec) throw new Error(`${p.kind} has no field ${field}`);
      if (spec.type !== value.type) throw new Error(`${field} takes a ${spec.type}, not a ${value.type}`);
      const taken = await q.selectFrom('recorded_value').select('record_id').where('parent_id', '=', parent).where('field', '=', field).where('subject', '=', subject).executeTakeFirst();
      if (taken) return { kind: 'transition', message: `${field}${subject ? ` (${subject})` : ''} already has a value. Change it instead.` };
      const id = randomUUID() as RecordId;
      await q.insertInto('record').values({ ledger_id: p.ledger, id, kind: 'value', parent_id: parent }).execute();
      await q.insertInto('recorded_value').values({
        ledger_id: p.ledger, record_id: id, parent_id: parent, field, subject, critical: spec.critical, value_type: spec.type, unit: value.type === 'decimal' ? value.unit : null,
      }).execute();
      return saveValueVersion(id, p.ledger, { schema: 'value@1', parent, field, subject, value: canonValue(value) }, value);
    },

    async change({ value, to }) {
      if (tx.ctx.reason.kind !== 'picklist') throw new Error('a change after first save needs a picklist Reason for Change; the command must demand one');
      const rv = await q.selectFrom('recorded_value').select(['ledger_id', 'parent_id', 'field', 'subject', 'value_type']).where('record_id', '=', value).executeTakeFirst();
      if (!rv) throw new Error(`Recorded Value ${value} does not exist`);
      if (rv.value_type !== to.type) throw new Error(`${rv.field} takes a ${rv.value_type}, not a ${to.type}`);
      return saveValueVersion(value, rv.ledger_id as LedgerId, { schema: 'value@1', parent: rv.parent_id, field: rv.field, subject: rv.subject, value: canonValue(to) }, to);
    },

    async reject(target) {
      if (tx.ctx.reason.kind !== 'picklist') throw new Error('turning a change down needs a picklist Reason for Change; the command must demand one');
      const v = await versionRow(target.versionId);
      if (!v) return refuse.staleVersion('The proposed value', target.versionId, null);
      const p = await pending(v.record_id as RecordId);
      if (!p || p.id !== v.id || v.ref.hash !== target.hash) return refuse.staleVersion(await valueLabel(v.record_id as RecordId), target.versionId, (p?.id as VersionId | null) ?? null);
      const r = await recordRow(v.record_id as RecordId);
      await q.insertInto('version_rejection').values({ ledger_id: r.ledger, version_id: v.id, rejected_by: acted.person, reason_code: tx.ctx.reason.code, reason_text: tx.ctx.reason.code === 'other' ? tx.ctx.reason.text : null }).execute();
      return null;
    },

    seal: sealed,

    async sign(req) {
      if (NEEDS_ATTESTATION.has(req.meaning) && !req.attestation) {
        return { kind: 'not-permitted', message: `${req.meaning} needs its Review Checklist as attestation.` };
      }
      const items: Sealed[] = [];
      for (const target of req.targets) {
        const v = await versionRow(target.versionId);
        if (!v) return refuse.staleVersion('The record', target.versionId, null);
        const current = await sealed(v.record_id as RecordId);
        if (current.version.versionId !== target.versionId || current.version.hash !== target.hash) {
          return refuse.staleVersion(current.label, target.versionId, current.version.versionId);
        }
        items.push(current);
      }
      const kindsInGroup = new Set(items.map((i) => i.kind));
      if (kindsInGroup.size !== 1) return { kind: 'not-permitted', message: 'One signing covers records of one kind.' };
      const def = kinds.get(items[0]!.kind);
      const rule = def.signing[req.meaning];
      if (!rule) return { kind: 'not-permitted', message: `${items[0]!.label} does not carry the meaning ${req.meaning}.` };
      const signer: Signer = { person: req.signer.person, role: req.signer.role };
      const gate = await rule.check(ruleContext, signer, items);
      if ('kind' in gate) return gate;
      if (!gate.go) return toRefusal(gate);

      const group = randomUUID();
      const rows: SignatureRow[] = [];
      for (const item of items) {
        const s = await signDoor(tx, { signer: req.signer.person, target: item.version, meaning: req.meaning, authenticator: req.signer.authenticator, group, attestation: req.attestation });
        const row: SignatureRow = {
          id: s.signatureId, record: item.record, version: item.version, meaning: req.meaning, signedAt: s.signedAt,
          printedName: req.signer.printedName, username: req.signer.username, role: req.signer.role,
        };
        rows.push(row);
      }
      for (const [i, item] of items.entries()) await rule.after?.(tx as never, item, rows[i]!);
      // The signature binds to what was shown; if the meaning's own effects moved it, that is a bug, not a record.
      for (const item of items) {
        if (!(await versionStands(q, item.version.versionId))) throw new Error(`${item.label} no longer stands after its ${req.meaning} effects`);
      }
      return rows;
    },

    async standing(version) {
      const signatures = await signatureRows(version);
      if (signatures.length === 0) return { kind: 'unsigned' };
      if (await versionStands(q, version)) return { kind: 'signed', signatures };
      const failures = await standingFailures(q, version);
      return { kind: 'changed-after-signature', signed: signatures, because: failures.map((f) => `${f.reason} (${f.versionId})`) };
    },
  };
}
