// What the web app's session and signing wiring needs beyond index.ts. Kept in its own file so
// the sample-chain unit's additions to index.ts and these never touch the same lines.

import type { SessionDto } from './index.ts';

type Locked = Extract<SessionDto, { state: 'locked' }>;
type Active = Extract<SessionDto, { state: 'active' }>;

/**
 * GET /api/session. A locked answer also says when it locked, in which Lab's zone, and who the
 * owner is in full, because the LockScreen names them and the lock reason without any other read.
 */
export type SessionAnswer =
  | Extract<SessionDto, { state: 'none' }>
  | (Locked & {
      readonly owner: Locked['owner'] & { readonly nativeName: string | null; readonly roles: readonly string[] };
      readonly lockedAt: string;
      readonly zone: string | null;
      readonly workstation: string;
    })
  | Active;

export const STAFF_ROLE_LABEL: { readonly [role: string]: string } = {
  SampleCustodian: 'Sample Custodian',
  Analyst: 'Analyst',
  Reviewer: 'Reviewer',
  QA: 'QA',
  LabManager: 'Lab Manager',
  CustomerUser: 'Customer User',
  CustomerApprover: 'Customer Approver',
  Admin: 'Admin',
};

/**
 * The roles a signing of each meaning may act under, so the prompt can open signing.prepare under
 * a role the person holds. A copy of @lims/domain/signing's SIGNS_AS, which the web may not import;
 * apps/api/test/contract.test.ts fails if the two differ.
 */
export const SIGNS_AS = {
  Performed: ['Analyst'],
  Verified: ['Analyst', 'Reviewer'],
  Reviewed: ['Reviewer'],
  Approved: ['QA', 'Reviewer', 'LabManager'],
  Released: ['QA'],
  Authored: ['LabManager', 'Reviewer'],
  Acknowledged: ['SampleCustodian', 'LabManager', 'Analyst', 'Reviewer', 'QA'],
} as const satisfies { readonly [meaning: string]: readonly string[] };

/** The Reason for Change picklist value.change and value.reject accept; Other carries free text. */
export const CHANGE_REASONS = [
  { code: 'transcription-error', label: 'Transcription error' },
  { code: 'wrong-unit', label: 'Wrong unit' },
  { code: 'wrong-item-selected', label: 'Wrong item selected' },
  { code: 'instrument-reprint', label: 'Instrument reprint' },
] as const;

/** A Recorded Value as value.record and value.change return it. */
export type ValueSavedDto = {
  readonly value: string;
  readonly version: { readonly versionId: string; readonly versionNo: number; readonly hash: string };
  readonly standing: 'effective' | 'pending';
};

/**
 * The password rules as the enrolment page prints them before the person types (decisions 7 and
 * 22). The server's checks are the rule; this is their wording, and a test keeps the two equal.
 */
export const PASSWORD_RULES = [
  'The password needs at least 15 characters.',
  'The password needs an upper-case letter, a lower-case letter, a digit and a symbol.',
  'The password must not contain your user ID or name.',
  'That password appears in a published breach; choose another.',
] as const;

/** Each meaning's fixed statement, which a SignatureLine prints beside it (decision 13). */
export const STATEMENT = {
  Performed: 'I performed this work and recorded it completely and accurately.',
  Verified: 'I checked this entry against its source and it is correct.',
  Reviewed: 'I reviewed these records, including their audit trail, and they are complete and correct.',
  Approved: 'I approve this record for use.',
  Released: 'I release this Test Report to the Customer.',
  Authored: 'I wrote this draft and submit it for review.',
  Acknowledged: 'I have read and understood this.',
} as const satisfies { readonly [meaning in keyof typeof SIGNS_AS]: string };
