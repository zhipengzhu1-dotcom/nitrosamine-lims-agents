// The shapes the presentational components print. The wiring unit maps server DTOs onto them.
// Every value here is a server fact: the browser prints it and never computes a verdict,
// an eligibility, a hash or a limit from it (decision 23 rule 14).

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A decimal exactly as stored: its digits and its written decimals, never a JS number (rule 20). */
export type DecimalString = Brand<string, 'DecimalString'>;
export type Sha256Hex = Brand<string, 'Sha256Hex'>;
/** One-time key a prompt or sheet carries; the server refuses a second commit with it (rule 25). */
export type CommitKey = Brand<string, 'CommitKey'>;

const DECIMAL = /^-?\d+(\.\d+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function decimalString(written: string): DecimalString {
  if (!DECIMAL.test(written)) throw new Error(`Not a decimal string: ${JSON.stringify(written)}`);
  return written as DecimalString;
}

export function sha256Hex(hex: string): Sha256Hex {
  if (!SHA256.test(hex)) throw new Error(`Not a SHA-256 hex digest: ${JSON.stringify(hex)}`);
  return hex as Sha256Hex;
}

export function commitKey(key: string): CommitKey {
  if (key.length === 0) throw new Error('Empty commit key');
  return key as CommitKey;
}

/** A server instant: ISO 8601 UTC plus the IANA zone of the Lab it is shown for (rule 9). */
export type ServerInstant = { readonly utc: string; readonly zone: string };

export type SignatureMeaning =
  | 'Performed'
  | 'Verified'
  | 'Reviewed'
  | 'Approved'
  | 'Released'
  | 'Authored'
  | 'Acknowledged';

export type Person = {
  readonly printedName: string;
  readonly nativeName: string | null;
  readonly username: string;
  readonly role: string;
};

export type RecordVersionRef = {
  /** The record as a person reads it, e.g. "Test T26-04175" or "Run R26-0412". */
  readonly record: string;
  readonly versionNo: number;
  readonly versionId: string;
  readonly hash: Sha256Hex;
};

/** stands, or one of decision 13's two failure states (rule 11). */
export type SignatureStanding = 'stands' | 'changed-after-signature' | 'invalid';

export type Signature = {
  readonly meaning: SignatureMeaning;
  readonly statement: string;
  readonly signer: Person;
  readonly lab: string;
  readonly workstation: string | null;
  readonly signedAt: ServerInstant;
  readonly version: RecordVersionRef;
  readonly standing: SignatureStanding;
};

/** The server's answer to "may this person sign this, now", shown before credentials (rule 5). */
export type EligibilityAnswer =
  | {
      readonly eligible: true;
      /** Null for a meaning no Authorisation governs, such as Acknowledged on a Training Record. */
      readonly authorisation: {
        readonly meaning: SignatureMeaning;
        readonly scope: string;
        /** A Lab date as the server wrote it, e.g. "2027-03-31". */
        readonly validUntil: string;
      } | null;
      /** For a Check or a Method: the Training Record on the Document version in use. */
      readonly trainingRecord: { readonly document: string; readonly version: string } | null;
    }
  | { readonly eligible: false; readonly reason: string };

export type SignedValue = {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  /** Imported and not yet signed Performed: printed in pencil. */
  readonly draft: boolean;
};

export type SourceFile = { readonly name: string; readonly sha256: Sha256Hex | null };

/** One record in "What you are signing". Group signing lists several (rule 8). */
export type SigningItem = {
  readonly version: RecordVersionRef;
  readonly values: readonly SignedValue[];
  readonly sourceFiles: readonly SourceFile[];
};

export type NonEmpty<T> = readonly [T, ...T[]];

export function mapNonEmpty<T, U>(items: NonEmpty<T>, f: (item: T) => U): NonEmpty<U> {
  const [head, ...rest] = items;
  return [f(head), ...rest.map(f)];
}

export type Credentials = {
  readonly userId: string;
  readonly password: string;
  readonly secondFactor: { readonly kind: 'code'; readonly code: string } | { readonly kind: 'passkey' };
};

/** What a commit's server answer means to the sheet that sent it. Refusal text arrives as props. */
export type CommitOutcome = 'done' | 'refused';

export type Receipt = {
  /** Server-rendered, e.g. "Assigned T26-04175 to Mei Chen." */
  readonly summary: string;
  readonly at: ServerInstant;
  readonly kind: 'audited' | 'signed';
};

export type AuditEntry = {
  readonly id: string;
  readonly at: ServerInstant;
  readonly actor: Person;
  readonly action: string;
  readonly record: string;
  readonly field: string | null;
  /** null when the field had no value before (a first save) or the entry is an event. */
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly reason: string;
  readonly afterFirstSave: boolean;
};

export type ReasonOption = { readonly code: string; readonly label: string };

export type ReasonForChange =
  | { readonly kind: 'picklist'; readonly code: string }
  | { readonly kind: 'other'; readonly text: string };

export type CriticalChange = {
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly unit: string | null;
};

export type FitnessStatus = 'Quarantined' | 'In use' | 'Suspended' | 'Expired' | 'Retired';

/** A Fitness Status as the server rendered it; `note` is its reason or validity date (rule 19). */
export type Fitness =
  | { readonly status: FitnessStatus; readonly note: string }
  | { readonly status: 'unknown' };

const FITNESS_STATUSES: readonly FitnessStatus[] = ['Quarantined', 'In use', 'Suspended', 'Expired', 'Retired'];

function isFitnessStatus(status: unknown): status is FitnessStatus {
  return FITNESS_STATUSES.some((known) => known === status);
}

/** A status the UI does not know, or one without its reason or date, is unknown and blocks (rule 19). */
export function parseFitness(status: unknown, note: string | null): Fitness {
  if (isFitnessStatus(status) && note !== null && note !== '') return { status, note };
  return { status: 'unknown' };
}

export type RiskLevel = 'Minor' | 'Major' | 'Critical';

export type DeviationRef = { readonly id: string; readonly kind: string; readonly riskLevel: RiskLevel };

export type Hold = {
  readonly id: string;
  /** e.g. "Equipment Deviation", "Failed Run Check" */
  readonly kind: string;
  readonly reason: string;
  /** The steps this Hold blocks, by name. */
  readonly blocks: readonly string[];
};

export type GxpClass = 'GMP' | 'non-GMP';

/** A limit printed from its stored strings, with the unit and the operator (rule 20). */
export type Limit =
  | { readonly kind: 'NMT'; readonly value: DecimalString; readonly unit: string }
  | { readonly kind: 'NLT'; readonly value: DecimalString; readonly unit: string }
  | { readonly kind: 'range'; readonly low: DecimalString; readonly high: DecimalString; readonly unit: string };

export type LimitLine = { readonly label: string; readonly limit: Limit };

export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'provisional' | 'neutral';

/** A status word the server computed; the UI adds the glyph and colour for its tone. */
export type ServerStatus = { readonly word: string; readonly tone: Tone };

export type BlockReason = { readonly text: string };

export type Step =
  | { readonly name: string; readonly state: 'done' | 'current' | 'next'; readonly note: string | null }
  | { readonly name: string; readonly state: 'blocked'; readonly note: string | null; readonly reasons: NonEmpty<BlockReason> };

export type LockReason = 'manual' | 'switch-user' | 'idle';

export type Workstation = { readonly name: string; readonly room: string | null };
