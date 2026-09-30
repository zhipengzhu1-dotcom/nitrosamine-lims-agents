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

export type SessionDto =
  | { readonly state: 'none' }
  | { readonly state: 'locked'; readonly owner: { readonly printedName: string; readonly username: string }; readonly lockReason: 'manual' | 'switch-user' | 'idle' }
  | {
      readonly state: 'active';
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
