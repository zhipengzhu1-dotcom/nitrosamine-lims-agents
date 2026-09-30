// Fictional data for the gallery and the tests. No real person, instrument or result.
import {
  commitKey,
  decimalString,
  sha256Hex,
  type AuditEntry,
  type EligibilityAnswer,
  type Person,
  type Signature,
  type SigningItem,
} from '../model';

export const LAB_ZONE = 'America/New_York';

export const mei: Person = { printedName: 'Mei Chen', nativeName: '陈梅', username: 'mchen', role: 'Analyst' };
export const omar: Person = { printedName: 'Omar Haddad', nativeName: null, username: 'ohaddad', role: 'Reviewer' };
export const ruth: Person = { printedName: 'Ruth Okafor', nativeName: null, username: 'rokafor', role: 'QA' };

export const HASH_TEST = sha256Hex('3f9a1c07b2e84d5a9c16f0e27a4b8d3c5e7f1029a6b4c8d0e2f4a6b8c0d2e4f6');
export const HASH_RUN = sha256Hex('a41d7e02c9b35f86e17a4c90d2b63f58e0a7c19b4d26f83a5c07e91b2d4f6a8c');
export const HASH_FILE = sha256Hex('0c5e9b17d4a2f8636e1b0a9c7d5f3e21b8a6c4d2e0f1a3b5c7d9e1f3a5b7c9d1');

export const performedTestItem: SigningItem = {
  version: { record: 'Test T26-04175', versionNo: 2, versionId: 'rv-7c1e2d', hash: HASH_TEST },
  values: [
    { label: 'NDMA', value: '0.0112', unit: 'ppm', draft: true },
    { label: 'NDEA', value: '< LOQ (0.0050 ppm)', unit: null, draft: true },
    { label: 'NMBA', value: 'Not detected (< 0.0015 ppm)', unit: null, draft: true },
  ],
  sourceFiles: [{ name: 'RD-102/R26-0412/TargetLynx_R26-0412.xml', sha256: HASH_FILE }],
};

export const runItem: SigningItem = {
  version: { record: 'Run R26-0412', versionNo: 1, versionId: 'rv-19a4b0', hash: HASH_RUN },
  values: [],
  sourceFiles: [],
};

export const eligibleAnswer: EligibilityAnswer = {
  eligible: true,
  authorisation: { meaning: 'Performed', scope: 'Method RD-M-017 (nitrosamines, LC-MS/MS)', validUntil: '2027-03-31' },
  trainingRecord: { document: 'RD-M-017', version: '4' },
};

export const notEligibleAnswer: EligibilityAnswer = {
  eligible: false,
  reason: 'Her Authorisation for Method RD-M-017 ended on 2026-09-01. QA can renew it after a Competence Assessment.',
};

export const PERFORMED_STATEMENT =
  'I performed this work as recorded, and the values and files listed are the complete record of it.';

export const signature: Signature = {
  meaning: 'Performed',
  statement: PERFORMED_STATEMENT,
  signer: mei,
  lab: 'RD Newark',
  workstation: 'Bench PC RD-102-02',
  signedAt: { utc: '2026-07-14T14:40:12Z', zone: LAB_ZONE },
  version: performedTestItem.version,
  standing: 'stands',
};

export const auditEntries: readonly AuditEntry[] = [
  {
    id: 'a1',
    at: { utc: '2026-07-14T13:02:44Z', zone: LAB_ZONE },
    actor: mei,
    action: 'value.record',
    record: 'Test T26-04175',
    field: 'Preparation 1 weight',
    oldValue: null,
    newValue: '100.12 mg',
    reason: 'Recorded',
    afterFirstSave: false,
  },
  {
    id: 'a2',
    at: { utc: '2026-07-14T13:09:10Z', zone: LAB_ZONE },
    actor: mei,
    action: 'value.change',
    record: 'Test T26-04175',
    field: 'Preparation 1 weight',
    oldValue: '100.12 mg',
    newValue: '100.21 mg',
    reason: 'Transcription error',
    afterFirstSave: true,
  },
  {
    id: 'a3',
    at: { utc: '2026-07-14T14:40:12Z', zone: LAB_ZONE },
    actor: mei,
    action: 'signing.sign',
    record: 'Test T26-04175',
    field: null,
    oldValue: null,
    newValue: 'Performed, Record Version 2',
    reason: 'Signed',
    afterFirstSave: false,
  },
  {
    id: 'a4',
    at: { utc: '2026-07-15T09:15:00Z', zone: LAB_ZONE },
    actor: omar,
    action: 'review.tick',
    record: 'Review RV-26-0211',
    field: 'Audit trail reviewed',
    oldValue: 'No',
    newValue: 'Yes',
    reason: 'Reviewed',
    afterFirstSave: false,
  },
];

export const ndmaLimit = { kind: 'NMT', value: decimalString('0.0300'), unit: 'ppm' } as const;

export function keys() {
  let n = 0;
  return () => commitKey(`key-${++n}`);
}
