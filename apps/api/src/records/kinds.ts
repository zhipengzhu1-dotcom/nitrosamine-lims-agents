// The record kind register (TypeScript half; the SQL half is lims.record_kind). One entry per
// signable record type: its Recorded Value fields, how its label and canonical content are built,
// which Authorisation scope a signing on it needs, and a rule per meaning. Adding a kind is one
// KindDef listed at boot; versioning, sealing, Critical Data Change, signing, UNSIGNED, locks and
// audit are inherited from Records.

import type { DB, ReadDb } from '@lims/db';
import type { VersionBody } from '@lims/domain/canonical';
import type { GateResult } from '@lims/domain/gates';
import type { LabId, PersonId, RecordId, VersionRef } from '@lims/domain/ids';
import type { GateReason, Refusal } from '@lims/domain/refusal';
import type { Meaning } from '@lims/domain/signing';
import type { CommandTx } from '../commit.ts';
import type { Sealed, SignatureRow } from './index.ts';
import { valueKind } from './kinds/value.ts';

export type FieldSpec = {
  readonly critical: boolean; // ADR 0001: decides requires_approval in the database
  readonly type: 'decimal' | 'text' | 'ref' | 'blob' | 'boolean';
  readonly unit?: string;
  readonly subject: 'none' | 'preparation' | 'preparation+analyte' | 'run-check' | 'checklist-item';
  readonly verifiedEach: boolean; // typed entry: a second person signs Verified per value
};

export type Read = ReadDb<DB>;

export type RuleContext = { readonly q: Read; readonly dbNow: Date; readonly lab: LabId | null };

/** Who is signing: the session's person before credentials (a probe) or after re-authentication. */
export type Signer = { readonly person: PersonId; readonly role: string };

export type SigningRule = {
  /** What signing will do, shown before credentials: "The Test moves to Submitted for Review." */
  readonly consequence: string;
  /** The Authorisation meanings any one of which qualifies the signer (the prompt shows the current one); defaults to the meaning itself. */
  readonly authorisations?: readonly Meaning[];
  /**
   * Loads facts and calls a pure gate; a Refusal is for rules a gate has no reason for. The
   * attestation is the sealed Review a Reviewed or Released signing cites, else null.
   */
  readonly check: (ctx: RuleContext, signer: Signer, sealed: readonly Sealed[], attestation: Sealed | null) => Promise<GateResult | Refusal>;
  /** Consequential effects in the same transaction (a lifecycle transition, a lock). */
  readonly after?: (tx: CommandTx, sealed: Sealed, signature: SignatureRow) => Promise<void>;
};

export type KindDef = {
  readonly kind: string;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  /** The name a prompt or message prints: "Test RD-S-2026-000123/T1". */
  readonly label: (q: Read, record: RecordId) => Promise<string>;
  /** The Authorisation scope a signing on this record needs: its Method, or its record type. */
  readonly authorisationScope: (q: Read, record: RecordId) => Promise<string>;
  /**
   * Builds the body and its cites from EFFECTIVE state. Called only by Records.seal. The body
   * cites each child value and each cited record version by (id, hash), so one Merkle rule covers
   * every depth. A kind whose versions are written elsewhere (value) has none.
   */
  readonly content: ((q: Read, record: RecordId, dbNow: Date) => Promise<{ readonly body: VersionBody<string>; readonly cites: readonly VersionRef[] }>) | null;
  readonly signing: { readonly [M in Meaning]?: SigningRule };
};

/** Every kind at boot. The value kind is built in: its Authorisation scope is its parent's. */
export class KindRegistry {
  readonly #defs: ReadonlyMap<string, KindDef>;

  constructor(defs: readonly KindDef[]) {
    const value = valueKind((q, parent) => this.get(parent.kind).authorisationScope(q, parent.id));
    this.#defs = new Map([value, ...defs].map((d) => [d.kind, d]));
  }

  /** A kind the register does not know is a bug (the SQL and TypeScript registers must agree). */
  get(kind: string): KindDef {
    const d = this.#defs.get(kind);
    if (!d) throw new Error(`record kind ${kind} is not registered`);
    return d;
  }

  names(): readonly string[] {
    return [...this.#defs.keys()];
  }
}

/** A closed gate from a list of reasons, or an open one when the list is empty. */
export function gateOf(reasons: readonly GateReason[]): GateResult {
  const [first, ...rest] = reasons;
  return first === undefined ? { go: true } : { go: false, reasons: [first, ...rest] };
}
