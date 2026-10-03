import type * as db from '@lims/db';
import { type Static, type TObject, type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';
import type { IncidentStepName } from './incidents.ts';
import { type Step, type StepName, stepNames, steps } from './steps.ts';

const role = Type.Enum({
  Admin: 'Admin',
  Analyst: 'Analyst',
  Customer: 'Customer',
  LabManager: 'LabManager',
  PlatformOperator: 'PlatformOperator',
  QA: 'QA',
  Reviewer: 'Reviewer',
  SampleCustodian: 'SampleCustodian',
} as const satisfies { [K in db.Role]: K });
export type Role = Static<typeof role>;
const testState = Type.Enum({
  Requested: 'Requested',
  Ready: 'Ready',
  Assigned: 'Assigned',
  SubmittedForReview: 'SubmittedForReview',
  Reviewed: 'Reviewed',
  Reported: 'Reported',
} as const satisfies { [K in db.TestState]: K });
export type TestState = Static<typeof testState>;
export const isTestState = (value: unknown): value is TestState => Value.Check(testState, value);
const meaning = Type.Enum({
  Acknowledged: 'Acknowledged',
  Approved: 'Approved',
  Authored: 'Authored',
  Performed: 'Performed',
  Released: 'Released',
  Reviewed: 'Reviewed',
  Verified: 'Verified',
} as const satisfies { [K in db.Meaning]: K });
export type Meaning = Static<typeof meaning>;

const uuid = Type.String({ format: 'uuid' });
const text = Type.String({ minLength: 1, maxLength: 200 });
/** A decimal as typed. */
export const decimalPattern = '-?[0-9]+(\\.[0-9]+)?';
const decimal = Type.String({ pattern: `^${decimalPattern}$` });
/** A System Incident's reference: eight Crockford base32 characters, which a person can read aloud. */
export const referencePattern = '[0-9A-HJKMNP-TV-Z]{8}';
const calendarDate = Type.String({ format: 'date' });
declare const instantBrand: unique symbol;
/**
 * A point in time: on the wire, and so in the web and the tests, an ISO 8601 string the database clock produced, in
 * UTC unless its name ends in `Lab` (`atLab`, `receivedAtLab`, `signedAtLab`): that one carries the offset of the
 * owning Lab's time zone in force when it was written, and the database renders it as text. For a UTC field the API hands Fastify the Date that Kysely returns, and Fastify
 * writes it with toISOString.
 */
export type Instant = string & { readonly [instantBrand]: true };
export const instant = Type.Unsafe<Instant>(Type.String({ format: 'date-time' }));
const nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);
const closed = { additionalProperties: false } as const;

const lab = Type.Object({ id: uuid, code: Type.String(), name: Type.String() });
export type Lab = Static<typeof lab>;
const actorContext = Type.Object({
  person: Type.Object({ id: uuid, username: Type.String(), displayName: Type.String(), customerId: nullable(uuid) }),
  lab,
  roles: Type.Array(role),
  /** The Workstation the session's browser is enrolled as, or null for an unregistered device. */
  workstation: nullable(Type.Object({ name: Type.String(), room: Type.String() })),
});
export type ActorContext = Static<typeof actorContext>;
/**
 * How long the session lasts from this answer: `idleLeftMs` if no request follows, `absoluteLeftMs` at most, and
 * `idleLimitMs` from each request that follows.
 * Durations, not instants, so the web counts down without comparing its clock with the server's.
 */
const sessionClock = Type.Object({
  idleLimitMs: Type.Integer({ minimum: 1 }),
  idleLeftMs: Type.Integer({ minimum: 0 }),
  absoluteLeftMs: Type.Integer({ minimum: 0 }),
});
export type SessionClock = Static<typeof sessionClock>;
/** What a person is told when the API refuses a session that has ended; the web shows it as the API sends it. */
export const SESSION_ENDED = 'Your session has ended. Sign in again.';
/** The person's own settings for the web. `reducedMotion` only ever reduces motion: the device's own setting still applies when it is off. */
const preferences = Type.Object({ reducedMotion: Type.Boolean() }, closed);
export type Preferences = Static<typeof preferences>;
const signedIn = Type.Object({ ...actorContext.properties, session: sessionClock, preferences });
export type SignedInView = Static<typeof signedIn>;
const testRow = Type.Object({
  id: uuid,
  state: testState,
  gxpClass: Type.String(),
  sampleNumber: Type.String(),
  description: Type.String(),
  receivedAt: nullable(instant),
  /** `receivedAt` on the wall clock of the Lab time zone the Sample kept, ISO 8601 with its offset, as the database renders it. */
  receivedAtLab: nullable(instant),
  customer: Type.String(),
  methodCode: Type.String(),
  methodVersion: Type.String(),
  methodTitle: Type.String(),
  assignee: nullable(Type.String()),
});
export type TestRow = Static<typeof testRow>;
const result = Type.Object({
  analyte: Type.String(),
  value: decimal,
  unit: Type.String(),
  injectionSequenceRef: Type.String(),
  notebookRef: Type.String(),
  performedOn: calendarDate,
});
export type Result = Static<typeof result>;
/** One Record Version of a record: its number, the canonical form that rendered it and the hex SHA-256 of its content. */
const recordVersionRef = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  canonicalForm: Type.Integer({ minimum: 0 }),
  contentHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
});
export type RecordVersionRef = Static<typeof recordVersionRef>;
/** What proved a signer at their Signature: the password alone under the demo login, or the password and an authenticator code. */
export const authenticator = Type.Enum({ Password: 'Password', PasswordAndCode: 'PasswordAndCode' } as const);
export type Authenticator = Static<typeof authenticator>;
const signature = Type.Object({
  meaning: meaning,
  signer: Type.String(),
  username: Type.String(),
  role: role,
  /** Null only on a Signature given before the signing function recorded what proved the signer. */
  authenticator: nullable(authenticator),
  signedAt: instant,
  /** `signedAt` on the wall clock of the zone its Lab was in at signing, ISO 8601 with that offset, as the database renders it. */
  signedAtLab: instant,
  /** The signed record's glossary noun, such as "Test Report". */
  record: Type.String(),
  recordVersion: recordVersionRef,
  /**
   * True once the record no longer holds the content this Signature was given on: a Lab record has a Record Version
   * later than the signed one, or a System Incident's content hashes differently from its signed Record Version.
   */
  unsigned: Type.Boolean(),
});
export type Signature = Static<typeof signature>;
/** An Audit Trail row snapshot, keyed by its stored column names. */
const rowSnapshot = Type.Record(Type.String(), Type.Unknown());
export type RowSnapshot = Static<typeof rowSnapshot>;
export const auditedTable = Type.Enum({
  customer: 'customer',
  person: 'person',
  method: 'method',
  submission: 'submission',
  lab: 'lab',
  sample: 'sample',
  test: 'test',
  result: 'result',
  test_report: 'test_report',
  record_version: 'record_version',
  signature: 'signature',
  audit_export: 'audit_export',
  signature_statement: 'signature_statement',
  signing_role: 'signing_role',
  reauthentication: 'reauthentication',
} as const);
export type AuditedTable = Static<typeof auditedTable>;
const chainKind = Type.Enum({ lab: 'lab', company: 'company' } as const);
export type ChainKind = Static<typeof chainKind>;
const sha256Hex = Type.String({ pattern: '^[0-9a-f]{64}$' });
/** A chain entry number as the database counts it: digits only, so that domain code can compare it without throwing. */
const seq = Type.String({ pattern: '^[0-9]+$' });
export const auditOp = Type.Enum({ INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' } as const);
/** An Audit Trail entry as the database holds it. */
const rawEntry = Type.Object({
  chain: Type.String(),
  seq,
  at: instant,
  actor: Type.String(),
  role: Type.String(),
  reason: Type.String(),
  table: Type.String(),
  op: auditOp,
  oldRow: nullable(rowSnapshot),
  newRow: nullable(rowSnapshot),
  transactionId: nullable(Type.String()),
  prevHash: sha256Hex,
  hash: sha256Hex,
});
export type RawEntry = Static<typeof rawEntry>;
const recordRef = Type.Object({ table: Type.String(), id: Type.String(), kind: Type.String(), label: Type.String() });
export type RecordRef = Static<typeof recordRef>;
/**
 * A value as the panel shows it: a reference reads as the record's label at the entry's time and links to its trail;
 * a stored instant carries the database's renderings, UTC and, on the Lab chain, the Lab's wall clock, as an entry's
 * `at` and `atLab` do, and `text` keeps it as stored.
 */
const shownValue = Type.Object({
  text: Type.String(),
  ref: nullable(Type.Object({ table: auditedTable, id: Type.String() })),
  instant: nullable(Type.Object({ at: instant, atLab: nullable(instant) })),
});
export type ShownValue = Static<typeof shownValue>;
const trailChange = Type.Object({
  field: Type.String(),
  label: Type.String(),
  old: nullable(shownValue),
  new: nullable(shownValue),
});
export type TrailChange = Static<typeof trailChange>;
/**
 * One Audit Trail entry in glossary words. `at` is the instant in UTC to the microsecond, as the hashed bytes render
 * it; `atLab` is the same instant on the owning Lab's zone in force then, ISO 8601 with its offset, and null on the
 * company chain. The web formats each in `apps/web/src/time.ts`.
 */
const trailEntry = Type.Object({
  chain: chainKind,
  seq,
  at: instant,
  atLab: nullable(instant),
  actor: Type.Object({ label: Type.String(), role: Type.String() }),
  reason: Type.String(),
  op: rawEntry.properties.op,
  record: recordRef,
  changes: Type.Array(trailChange),
  afterFirstSave: Type.Boolean(),
  raw: rawEntry,
});
export type TrailEntry = Static<typeof trailEntry>;
const trail = Type.Object({ record: recordRef, labZone: Type.String(), entries: Type.Array(trailEntry) });
export type Trail = Static<typeof trail>;
/** A person as the Admin of the session's Lab sees them: the roles are those held in that Lab. */
const staffPerson = Type.Object({
  id: uuid,
  username: Type.String(),
  printedName: Type.String(),
  roles: Type.Array(role),
  /** True once the person has set a password through their one-time link. */
  credentialSet: Type.Boolean(),
  /** True once the person has enrolled their authenticator through an enrolment grant. */
  authenticatorEnrolled: Type.Boolean(),
  identityVerifiedAt: nullable(instant),
  /** Who checked the person's identity and what they checked; null for a seeded demo account. */
  identityVerifiedBy: nullable(Type.String()),
  identityEvidence: nullable(Type.String()),
});
export type StaffPerson = Static<typeof staffPerson>;
const identityVerification = Type.Object({
  id: uuid,
  printedName: Type.String(),
  evidence: Type.String(),
  checkedBy: Type.String(),
  checkedAt: instant,
});
export type IdentityVerification = Static<typeof identityVerification>;
/** The Lab's staff, and the Identity Verifications its Admins recorded that no account names yet. */
const staff = Type.Object({ people: Type.Array(staffPerson), awaitingAccount: Type.Array(identityVerification) });
/** Every Access Event kind but Lockout, which alone lists the sessions it ended. */
const accessEventKindButLockout = Type.Enum({
  SignInSucceeded: 'SignInSucceeded',
  SignInFailed: 'SignInFailed',
  SignOut: 'SignOut',
  IdleExpiry: 'IdleExpiry',
  AbsoluteExpiry: 'AbsoluteExpiry',
  Lock: 'Lock',
  Unlock: 'Unlock',
  UnlockFailed: 'UnlockFailed',
  Takeover: 'Takeover',
  LabSwitch: 'LabSwitch',
  LabSwitchFailed: 'LabSwitchFailed',
  ReauthenticationFailed: 'ReauthenticationFailed',
  PasswordSet: 'PasswordSet',
  PasswordChanged: 'PasswordChanged',
  AuthenticatorEnrolled: 'AuthenticatorEnrolled',
  EnrolmentGrantIssued: 'EnrolmentGrantIssued',
} as const satisfies { [K in Exclude<db.AccessEventKind, 'Lockout'>]: K });
const signInFailure = Type.Enum({
  UnknownUserId: 'UnknownUserId',
  WrongPassword: 'WrongPassword',
  WrongPasswordOnLockedAccount: 'WrongPasswordOnLockedAccount',
  AccountLocked: 'AccountLocked',
  NoCredential: 'NoCredential',
  NoLab: 'NoLab',
  NoLabChosen: 'NoLabChosen',
  NoMembership: 'NoMembership',
  NotInWorkstationLab: 'NotInWorkstationLab',
  OtherUserId: 'OtherUserId',
  SessionEnded: 'SessionEnded',
  WrongUserId: 'WrongUserId',
  WrongCode: 'WrongCode',
  NoAuthenticator: 'NoAuthenticator',
  AlreadyEnrolled: 'AlreadyEnrolled',
  OtherPersonSignedIn: 'OtherPersonSignedIn',
  CodeAlreadyUsed: 'CodeAlreadyUsed',
  NoEnrolmentGrant: 'NoEnrolmentGrant',
} as const satisfies { [K in db.SignInFailure]: K });
/** A session a Lockout ended, at the Lockout's instant: when it was signed in, and on which Workstation. */
const endedSession = Type.Object({ id: uuid, signedInAt: instant, workstation: nullable(Type.String()) });
export type EndedSession = Static<typeof endedSession>;
const listedEvent = {
  id: uuid,
  at: instant,
  /** The Workstation it came from, if that is one of this Lab's. */
  workstation: nullable(Type.String()),
  sourceAddress: nullable(Type.String()),
  failureReason: nullable(signInFailure),
};
/**
 * One of a person's Access Events; a Lockout lists the sessions in this Lab that it ended, or null when it was recorded
 * before a Lockout was stamped at its lock's instant (#207), so the record cannot say which sessions it ended.
 */
const listedAccessEvent = Type.Union([
  Type.Object({ ...listedEvent, kind: Type.Literal('Lockout'), endedSessions: nullable(Type.Array(endedSession)) }),
  Type.Object({ ...listedEvent, kind: accessEventKindButLockout }),
]);
export type ListedAccessEvent = Static<typeof listedAccessEvent>;
/**
 * A page of a person's Access Events as this Lab's Admin reads them, newest first: those of sessions in this Lab, those
 * of no session, and every Lockout. `earlier` is the oldest listed while earlier ones exist, so the Admin reads those
 * before it, and is null once the person's oldest is listed.
 */
const personAccessEvents = Type.Object({
  person: Type.Object({ id: uuid, printedName: Type.String(), username: Type.String() }),
  events: Type.Array(listedAccessEvent),
  earlier: nullable(uuid),
});
export type PersonAccessEvents = Static<typeof personAccessEvents>;
/** The roles an Admin grants. Platform Operator is held outside the LIMS, and Customer Users get portal accounts. */
export const grantableRoles = ['SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager', 'Admin'] as const;
/** The one-time link's token goes to the person, who sets their own password with it; the LIMS keeps only its hash. */
const accountCreated = Type.Object({
  person: staffPerson,
  link: Type.Object({ token: Type.String(), expiresAt: instant }),
});
/** The enrolment grant's token goes to the person, who enrols their authenticator with it; the LIMS keeps only its hash. */
const enrolmentGrantIssued = Type.Object({
  person: staffPerson,
  grant: Type.Object({ token: Type.String(), expiresAt: instant }),
});
const reasonText = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' });
/** Lower-case letters, digits, dots and hyphens, starting with a letter, as the seeded usernames are. */
const username = Type.String({ pattern: '^[a-z][a-z0-9.-]{2,39}$' });
const reportRef = Type.Object({ id: uuid, number: Type.String() });
/** The signature statement in force: what a signer attests, as QA approved it, with the version a Signature records. */
const signatureStatement = Type.Object({ version: Type.Integer({ minimum: 1 }), text: Type.String() });
export type SignatureStatement = Static<typeof signatureStatement>;
/**
 * `recordVersion` is the Test's latest; null for a Customer before release, since a hash of unreleased content would let a
 * guessed value be confirmed. `statement` is the signature statement in force, null for a Customer, who never signs.
 * `withheld` is true while the Result, Signatures and Record Version are held back from a Customer until release, so their
 * absence never reads as none.
 */
const testView = Type.Object({
  test: testRow,
  recordVersion: nullable(recordVersionRef),
  report: nullable(reportRef),
  result: nullable(result),
  signatures: Type.Array(signature),
  withheld: Type.Boolean(),
  next: nullable(Type.Enum(stepNames)),
  statement: nullable(signatureStatement),
});
/** `recordVersion` is the Test Report's latest, which the Released Signature's version is compared with. */
const testReport = Type.Object({
  report: reportRef,
  recordVersion: recordVersionRef,
  test: testRow,
  result: nullable(result),
  signatures: Type.Array(signature),
});
const lookups = Type.Object({
  methods: Type.Array(Type.Object({ id: uuid, code: Type.String(), version: Type.String(), title: Type.String() })),
  analysts: Type.Array(Type.Object({ id: uuid, displayName: Type.String() })),
});
/** How a recomputed chain stands: Intact through its last entry, or Broken from its first break on. */
export const chainVerdict = Type.Union([Type.Literal('Intact'), Type.Literal('Broken')]);
export type ChainVerdict = Static<typeof chainVerdict>;
/** Where a System Incident stands: Open until its actions are recorded and acknowledged, then Closed. */
const incidentState = Type.Enum({
  Open: 'Open',
  Acknowledged: 'Acknowledged',
  Closed: 'Closed',
} as const satisfies { [K in db.IncidentState]: K });
export type IncidentState = Static<typeof incidentState>;
/**
 * One break chain verification found: its first entry that fails to verify (one past the last for a moved head), and
 * the System Incident that records it in the state it is in now. The same break names the same incident on every
 * verification, whatever its state; a break at another entry, or one tampered with again, has its own. Past the first
 * 100 breaks of a chain, one more names every break after them, with their count.
 */
const chainBreak = Type.Object({
  entry: seq,
  failure: Type.String(),
  incident: Type.String({ pattern: `^${referencePattern}$` }),
  incidentState,
});
export type ChainBreak = Static<typeof chainBreak>;
const chainVerification = Type.Object({
  chain: chainKind,
  verdict: chainVerdict,
  lastEntry: seq,
  intactThrough: seq,
  /** Every break, in entry order; none when the chain is Intact. */
  breaks: Type.Array(chainBreak),
  report: Type.String(),
});
export type ChainVerification = Static<typeof chainVerification>;
const auditTrailVerification = Type.Object({ at: instant, chains: Type.Array(chainVerification) });
export type AuditTrailVerification = Static<typeof auditTrailVerification>;
const auditExportFormat = Type.Enum({ JSON: 'JSON', CSV: 'CSV' } as const satisfies { [K in db.AuditExportFormat]: K });
export type AuditExportFormat = Static<typeof auditExportFormat>;
const customerRef = Type.Object({ id: uuid, name: Type.String() });
/** An entry as an Audit Export carries it: `redacted` is true when another Customer's identifier was replaced in it, raw values included, so its raw rows no longer hash to `raw.hash`. */
const exportedEntry = Type.Object({ ...trailEntry.properties, redacted: Type.Boolean() });
export type ExportedEntry = Static<typeof exportedEntry>;
/** The JSON data file of an Audit Export: what it covers, as of when, the chains' state then, and every entry. */
export const auditExportData = Type.Object({
  customer: customerRef,
  lab: Type.Object({ code: Type.String(), name: Type.String(), zone: Type.String() }),
  asOf: instant,
  generatedBy: Type.Object({ label: Type.String(), username: Type.String(), role }),
  chains: Type.Array(chainVerification),
  entries: Type.Array(exportedEntry),
});
export type AuditExportData = Static<typeof auditExportData>;
const exportedFile = Type.Object({
  name: Type.String(),
  mediaType: Type.String(),
  sha256: sha256Hex,
  base64: Type.String({ pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
});
const auditExport = Type.Object({
  id: uuid,
  customer: customerRef,
  generatedAt: instant,
  entryCount: Type.Integer({ minimum: 0 }),
  /** The data file in the format asked for, then its PDF. */
  files: Type.Tuple([exportedFile, exportedFile]),
});
export type AuditExport = Static<typeof auditExport>;
const impactAnswer = Type.Enum({ Yes: 'Yes', No: 'No' } as const satisfies { [K in db.ImpactAnswer]: K });
export type ImpactAnswer = Static<typeof impactAnswer>;
/** Who recorded something on a System Incident. */
const recorder = Type.Object({ username: Type.String(), displayName: Type.String() });
/** An action as recorded on a System Incident: its text, who recorded it and the database's time. */
const recordedText = Type.Object({ text: Type.String(), by: recorder, at: instant });
export type RecordedText = Static<typeof recordedText>;
const systemIncident = Type.Object({
  reference: Type.String({ pattern: `^${referencePattern}$` }),
  kind: Type.Enum({
    UnexpectedFailure: 'UnexpectedFailure',
    UnraisableLogLine: 'UnraisableLogLine',
    Lockout: 'Lockout',
    SignInBurstFromAddress: 'SignInBurstFromAddress',
    SignInBurstOnUnknownUserId: 'SignInBurstOnUnknownUserId',
    RepeatedSignInOnLockedAccount: 'RepeatedSignInOnLockedAccount',
    ChainVerifyFailure: 'ChainVerifyFailure',
  } as const satisfies { [K in db.IncidentKind]: K }),
  state: incidentState,
  /** The failing step and error class of a failure of the LIMS; null for a sign-in incident. */
  step: nullable(Type.String()),
  recordId: nullable(uuid),
  requestedBy: nullable(uuid),
  sessionLabId: nullable(uuid),
  errorClass: nullable(Type.String()),
  /** What a sign-in incident names: the account, the source address, or the hex HMAC of an unknown user ID. */
  subjectId: nullable(uuid),
  sourceAddress: nullable(Type.String()),
  typedUserIdHmac: nullable(sha256Hex),
  /**
   * What a chain-verify failure names: the chain as the Audit Trail names it ('company' or the Lab's ID), the first and
   * last entries its breaks cover, and how many breaks it records (one, or every break after the first 100). The last
   * two are null on an incident opened before they were recorded.
   */
  chain: nullable(Type.Union([Type.Literal('company'), uuid])),
  firstFailure: nullable(seq),
  lastFailure: nullable(seq),
  breakCount: nullable(Type.Integer({ minimum: 1 })),
  sqlstate: nullable(Type.String()),
  constraintName: nullable(Type.String()),
  /** The database's insert time. */
  openedAt: instant,
  /** For an incident the database could not write at the time, the instant its log line was written, from the API host's clock. */
  loggedAt: nullable(instant),
  /** QA's answer to "could this have affected results or records?", once recorded. */
  impact: nullable(Type.Object({ answer: impactAnswer, by: recorder, at: instant })),
  /** The owner's immediate and corrective actions (ISO/IEC 17025 7.11.3 e), once recorded. */
  immediateAction: nullable(recordedText),
  correctiveAction: nullable(recordedText),
  /**
   * The Record Version an Acknowledged signing from this session binds: the incident's content as it is now, numbered
   * in this session's Lab, and the version a signing given on sight of it writes if the content is still the same.
   */
  recordVersion: recordVersionRef,
  statement: signatureStatement,
  /** The Acknowledged Signature, once given, with the Record Version it was given on and whether it still binds. */
  acknowledged: nullable(signature),
});
export type SystemIncident = Static<typeof systemIncident>;
/** One line of the System Incident list: enough to pick one out. */
const incidentRow = Type.Object({
  reference: systemIncident.properties.reference,
  kind: systemIncident.properties.kind,
  state: incidentState,
  openedAt: instant,
  step: nullable(Type.String()),
  chain: systemIncident.properties.chain,
});
export type IncidentRow = Static<typeof incidentRow>;
const stepTaken = Type.Object({ testId: uuid, state: testState });
/** What a committed step answers, and what a retry of the same press answers again. */
export type StepTaken = Static<typeof stepTaken>;
/**
 * Why the LIMS did not do what was asked, as one closed list the API, the web and the tests share. `unknownField` is
 * a body with a field its closed schema does not name, whatever else is wrong with it; `malformed` is any other
 * request Fastify refuses before the handler runs (a schema fault, unparseable JSON, a wrong media type, too large).
 * `badCredentials` is the one answer to every sign-in failure;
 * `accountLocked`, `labNotChosen` for a sign-in that names no Lab, and `role` for a Lab where the person holds no
 * Membership, come only after the right password. `noSession` covers no session presented and a session that
 * has ended. `sessionLocked` answers every request on a locked session except lock, unlock, sign-out and a sign-in over it. `stale` asks the person to reload; `state` says the step, or a Lab switch to the Lab already in use, does not apply. `keyReused` is a Commit Key sent again
 * with a different step or input, or from another session. `recordChanged` is a signing on sight of a Record Version that is no
 * longer the record's latest: the screen must show the record again before it is signed. `signingRefused` is what the signing
 * function refuses once the step's transaction has begun, such as a signature statement no longer in force. `notFound` also covers an
 * unknown route. `failure` is not a refusal but an unexpected failure, listed so that every non-2xx body has the one
 * shape below.
 */
export const refusalKinds = [
  'unknownField',
  'malformed',
  'badCredentials',
  'labNotChosen',
  'noSession',
  'sessionLocked',
  'accountLocked',
  'role',
  'guard',
  'state',
  'stale',
  'recordChanged',
  'signingRefused',
  'keyReused',
  'notFound',
  'failure',
] as const;
export type RefusalKind = (typeof refusalKinds)[number];
/** Narrows a wire value to a kind on the list, so that the web can branch on it without a schema checker. */
export const isRefusalKind = (value: unknown): value is RefusalKind => refusalKinds.some((k) => k === value);
/** The body of every non-2xx reply the API writes. */
export const refusalBody = Type.Object({ kind: Type.Enum(refusalKinds), message: Type.String() });
export type RefusalBody = Static<typeof refusalBody>;

/** The six-digit code from the person's authenticator, which the decided login asks for; any other text is a wrong code. */
const code = Type.Optional(text);
/** A sign-in names its Lab; the schema lets it out so that the API can answer `labNotChosen` after the password. */
const signIn = Type.Object({ username: text, password: text, code, labId: Type.Optional(uuid) }, closed);
const labSwitch = Type.Object({ username: text, password: text, code, labId: uuid }, closed);
/** The grant is the token from a second Admin's enrolment link; without one the enrolment is the uniform credential refusal. */
const authenticatorEnrolment = Type.Object(
  { username: text, password: text, grant: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) },
  closed,
);
/** An enrolled authenticator's secret, shown once: as text, and as the otpauth URI its QR code carries. */
const enrolled = Type.Object({ secret: Type.String(), otpauth: Type.String() });
/** A POST that takes nothing still declares a closed body, so that a field sent to it is refused like any other. */
const noBody = Type.Object({}, closed);
const byId = Type.Object({ id: uuid });
const byReference = Type.Object({ reference: Type.String({ pattern: `^${referencePattern}$` }) });
/** An action as the owner types it on a System Incident: up to a short paragraph, not blank. */
const actionText = Type.String({ minLength: 1, maxLength: 2000, pattern: '\\S' });
/** The Record Version the signer saw, as the screen showed it: the signing is refused if the record has moved on. */
const seenVersion = Type.Object({ version: recordVersionRef.properties.version, contentHash: sha256Hex }, closed);
const typedCredentials = Type.Object({ username: text, password: text, code }, closed);
/** What a signer types on the signature sheet: their user ID, their password and, under the decided login, a fresh code. */
export type TypedCredentials = Static<typeof typedCredentials>;
/** What a signing sends: the typed credentials, the Record Version the sheet showed and the signature statement version it showed. */
const signingBody = Type.Object(
  { ...typedCredentials.properties, recordVersion: seenVersion, statementVersion: Type.Integer({ minimum: 1 }) },
  closed,
);
export type SigningBody = Static<typeof signingBody>;
const reauthentication = Type.Object({ password: text, code }, closed);
/** A signed-in password change: the current password and, under the decided login, a fresh code, then the new password. */
const passwordChange = Type.Object({ password: text, code, newPassword: text }, closed);
const room = Type.Object({ id: uuid, name: Type.String() });
const workstation = Type.Object({
  id: uuid,
  name: Type.String(),
  room: Type.String(),
  browserPolicy: Type.String(),
  enrolled: Type.Boolean(),
});
export type Workstation = Static<typeof workstation>;
const workstations = Type.Object({
  rooms: Type.Array(room),
  workstations: Type.Array(workstation),
  /** The Workstation this browser's device token enrols it as now, which the next sign-in on it carries. */
  thisBrowser: nullable(workstation),
});
const workstationRegistration = Type.Object({ name: text, roomId: uuid, browserPolicy: text, reason: text }, closed);
const enrolment = Type.Object({ workstationId: uuid, reason: text }, closed);
const roomRegistration = Type.Object({ name: text, reason: text }, closed);
const stepEnvelope = Type.Object({
  commitKey: uuid,
  testId: Type.Optional(uuid),
  signature: Type.Optional(signingBody),
});
const stepInputs = {
  submit: Type.Object({ methodId: uuid, description: text }, closed),
  receive: Type.Object({}, closed),
  assign: Type.Object({ assigneeId: uuid }, closed),
  enterResult: Type.Object(
    {
      analyte: text,
      value: decimal,
      unit: text,
      injectionSequenceRef: text,
      notebookRef: text,
      performedOn: calendarDate,
    },
    closed,
  ),
  review: Type.Object({}, closed),
  release: Type.Object({}, closed),
} satisfies { [K in StepName]: TObject };
export type StepInput<K extends StepName> = Static<(typeof stepInputs)[K]>;
/** A press's step, record and entries as one text, the same in whatever order the entries were typed and with a cleared entry read as absent, so the API and the web agree on which presses are one press. */
export function pressText(step: StepName, testId: string | null, input: object): string {
  const entries = Object.entries(input).filter(([, value]) => value !== '');
  return JSON.stringify([step, testId, entries.sort(([a], [b]) => (a < b ? -1 : 1))]);
}
/** A step's body for any K. Its type keeps testId and signature optional; the wire schema requires them where the registry does. */
export type StepBody<K extends StepName> = Static<typeof stepEnvelope> & { input: StepInput<K> };

interface RouteSchema {
  params?: TObject;
  body?: TObject;
  response: { 200: TSchema; '4xx': typeof refusalBody; '5xx': typeof refusalBody };
}
export interface Route {
  method: 'GET' | 'POST';
  url: string;
  schema: RouteSchema;
}

function route<
  const M extends Route['method'],
  const U extends string,
  const S extends Omit<RouteSchema, 'response'>,
  R extends TSchema,
>(method: M, url: U, request: S, reply: R) {
  return { method, url, schema: { ...request, response: { 200: reply, '4xx': refusalBody, '5xx': refusalBody } } };
}

/** Every route the API serves besides the steps. */
export const routes = {
  labs: route('GET', '/api/labs', {}, Type.Array(lab)),
  /** Tells the sign-in page, before any session, whether this login asks for an authenticator code. */
  loginPolicy: route('GET', '/api/login', {}, Type.Object({ secondFactor: Type.Boolean() })),
  login: route('POST', '/api/login', { body: signIn }, signedIn),
  switchLab: route('POST', '/api/lab-switch', { body: labSwitch }, signedIn),
  logout: route('POST', '/api/logout', { body: noBody }, Type.Object({ ended: Type.Literal(true) })),
  lock: route(
    'POST',
    '/api/lock',
    { body: noBody },
    Type.Object({ locked: Type.Literal(true), message: Type.String() }),
  ),
  unlock: route('POST', '/api/unlock', { body: reauthentication }, signedIn),
  changePassword: route(
    'POST',
    '/api/password',
    { body: passwordChange },
    Type.Object({ changed: Type.Literal(true) }),
  ),
  workstations: route('GET', '/api/workstations', {}, workstations),
  registerRoom: route('POST', '/api/rooms', { body: roomRegistration }, room),
  registerWorkstation: route('POST', '/api/workstations', { body: workstationRegistration }, workstation),
  enrolWorkstation: route('POST', '/api/workstations/enrol', { body: enrolment }, workstation),
  me: route('GET', '/api/me', {}, signedIn),
  setPreferences: route('POST', '/api/me/preferences', { body: preferences }, preferences),
  /** Reads how long the session has left without counting as activity, for the web's countdown. */
  session: route('GET', '/api/session', {}, sessionClock),
  lookups: route('GET', '/api/lookups', {}, lookups),
  tests: route('GET', '/api/tests', {}, Type.Array(testRow)),
  test: route('GET', '/api/tests/:id', { params: byId }, testView),
  report: route('GET', '/api/tests/:id/report', { params: byId }, testReport),
  testTrail: route('GET', '/api/tests/:id/trail', { params: byId }, trail),
  recordTrail: route(
    'GET',
    '/api/trails/:table/:id',
    { params: Type.Object({ table: auditedTable, id: uuid }) },
    trail,
  ),
  verifyAuditTrail: route('POST', '/api/audit/verify', { body: noBody }, auditTrailVerification),
  /** The Customers QA can export for: those with a Sample in this Lab. */
  auditExportCustomers: route('GET', '/api/audit-exports/customers', {}, Type.Array(customerRef)),
  auditExport: route(
    'POST',
    '/api/audit-exports',
    { body: Type.Object({ customerId: uuid, format: auditExportFormat }, closed) },
    auditExport,
  ),
  staff: route('GET', '/api/staff', {}, staff),
  recordIdentityVerification: route(
    'POST',
    '/api/staff/identity-verifications',
    { body: Type.Object({ printedName: text, evidence: text }, closed) },
    identityVerification,
  ),
  createAccount: route(
    'POST',
    '/api/staff/accounts',
    { body: Type.Object({ identityVerificationId: uuid, username }, closed) },
    accountCreated,
  ),
  issueLink: route('POST', '/api/staff/links', { body: Type.Object({ personId: uuid }, closed) }, accountCreated),
  issueEnrolmentGrant: route(
    'POST',
    '/api/staff/enrolment-grants',
    { body: Type.Object({ personId: uuid }, closed) },
    enrolmentGrantIssued,
  ),
  accessEvents: route('GET', '/api/staff/:id/access-events', { params: byId }, personAccessEvents),
  /** The person's Access Events before one of theirs that this Lab sees, so the Admin reaches every one. */
  earlierAccessEvents: route(
    'GET',
    '/api/staff/:id/access-events/before/:before',
    { params: Type.Object({ id: uuid, before: uuid }) },
    personAccessEvents,
  ),
  grantMembership: route(
    'POST',
    '/api/staff/memberships',
    { body: Type.Object({ personId: uuid, role: Type.Enum(grantableRoles), reason: reasonText }, closed) },
    staffPerson,
  ),
  changePrintedName: route(
    'POST',
    '/api/staff/printed-names',
    { body: Type.Object({ personId: uuid, printedName: text, reason: reasonText }, closed) },
    staffPerson,
  ),
  enrolAuthenticator: route('POST', '/api/authenticator', { body: authenticatorEnrolment }, enrolled),
  setPasswordThroughLink: route(
    'POST',
    '/api/credentials',
    { body: Type.Object({ token: Type.String({ minLength: 1, maxLength: 100 }), password: text }, closed) },
    Type.Object({ username: Type.String() }),
  ),
  /** The System Incidents not yet Closed, newest first, for Admin and QA. */
  incidents: route('GET', '/api/incidents', {}, Type.Array(incidentRow)),
  incident: route('GET', '/api/incidents/:reference', { params: byReference }, systemIncident),
} satisfies Record<string, Route>;

const incidentStepInputs = {
  answerImpact: Type.Object({ answer: impactAnswer }, closed),
  recordImmediateAction: Type.Object({ text: actionText }, closed),
  recordCorrectiveAction: Type.Object({ text: actionText }, closed),
  acknowledge: Type.Object({}, closed),
  close: Type.Object({}, closed),
} satisfies { [K in IncidentStepName]: TObject };
/** What each System Incident step takes, as its route validates it. */
export type IncidentStepInputs = { [K in IncidentStepName]: Static<(typeof incidentStepInputs)[K]> };
/** The body of a System Incident step: the incident, the step's input, and the signature when the step signs. */
export interface IncidentStepBody<K extends IncidentStepName> {
  reference: string;
  input: IncidentStepInputs[K];
  signature?: SigningBody;
}

/** The route of one step on a System Incident: the body names the incident, carries the step's input, and a signature when the step signs. */
export function incidentStepRoute<K extends IncidentStepName>(name: K) {
  const body = Type.Object(
    { ...byReference.properties, input: incidentStepInputs[name], signature: Type.Optional(signingBody) },
    closed,
  );
  return route('POST', `/api/incident-steps/${name}`, { body }, systemIncident);
}

/** The route of one step, whose body requires a Commit Key, a testId when the step starts from a state, and a signature when it signs. */
export function stepRoute<K extends StepName>(name: K) {
  const step: Step = steps[name];
  const required = [
    'commitKey',
    ...(step.from === null ? [] : ['testId']),
    'input',
    ...(step.signs === null ? [] : ['signature']),
  ];
  const body = Type.Object({ ...stepEnvelope.properties, input: stepInputs[name] }, { ...closed, required });
  return route('POST', `/api/steps/${name}`, { body }, stepTaken);
}

export type RouteInput<R extends Route> = R['schema'] extends { params: infer P extends TSchema }
  ? [params: Static<P>]
  : R['schema'] extends { body: infer B extends TSchema }
    ? keyof Static<B> extends never
      ? []
      : [body: Static<B>]
    : [];
export type RouteReply<R extends Route> = Static<R['schema']['response'][200]>;
export type Reply<R extends Route> =
  | { kind: 'reply'; status: number; body: RouteReply<R> }
  | { kind: 'refused'; status: number; body: RefusalBody }
  | { kind: 'breach'; status: number; problem: string };

/** The path to request: the route's URL with each `:name` replaced by that param, encoded. */
export function pathOf(route: Route, request?: unknown): string {
  return route.url.replace(/:(\w+)/g, (_, name: string) =>
    encodeURIComponent(String(typeof request === 'object' && request !== null ? Reflect.get(request, name) : '')),
  );
}

/**
 * Reads a response against the route's contract, and never throws. A 2xx body that fits the reply schema is a reply,
 * any other body that fits RefusalBody is refused, and the rest are breaches that name the route, the path and the reason.
 */
export function readReply<R extends Route>(route: R, status: number, json: unknown): Reply<R> {
  const reply: R['schema']['response'][200] = route.schema.response[200];
  if (status >= 200 && status < 300)
    return Value.Check<R['schema']['response'][200]>(reply, json)
      ? { kind: 'reply', status, body: json }
      : breach(route, status, reply, json);
  return Value.Check(refusalBody, json)
    ? { kind: 'refused', status, body: json }
    : breach(route, status, refusalBody, json);
}

function breach(
  route: Route,
  status: number,
  schema: TSchema,
  json: unknown,
): { kind: 'breach'; status: number; problem: string } {
  const [first] = Value.Errors(schema, json);
  const where = first?.instancePath || '/';
  return {
    kind: 'breach',
    status,
    problem: `${route.method} ${route.url} answered ${status} outside its schema at ${where}: ${first?.message}`,
  };
}
