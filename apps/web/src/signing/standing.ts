import type { SignatureDto, StandingDto } from '@lims/contract';
import { STATEMENT } from '@lims/contract/session';
import { sha256Hex, type Signature, type SignatureMeaning } from '../model';
import { roleLabel } from '../session/store';

/**
 * The SignatureLines for a version, from the signing.standing View. A version that changed after
 * it was signed shows each signature as "UNSIGNED — changed after signature" (rule 11).
 */
export function signaturesOf(standing: StandingDto, record: string, lab: string, zone: string): Signature[] {
  const line = (s: SignatureDto, state: Signature['standing']): Signature => ({
    meaning: s.meaning as SignatureMeaning,
    statement: STATEMENT[s.meaning as SignatureMeaning] ?? '',
    signer: { printedName: s.printedName, nativeName: null, username: s.username, role: roleLabel(s.role) },
    lab,
    workstation: null,
    signedAt: { utc: s.signedAtUtc, zone },
    version: { record, versionNo: s.version.versionNo, versionId: s.version.versionId, hash: sha256Hex(s.version.hash) },
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
