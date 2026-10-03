import type { DB } from '@lims/db';
import type { ActorContext, Instant, SignedInView } from '@lims/domain';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyTypeProvider,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Kysely } from 'kysely';
import type { Static, TSchema } from 'typebox';
import { type Credentials, endLapsedSessions, type SessionKey, type SessionLimits } from './auth.ts';
import { openJobIncident } from './incident.ts';
import { apiLogger, checkLogVolume, type LogSink, type LogVolume } from './log.ts';
import { answerThrown, refuse, requestReference } from './refuse.ts';
import { apiRoutes } from './routes.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
    requester: ActorContext | null;
    sessionKey: SessionKey;
    signedInView: SignedInView;
  }
}

type Sent<T> = T extends Instant
  ? T | Date
  : T extends readonly (infer E)[]
    ? Sent<E>[]
    : T extends object
      ? { [K in keyof T]: Sent<T[K]> }
      : T;
interface WireTypes extends FastifyTypeProvider {
  validator: this['schema'] extends TSchema ? Static<this['schema']> : unknown;
  serializer: this['schema'] extends TSchema ? Sent<Static<this['schema']>> : unknown;
}
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  WireTypes
>;

export interface AppOptions {
  log: LogSink | null;
  logVolume: LogVolume | null;
  secureCookie: boolean;
  accessEventKey: Buffer;
  /** The proxies whose X-Forwarded-For names the source address of a request; none means the socket's peer is the source. */
  trustedProxies: string[];
  /** The login policy, the password pepper and the TOTP secret key. */
  credentials: Credentials;
  /** The app release every Signature records. */
  release: string;
  /** How often to run the expiry sweep, or null for an API whose caller runs it. */
  sweepEveryMs: number | null;
  /** How long one chain's recompute may run before Verify chain refuses; the scope's defaults when absent. */
  verifyReadLimitSeconds?: number | undefined;
}

export function buildApp(db: Kysely<DB>, options: AppOptions): App {
  const { credentials } = options;
  const limits = credentials.policy;
  const app = Fastify({
    logger: options.log ? apiLogger(options.log) : false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: true } },
    genReqId: requestReference,
    trustProxy: options.trustedProxies,
  }).withTypeProvider<WireTypes>();
  app.setErrorHandler(answerThrown(db));
  app.decorateRequest('requester', null);
  app.setNotFoundHandler(() => refuse('notFound', 'The LIMS has no such route.'));
  if (options.logVolume) checkLogVolume(app, db, options.logVolume);
  apiRoutes(app, db, options, credentials);
  if (options.sweepEveryMs !== null) scheduleExpirySweep(app, db, limits, options.sweepEveryMs);
  return app;
}

/** Runs the expiry sweep every `everyMs` until the app closes; a sweep that fails opens a System Incident. */
export function scheduleExpirySweep(app: App, db: Kysely<DB>, limits: SessionLimits, everyMs: number): void {
  let running: Promise<void> | null = null;
  const sweep = setInterval(() => {
    running ??= endLapsedSessions(db, limits)
      .catch((err: Error) => openJobIncident(db, app.log, { reference: requestReference(), step: 'expirySweep' }, err))
      .finally(() => {
        running = null;
      });
  }, everyMs);
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    await running;
  });
}
