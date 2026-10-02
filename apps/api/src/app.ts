import type { DB } from '@lims/db';
import type { ActorContext, Instant, SessionClock } from '@lims/domain';
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
import {
  actorFor,
  type Login,
  loginRoutes,
  logoutRoute,
  scheduleExpirySweep,
  SESSION_COOKIE,
  SESSION_LIMITS,
  type SessionKey,
} from './auth.ts';
import { apiLogger, checkLogVolume, type LogSink, type LogVolume } from './log.ts';
import { readRoutes } from './reads.ts';
import { answerThrown, refuse, requestReference } from './refuse.ts';
import { stepRoutes } from './steps.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
    requester: ActorContext | null;
    sessionKey: SessionKey;
    sessionClock: SessionClock;
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
  login: Login;
  /** How often to run the expiry sweep, or null for an API whose caller runs it. */
  sweepEveryMs: number | null;
}

export function buildApp(db: Kysely<DB>, options: AppOptions): App {
  const limits = SESSION_LIMITS[options.login];
  const app = Fastify({
    logger: options.log ? apiLogger(options.log) : false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: true } },
    genReqId: requestReference,
    trustProxy: options.trustedProxies,
  }).withTypeProvider<WireTypes>();
  app.setErrorHandler(answerThrown(db));
  app.decorateRequest('requester', null);
  app.setNotFoundHandler(() => refuse('notFound', 'no such route'));
  if (options.logVolume) checkLogVolume(app, db, options.logVolume);
  loginRoutes(app, db, options.accessEventKey, options.secureCookie, limits);
  app.register(async (signedIn) => {
    signedIn.decorateRequest('actor');
    signedIn.decorateRequest('sessionKey');
    signedIn.decorateRequest('sessionClock');
    signedIn.addHook('onRequest', async (req) => {
      ({
        actor: req.actor,
        session: req.sessionKey,
        clock: req.sessionClock,
      } = await actorFor(db, req.cookies[SESSION_COOKIE], limits));
      req.requester = req.actor;
    });
    logoutRoute(signedIn, db, limits);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
  });
  if (options.sweepEveryMs !== null) scheduleExpirySweep(app, db, limits, options.sweepEveryMs);
  return app;
}
