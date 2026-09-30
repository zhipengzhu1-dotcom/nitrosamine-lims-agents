// The seven Signature Meanings and their fixed statements (decision 13). One list: the prompt, the
// SignatureLine, the PDF and the database CHECK all use it.

import type { Role } from './machines.ts';

export const MEANINGS = ['Performed', 'Verified', 'Reviewed', 'Approved', 'Released', 'Authored', 'Acknowledged'] as const;
export type Meaning = (typeof MEANINGS)[number];

/** The words the signer reads beside the meaning, from the chosen UI direction (#23). */
export const STATEMENT: { readonly [M in Meaning]: string } = {
  Performed: 'I performed this work and recorded it completely and accurately.',
  Verified: 'I checked this entry against its source and it is correct.',
  Reviewed: 'I reviewed these records, including their audit trail, and they are complete and correct.',
  Approved: 'I approve this record for use.',
  Released: 'I release this Test Report to the Customer.',
  Authored: 'I wrote this draft and submit it for review.',
  Acknowledged: 'I have read and understood this.',
};

/** Meanings whose signature must cite an attestation: a Review record's version. */
export const NEEDS_ATTESTATION: ReadonlySet<Meaning> = new Set(['Reviewed', 'Released']);

/** Meanings that make a pending Critical Data Change effective when someone else signs it (ADR 0001). */
export const APPROVES_CHANGE: ReadonlySet<Meaning> = new Set(['Verified', 'Approved']);

/**
 * The roles a signing may act under. The signature row and the audit entry both take the role from
 * the command's context, so there is no "self" role.
 */
export const SIGNS_AS: { readonly [M in Meaning]: readonly Role[] } = {
  Performed: ['Analyst'],
  Verified: ['Analyst', 'Reviewer'], // a Performed or Reviewed Authorisation on the Method (decision 19)
  Reviewed: ['Reviewer'],
  Approved: ['QA', 'Reviewer', 'LabManager'], // Reviewer: result corrections after Performed; Lab Manager: non-GMP marking
  Released: ['QA'],
  Authored: ['LabManager', 'Reviewer'],
  Acknowledged: ['SampleCustodian', 'LabManager', 'Analyst', 'Reviewer', 'QA'],
};
