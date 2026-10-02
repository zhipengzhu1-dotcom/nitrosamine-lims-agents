import type * as db from '@lims/db';
import { type Static, type TObject, type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';
import { type Step, type StepName, stepNames, steps } from './steps.ts';

const role = Type.Enum({
  Admin: 'Admin',
  Analyst: 'Analyst',
  Customer: 'Customer',
  LabManager: 'LabManager',
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
const calendarDate = Type.String({ format: 'date' });
declare const instantBrand: unique symbol;
/**
 * A point in time: on the wire, and so in the web and the tests, an ISO 8601 string the database clock produced, in
 * UTC unless the field says otherwise (`atLab` carries the Lab's offset). The API hands Fastify the Date that Kysely
 * returns, and Fastify writes it with toISOString.
 */
export type Instant = string & { readonly [instantBrand]: true };
export const instant = Type.Unsafe<Instant>(Type.String({ format: 'date-time' }));
const nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);
const closed = { additionalProperties: false } as const;

const actorContext = Type.Object({
  person: Type.Object({ id: uuid, username: Type.String(), displayName: Type.String(), customerId: nullable(uuid) }),
  lab: Type.Object({ id: uuid, code: Type.String(), name: Type.String() }),
  roles: Type.Array(role),
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
const signedIn = Type.Object({ ...actorContext.properties, session: sessionClock });
export type SignedInView = Static<typeof signedIn>;
const testRow = Type.Object({
  id: uuid,
  state: testState,
  gxpClass: Type.String(),
  sampleNumber: Type.String(),
  description: Type.String(),
  receivedAt: nullable(instant),
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
const signature = Type.Object({
  meaning: meaning,
  signer: Type.String(),
  signedAt: instant,
  record: Type.String(),
  recordVersion: recordVersionRef,
  /** True once the record has a Record Version later than the one this Signature was given on. */
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
  sample: 'sample',
  test: 'test',
  result: 'result',
  test_report: 'test_report',
  record_version: 'record_version',
  signature: 'signature',
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
/** A value as the panel shows it: a reference reads as the record's label at the entry's time and links to its trail. */
const shownValue = Type.Object({
  text: Type.String(),
  ref: nullable(Type.Object({ table: auditedTable, id: Type.String() })),
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
 * it; `atLab` is the same instant on the owning Lab's wall clock, ISO 8601 with the Lab's offset, and null on the
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
const reportRef = Type.Object({ id: uuid, number: Type.String() });
/** `recordVersion` is the Test's latest; null for a Customer before release, since a hash of unreleased content would let a guessed value be confirmed. */
const testView = Type.Object({
  test: testRow,
  recordVersion: nullable(recordVersionRef),
  report: nullable(reportRef),
  result: nullable(result),
  signatures: Type.Array(signature),
  next: nullable(Type.Enum(stepNames)),
});
const testReport = Type.Object({
  report: reportRef,
  test: testRow,
  result: nullable(result),
  signatures: Type.Array(signature),
});
const lookups = Type.Object({
  methods: Type.Array(Type.Object({ id: uuid, code: Type.String(), version: Type.String(), title: Type.String() })),
  analysts: Type.Array(Type.Object({ id: uuid, displayName: Type.String() })),
});
const chainVerification = Type.Object({
  chain: chainKind,
  lastEntry: seq,
  intactThrough: seq,
  firstFailure: nullable(seq),
  report: Type.String(),
});
export type ChainVerification = Static<typeof chainVerification>;
const auditTrailVerification = Type.Object({ at: instant, chains: Type.Array(chainVerification) });
export type AuditTrailVerification = Static<typeof auditTrailVerification>;
const stepTaken = Type.Object({ testId: uuid, state: testState });
/** What a committed step answers, and what a retry of the same press answers again. */
export type StepTaken = Static<typeof stepTaken>;
/**
 * Why the LIMS did not do what was asked, as one closed list the API, the web and the tests share. `unknownField` is
 * a body with a field its closed schema does not name, whatever else is wrong with it; `malformed` is any other
 * request Fastify refuses before the handler runs (a schema fault, unparseable JSON, a wrong media type, too large).
 * `badCredentials` is the one answer to every sign-in failure;
 * `accountLocked`, and `role` for an account with no Lab, come only after the right password. `noSession` covers no session presented and a session that
 * has ended. `stale` asks the person to reload; `state` says the step does not apply. `keyReused` is a Commit Key sent again
 * with a different step or input, or from another session. `notFound` also covers an
 * unknown route. `failure` is not a refusal but an unexpected failure, listed so that every non-2xx body has the one
 * shape below.
 */
export const refusalKinds = [
  'unknownField',
  'malformed',
  'badCredentials',
  'noSession',
  'accountLocked',
  'role',
  'guard',
  'state',
  'stale',
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

const credentials = Type.Object({ username: text, password: text }, closed);
/** A POST that takes nothing still declares a closed body, so that a field sent to it is refused like any other. */
const noBody = Type.Object({}, closed);
const byId = Type.Object({ id: uuid });
const reauthentication = Type.Object({ password: text }, closed);
const stepEnvelope = Type.Object({
  commitKey: uuid,
  testId: Type.Optional(uuid),
  signature: Type.Optional(reauthentication),
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
  login: route('POST', '/api/login', { body: credentials }, signedIn),
  logout: route('POST', '/api/logout', { body: noBody }, Type.Object({ ended: Type.Literal(true) })),
  me: route('GET', '/api/me', {}, signedIn),
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
} satisfies Record<string, Route>;

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
