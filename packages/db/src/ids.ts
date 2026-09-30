// Branded identifiers. This is the minimum packages/db needs; packages/domain/ids.ts is the
// intended home (module map: db -> domain, ids only), and this file is deleted when it lands.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PersonId = Brand<string, 'PersonId'>;
export type LabId = Brand<string, 'LabId'>;
export type LedgerId = Brand<string, 'LedgerId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CommitKey = Brand<string, 'CommitKey'>;
export type RecordId = Brand<string, 'RecordId'>;
export type VersionId = Brand<string, 'VersionId'>;
export type SignatureId = Brand<string, 'SignatureId'>;
/** Lowercase hex SHA-256 as the database stored it. */
export type Sha256Hex = Brand<string, 'Sha256Hex'>;

/** What a signing request carries back: the version the prompt showed and its hash. */
export type VersionRef = { readonly versionId: VersionId; readonly hash: Sha256Hex };

/** A Lab's ledger id is the Lab id. */
export const ledgerOf = (lab: LabId): LedgerId => lab as string as LedgerId;

export const COMPANY_LEDGER = '00000000-0000-4000-8000-000000000001' as LedgerId;

/** The service identities the migrations install; each is a person holding one svc: role. */
export const SERVICE = {
  seed: { person: '00000000-0000-4000-8000-000000000002' as PersonId, role: 'svc:seed' },
  auth: { person: '00000000-0000-4000-8000-000000000003' as PersonId, role: 'svc:auth' },
  sessionSweeper: { person: '00000000-0000-4000-8000-000000000004' as PersonId, role: 'svc:session-sweeper' },
} as const;
