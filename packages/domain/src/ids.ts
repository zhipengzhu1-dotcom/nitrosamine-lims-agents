// Branded identifiers. Parsed once at the wire or row boundary, trusted inside.
//
// A brand is a set of tags, so a TestId is also a RecordId and still not a RunId. (One tag per
// brand under one key would intersect 'RecordId' & 'TestId' to never, and every id would be
// assignable to every other.)

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: { readonly [K in B]: true } };

export type PersonId = Brand<string, 'PersonId'>;
export type LabId = Brand<string, 'LabId'>; // also the Lab's ledger id
export type LedgerId = Brand<string, 'LedgerId'>; // a Lab's id or the company ledger
export type CustomerId = Brand<string, 'CustomerId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CommitKey = Brand<string, 'CommitKey'>; // one per attempt, minted by the prompt

export type RecordId = Brand<string, 'RecordId'>;
export type TestId = RecordId & Brand<string, 'TestId'>;
export type RunId = RecordId & Brand<string, 'RunId'>;
export type TestReportId = RecordId & Brand<string, 'TestReportId'>;
export type ValueRecordId = RecordId & Brand<string, 'ValueRecordId'>;
export type ReviewId = RecordId & Brand<string, 'ReviewId'>;

export type SubmissionId = Brand<string, 'SubmissionId'>;
export type SampleId = Brand<string, 'SampleId'>;
export type PreparationId = Brand<string, 'PreparationId'>;
export type MethodVersionId = RecordId & Brand<string, 'MethodVersionId'>;
export type EquipmentId = Brand<string, 'EquipmentId'>;
export type AnalyteKey = Brand<string, 'AnalyteKey'>; // 'NDMA'

export type VersionId = Brand<string, 'VersionId'>;
export type SignatureId = Brand<string, 'SignatureId'>;
/** Lowercase hex SHA-256 as the database stored it. The client displays it and never computes it. */
export type Sha256Hex = Brand<string, 'Sha256Hex'>;

/** What a signing request carries back: the version the prompt showed and its hash. */
export type VersionRef = { readonly versionId: VersionId; readonly hash: Sha256Hex };
