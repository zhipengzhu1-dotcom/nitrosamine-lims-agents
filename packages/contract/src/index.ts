// The wire contract, shared by apps/api and apps/web. apps/web imports only this package: it gets
// shapes, never rules, so no verdict, eligibility or hash is computed in the browser. The server
// computes; the browser prints (decision 23 rule 14).
//
// The schemas parse request bodies at the boundary. The DTOs are the server's already-rendered
// facts: refusal messages, hashes as hex, times as ISO-8601 UTC strings.

import { z } from 'zod';

/** Ids cross the wire as plain uuids; the server brands them as it parses (apps/api/src/wire.ts). */
export const uuid = z.uuid();
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const VersionRefSchema = z.object({ versionId: uuid, hash: Sha256HexSchema });

export const MEANINGS = ['Performed', 'Verified', 'Reviewed', 'Approved', 'Released', 'Authored', 'Acknowledged'] as const;
export const MeaningSchema = z.enum(MEANINGS);

export const STAFF_ROLES = ['SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager'] as const;
export const CUSTOMER_ROLES = ['CustomerUser', 'CustomerApprover'] as const;

/** Typed at every sign-in, unlock, takeover and signing (decision 13 §1). The keypad fills only `totp`. */
export const CredentialsSchema = z.object({
  typedUserId: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  totp: z.string().regex(/^\d{6}$/),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

/** Every command request body: the attempt's commit key and the command's input. */
export const CommandEnvelope = z.object({ commitKey: uuid, input: z.unknown() });

/** The header every command carries; a request without it is refused before anything is read. */
export const COMMAND_HEADER = 'x-lims-command';
export const SESSION_COOKIE = 'lims_session';

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

/** While fictional, every page shows the banner (#34). */
export type DataClass = 'fictional' | 'real';

export type SessionDto =
  | { readonly state: 'none'; readonly dataClass: DataClass }
  | { readonly state: 'locked'; readonly dataClass: DataClass; readonly owner: { readonly printedName: string; readonly username: string }; readonly lockReason: 'manual' | 'switch-user' | 'idle' }
  | {
      readonly state: 'active';
      readonly dataClass: DataClass;
      readonly person: { readonly printedName: string; readonly nativeName: string | null; readonly username: string };
      readonly lab: { readonly id: string; readonly code: string; readonly zone: string } | null;
      readonly customer: { readonly id: string } | null;
      readonly roles: readonly string[];
      readonly workstation: string;
      readonly startedAt: string;
      readonly idleLockAt: string;
      readonly absoluteEndAt: string;
      /** Changes on every unlock; the app remounts on it. */
      readonly epoch: string;
    };

export type ReceiptDto<D = unknown> = {
  readonly kind: 'receipt';
  /** What the rail's middle shows after a commit. */
  readonly summary: string;
  /** Server time of the commit, ISO-8601 UTC. */
  readonly at: string;
  readonly act: 'audited' | 'signed';
  readonly data: D;
  readonly replayed?: true;
};

/** The server's refusal, as typed in @lims/domain/refusal; the message is the sentence to print. */
export type RefusalDto = {
  readonly kind: 'refusal';
  readonly refusal: { readonly kind: string; readonly message: string } & Record<string, unknown>;
  readonly replayed?: true;
};

export type OutcomeDto<D = unknown> = ReceiptDto<D> | RefusalDto;

/** A signature as the SignatureLine prints it (decision 23 rule 10). */
export type SignatureDto = {
  readonly id: string;
  readonly meaning: string;
  readonly printedName: string;
  readonly username: string;
  readonly role: string;
  readonly signedAtUtc: string;
  readonly version: { readonly versionId: string; readonly versionNo: number; readonly hash: string };
};

export type StandingDto =
  | { readonly kind: 'unsigned' }
  | { readonly kind: 'signed'; readonly signatures: readonly SignatureDto[] }
  | { readonly kind: 'changed-after-signature'; readonly signed: readonly SignatureDto[]; readonly because: readonly string[] };

/** What signing.prepare returns: everything the sheet shows before any credential is asked for. */
export type PreparedSigningDto = {
  readonly meaning: string;
  readonly statement: string;
  readonly items: readonly {
    readonly record: string;
    readonly kind: string;
    readonly label: string;
    readonly version: { readonly versionId: string; readonly versionNo: number; readonly hash: string };
    readonly body: unknown;
    readonly pendingChanges: readonly { readonly value: string; readonly label: string; readonly from: unknown; readonly to: unknown }[];
  }[];
  readonly attestation: { readonly versionId: string; readonly versionNo: number; readonly hash: string } | null;
  readonly consequence: string;
  readonly eligibility: {
    readonly byRole: readonly {
      readonly role: string;
      readonly eligible: boolean;
      readonly reasons: readonly string[];
      readonly authorisation: { readonly meaning: string; readonly scope: string; readonly validUntil: string } | null;
    }[];
    readonly attemptsLeft: number;
  };
};

export type AuditEntryDto = {
  readonly seq: number;
  readonly atUtc: string;
  readonly person: string;
  readonly role: string;
  readonly action: string;
  readonly reasonCode: string;
  readonly reasonText: string | null;
  readonly table: string;
  readonly op: 'insert' | 'update';
  readonly changes: Readonly<Record<string, readonly [unknown, unknown]>>;
  readonly afterFirstSave: boolean;
};

// ---------------------------------------------------------------------------------------------
// The sample chain's views. Every number is the stored string; every verdict is the server's.
// ---------------------------------------------------------------------------------------------

export type VersionDto = { readonly versionId: string; readonly versionNo: number; readonly hash: string };

/** A Recorded Value as a screen prints it: the effective value, whether it is Verified, and any pending change. */
export type ValueDto = {
  readonly valueId: string;
  readonly field: string;
  readonly subject: string;
  readonly critical: boolean;
  readonly type: string;
  readonly unit: string | null;
  readonly text: string;
  readonly version: VersionDto;
  readonly verified: boolean;
  readonly pending: { readonly text: string; readonly version: VersionDto } | null;
};

export type SignatureLineDto = SignatureDto & { readonly stands: boolean };

export type RunSummaryDto = { readonly id: string; readonly number: string; readonly state: 'Open' | 'Performed' | 'Reviewed'; readonly version: VersionDto | null };

export type QueueTestDto = {
  readonly id: string;
  readonly label: string;
  readonly number: string | null;
  readonly state: string;
  readonly gxpClass: string;
  readonly customer: string;
  readonly product: string;
  readonly lotNumber: string;
  readonly sampleNumber: string | null;
  readonly submissionNumber: string;
  readonly method: string;
  readonly assignedAnalyst: { readonly id: string; readonly printedName: string } | null;
};

export type TestDetailDto = {
  readonly test: QueueTestDto & { readonly sampleId: string; readonly submissionId: string; readonly acceptanceReason: string | null; readonly methodVersionId: string | null; readonly specificationVersionId: string | null };
  readonly method: { readonly number: string; readonly title: string; readonly version: number; readonly analytes: readonly string[]; readonly minimumPreparations: string } | null;
  readonly specification: { readonly purpose: string; readonly versionNo: number; readonly hash: string; readonly sections: readonly { readonly jurisdiction: string; readonly ruleSetVersion: string; readonly lines: readonly { readonly analyte: string; readonly limit: string; readonly unit: string }[] }[] } | null;
  readonly preparations: readonly { readonly id: string; readonly prepNo: number; readonly subject: string }[];
  readonly values: readonly ValueDto[];
  readonly missingValues: readonly string[];
  readonly runs: readonly RunSummaryDto[];
  readonly version: VersionDto | null;
  readonly signatures: readonly SignatureLineDto[];
  /** The server's verdicts on the current version, as stored; empty until the Test is signed Performed. */
  readonly verdicts: readonly { readonly jurisdiction: string; readonly analyte: string; readonly limit: string; readonly compared: string | null; readonly sharePercent: string | null; readonly outcome: string; readonly ruleSetVersion: string; readonly calculationVersion: string; readonly preparations: readonly { readonly preparation: string; readonly compared: string; readonly conforms: boolean }[] }[];
  readonly holds: readonly string[];
};

export type RunDetailDto = {
  readonly run: RunSummaryDto & { readonly method: string; readonly acquiredBy: string; readonly tests: readonly { readonly id: string; readonly label: string }[] };
  readonly values: readonly ValueDto[];
  readonly instrument: { readonly code: string; readonly kind: string; readonly fitness: string } | null;
  readonly runChecks: readonly { readonly name: string; readonly unit: string; readonly criterion: string; readonly source: string; readonly value: string | null; readonly outcome: string }[];
  readonly signatures: readonly SignatureLineDto[];
  readonly missingValues: readonly string[];
};

export type ReviewDetailDto = {
  readonly reviewId: string;
  readonly reviews: { readonly id: string; readonly kind: string; readonly label: string };
  readonly checklistVersion: string;
  readonly items: readonly { readonly item: string; readonly ticked: boolean }[];
  readonly confirmations: readonly { readonly subject: string; readonly confirmation: string }[];
};

export type ReportDetailDto = {
  readonly report: { readonly id: string; readonly number: string; readonly state: string; readonly customer: string; readonly submissionNumber: string; readonly version: VersionDto | null };
  readonly tests: readonly (QueueTestDto & { readonly version: VersionDto | null; readonly performedStands: boolean; readonly reviewedStands: boolean; readonly jurisdictions: readonly string[] })[];
  readonly signatures: readonly SignatureLineDto[];
  readonly issue: { readonly pdfSha256: string; readonly rendererRelease: string } | null;
};

export type AssignmentDto = {
  readonly test: QueueTestDto;
  /** Only the Analysts the assignment gate lets through (decision 19 §4). */
  readonly eligible: readonly { readonly id: string; readonly printedName: string; readonly username: string }[];
};

export type LabReferenceDto = {
  readonly lab: { readonly id: string; readonly code: string; readonly zone: string };
  readonly equipment: readonly { readonly id: string; readonly code: string; readonly kind: string; readonly fitness: string }[];
  readonly methodVersions: readonly { readonly id: string; readonly number: string; readonly version: number; readonly title: string; readonly runChecks: readonly { readonly name: string; readonly unit: string }[] }[];
  readonly reports: readonly { readonly id: string; readonly number: string; readonly state: string; readonly submissionNumber: string }[];
};

export type ChainVerdictDto = { readonly ledger: string; readonly code: string; readonly intactThrough: number; readonly firstBreak: number | null; readonly headMatches: boolean };

export type PortalSubmissionDto = {
  readonly id: string;
  readonly number: string;
  readonly labId: string | null;
  readonly labCode: string | null;
  readonly submittedAt: string | null;
  readonly status: string;
  readonly samples: readonly {
    readonly id: string; readonly lotNumber: string; readonly number: string | null; readonly product: string; readonly status: string;
    readonly tests: readonly { readonly id: string; readonly method: string; readonly status: string; readonly rejectionReason: string | null }[];
  }[];
};

export type PortalReportDto = { readonly id: string; readonly labId: string; readonly number: string; readonly submissionNumber: string; readonly releasedAtUtc: string; readonly pdfSha256: string };

export type PortalCatalogueDto = {
  readonly labs: readonly { readonly id: string; readonly code: string }[];
  readonly products: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly methods: readonly { readonly id: string; readonly number: string; readonly title: string }[];
};
