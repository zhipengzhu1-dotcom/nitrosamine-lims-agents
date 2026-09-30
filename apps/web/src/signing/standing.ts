import type { SignatureDto, StandingDto } from '@lims/contract';
import { sha256Hex, type Signature, type SignatureMeaning } from '../model';
import { roleLabel } from '../session/store';

/**
 * The SignatureLines for a version, from the signing.standing View: the record's label, its Lab
 * and each statement are the server's. A version that changed after it was signed shows each
 * signature as "UNSIGNED — changed after signature" (rule 11).
 */
export function signaturesOf(standing: StandingDto, zone: string): Signature[] {
  const line = (s: SignatureDto, state: Signature['standing']): Signature => ({
    meaning: s.meaning as SignatureMeaning,
    statement: s.statement,
    signer: { printedName: s.printedName, nativeName: null, username: s.username, role: roleLabel(s.role) },
    lab: standing.lab,
    workstation: null,
    signedAt: { utc: s.signedAtUtc, zone },
    version: { record: standing.record, versionNo: s.version.versionNo, versionId: s.version.versionId, hash: sha256Hex(s.version.hash) },
    standing: state,
  });
  switch (standing.kind) {
    case 'unsigned':
      return [];
    case 'signed':
      return standing.signatures.map((s) => line(s, 'stands'));
    case 'changed-after-signature':
      return standing.signed.map((s) => line(s, 'changed-after-signature'));
  }
}
