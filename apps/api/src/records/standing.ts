// "Is this signature still good?" for any read handle: lims.version_stands plus the signatures
// on the version, rendered the way the SignatureLine prints them.

import { standingFailures, versionStands, type DB, type ReadDb } from '@lims/db';
import type { StandingDto, SignatureDto } from '@lims/contract';
import type { VersionId } from '@lims/domain/ids';

export async function signaturesOn(q: ReadDb<DB>, version: VersionId): Promise<SignatureDto[]> {
  const rows = await q.selectFrom('signature').innerJoin('record_version', 'record_version.id', 'signature.record_version_id')
    .select(['signature.id', 'signature.meaning', 'signature.signed_at', 'signature.printed_name', 'signature.username', 'signature.role',
      'record_version.version_no', 'signature.content_hash'])
    .where('signature.record_version_id', '=', version).orderBy('signature.signed_at').execute();
  return rows.map((s) => ({
    id: s.id, meaning: s.meaning, printedName: s.printed_name, username: s.username, role: s.role, signedAtUtc: s.signed_at.toISOString(),
    version: { versionId: version, versionNo: s.version_no, hash: s.content_hash.toString('hex') },
  }));
}

export async function readStanding(q: ReadDb<DB>, version: VersionId): Promise<StandingDto> {
  const signatures = await signaturesOn(q, version);
  if (signatures.length === 0) return { kind: 'unsigned' };
  if (await versionStands(q, version)) return { kind: 'signed', signatures };
  const failures = await standingFailures(q, version);
  return { kind: 'changed-after-signature', signed: signatures, because: failures.map((f) => `${f.reason} (${f.versionId})`) };
}
