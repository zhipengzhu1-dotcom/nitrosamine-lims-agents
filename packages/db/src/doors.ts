// The SECURITY DEFINER functions lims_app may call, as typed calls. lims_app has no INSERT on
// record_version, record_version_cite, signature or record_lock, so a version, a cite, a signature
// or a lock exists only because one of these ran inside an audited transaction.

import { sql, type Kysely } from 'kysely';
import { unscoped, type AuditedTx } from './audited.ts';
import type { DB } from './generated.ts';
import type { LabId, PersonId, RecordId, Sha256Hex, SignatureId, VersionId, VersionRef } from './ids.ts';

export type Meaning = 'Performed' | 'Verified' | 'Reviewed' | 'Approved' | 'Released' | 'Authored' | 'Acknowledged';

export type Sealed = VersionRef & { readonly versionNo: number; readonly reused: boolean };

/**
 * Seals canonical bytes as the record's next version, or returns the latest version when the
 * bytes are identical. Each cite must match the cited version's stored hash and appear in the
 * content (LV002, LV003).
 */
export async function seal(tx: AuditedTx, record: RecordId, content: Uint8Array, schema: string, cites: readonly VersionRef[] = []): Promise<Sealed> {
  const citeRows = cites.map((c) => ({ version_id: c.versionId, hash: c.hash }));
  const { rows } = await sql<{ version_id: VersionId; version_no: number; content_hash: Buffer; reused: boolean }>`
    select * from lims.seal(${record}, ${Buffer.from(content)}, ${schema}, ${JSON.stringify(citeRows)}::jsonb)`.execute(unscoped(tx));
  const r = rows[0]!;
  return { versionId: r.version_id, versionNo: r.version_no, hash: r.content_hash.toString('hex') as Sha256Hex, reused: r.reused };
}

export type SignRequest = {
  readonly signer: PersonId;
  readonly target: VersionRef;
  readonly meaning: Meaning;
  readonly authenticator: 'totp' | 'passkey';
  readonly group: string;
  readonly attestation?: VersionRef | null;
};

/** Binds one signature to the version and hash the prompt showed. */
export async function sign(tx: AuditedTx, req: SignRequest): Promise<{ readonly signatureId: SignatureId; readonly signedAt: Date }> {
  const att = req.attestation ?? null;
  const { rows } = await sql<{ signature_id: SignatureId; signed_at: Date }>`
    select * from lims.sign(${req.signer}, ${req.target.versionId}, decode(${req.target.hash}, 'hex'), ${req.meaning},
                            ${req.authenticator}, ${req.group},
                            ${att?.versionId ?? null}, ${att ? sql`decode(${att.hash}, 'hex')` : null})`.execute(unscoped(tx));
  const r = rows[0]!;
  return { signatureId: r.signature_id, signedAt: r.signed_at };
}

/** Locks every record in the cite closure of a Released signature's version. Returns the rows added. */
export async function lockReleased(tx: AuditedTx, signature: SignatureId): Promise<number> {
  const { rows } = await sql<{ n: number }>`select lims.lock_released(${signature}) as n`.execute(unscoped(tx));
  return rows[0]!.n;
}

export async function createLab(tx: AuditedTx, lab: { readonly id: LabId; readonly code: string; readonly ianaZone: string }): Promise<void> {
  await sql`select lims.create_lab(${lab.id}, ${lab.code}, ${lab.ianaZone})`.execute(unscoped(tx));
}

type ReadHandle = Pick<Kysely<DB>, 'selectNoFrom'>;

/** Whether a signed version is still what was signed. Runs on any handle. */
export async function versionStands(db: ReadHandle, version: VersionId): Promise<boolean> {
  const r = await db.selectNoFrom(sql<boolean>`lims.version_stands(${version})`.as('stands')).executeTakeFirstOrThrow();
  return r.stands;
}

/** Why a version no longer stands: empty when it does. */
export async function standingFailures(db: ReadHandle, version: VersionId): Promise<readonly { versionId: VersionId; reason: string }[]> {
  const r = await db
    .selectNoFrom(sql<{ version_id: VersionId; reason: string }[]>`
      coalesce((select json_agg(f) from lims.version_standing_failures(${version}) f), '[]'::json)`.as('failures'))
    .executeTakeFirstOrThrow();
  return r.failures.map((f) => ({ versionId: f.version_id, reason: f.reason }));
}

export type ChainVerdict = { readonly intactThrough: number; readonly firstBreak: number | null; readonly headMatches: boolean };

export async function verifyChain(db: ReadHandle, ledger: string): Promise<ChainVerdict> {
  const r = await db
    .selectNoFrom(sql<{ intact_through: string; first_break: string | null; head_matches: boolean }>`
      (select row_to_json(v) from lims.verify_chain(${ledger}) v)`.as('v'))
    .executeTakeFirstOrThrow();
  return {
    intactThrough: Number(r.v.intact_through),
    firstBreak: r.v.first_break === null ? null : Number(r.v.first_break),
    headMatches: r.v.head_matches,
  };
}
