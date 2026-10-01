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
/**
 * A point in time. On the wire, and so in the web and the tests, it is an ISO 8601 UTC string. An API handler gives a
 * Date, which Fastify's serializer writes with toISOString; the codec's functions never run on a reply.
 */
const instant = Type.Codec(Type.String({ format: 'date-time' }))
  .Decode((iso) => new Date(iso))
  .Encode((at: Date) => at.toISOString());
const nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);
const closed = { additionalProperties: false } as const;

const actorContext = Type.Object({
  person: Type.Object({ id: uuid, username: Type.String(), displayName: Type.String(), customerId: nullable(uuid) }),
  lab: Type.Object({ id: uuid, code: Type.String(), name: Type.String() }),
  roles: Type.Array(role),
});
export type ActorContext = Static<typeof actorContext>;
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
const signature = Type.Object({
  meaning: meaning,
  signer: Type.String(),
  signedAt: instant,
  record: Type.String(),
  contentHash: Type.String(),
});
export type Signature = Static<typeof signature>;
/** An Audit Trail row snapshot, keyed by its stored column names. */
const rowSnapshot = Type.Record(Type.String(), Type.Unknown());
export type RowSnapshot = Static<typeof rowSnapshot>;
const auditEntry = Type.Object({
  seq: Type.String(),
  at: instant,
  actor: Type.String(),
  role: Type.String(),
  reason: Type.String(),
  table: Type.String(),
  op: Type.String(),
  oldRow: nullable(rowSnapshot),
  newRow: nullable(rowSnapshot),
});
export type AuditEntry = Static<typeof auditEntry>;
const reportRef = Type.Object({ number: Type.String() });
const testView = Type.Object({
  test: testRow,
  report: nullable(reportRef),
  result: nullable(result),
  signatures: Type.Array(signature),
  auditTrail: Type.Array(auditEntry),
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
/** When both hash chains were recomputed, and the seq of the first broken entry of each, or null when it holds. */
const auditTrailVerification = Type.Object({
  at: instant,
  lab: nullable(Type.String()),
  company: nullable(Type.String()),
});
const stepTaken = Type.Object({ testId: uuid, state: testState });
/** The body Fastify writes for every refusal `refuse()` throws and every request that fails validation. */
const refusalBody = Type.Object({ statusCode: Type.Integer(), error: Type.String(), message: Type.String() });

const credentials = Type.Object({ username: text, password: text }, closed);
const byId = Type.Object({ id: uuid });
const reauthentication = Type.Object({ password: text }, closed);
const stepEnvelope = Type.Object({ testId: Type.Optional(uuid), signature: Type.Optional(reauthentication) });
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
  response: { 200: TSchema; '4xx': typeof refusalBody };
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
  return { method, url, schema: { ...request, response: { 200: reply, '4xx': refusalBody } } };
}

/** Every route the API serves besides the steps. */
export const routes = {
  login: route('POST', '/api/login', { body: credentials }, actorContext),
  logout: route('POST', '/api/logout', {}, Type.Object({ ended: Type.Literal(true) })),
  me: route('GET', '/api/me', {}, actorContext),
  lookups: route('GET', '/api/lookups', {}, lookups),
  tests: route('GET', '/api/tests', {}, Type.Array(testRow)),
  test: route('GET', '/api/tests/:id', { params: byId }, testView),
  report: route('GET', '/api/tests/:id/report', { params: byId }, testReport),
  verifyAuditTrail: route('POST', '/api/audit/verify', {}, auditTrailVerification),
} satisfies Record<string, Route>;

/** The route of one step. Its body requires testId when the step starts from a state, and signature when it signs. */
export function stepRoute<K extends StepName>(name: K) {
  const step: Step = steps[name];
  const required = [...(step.from === null ? [] : ['testId']), 'input', ...(step.signs === null ? [] : ['signature'])];
  const body = Type.Object({ ...stepEnvelope.properties, input: stepInputs[name] }, { ...closed, required });
  return route('POST', `/api/steps/${name}`, { body }, stepTaken);
}

export type RouteInput<R extends Route> = R['schema'] extends { params: infer P extends TSchema }
  ? [params: Static<P>]
  : R['schema'] extends { body: infer B extends TSchema }
    ? [body: Static<B>]
    : [];
export type RouteReply<R extends Route> = Static<R['schema']['response'][200]>;
export type Reply<R extends Route> =
  | { kind: 'reply'; status: number; body: RouteReply<R> }
  | { kind: 'refused'; status: number; message: string }
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
    ? { kind: 'refused', status, message: json.message }
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
