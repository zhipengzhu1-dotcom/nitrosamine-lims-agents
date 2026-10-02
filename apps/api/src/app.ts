import type { DB } from '@lims/db';
import type { ActorContext, Instant } from '@lims/domain';
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
import { actorFor, loginRoutes, logoutRoute, SESSION_COOKIE, type SessionKey } from './auth.ts';
import { apiLogger, type LogSink } from './log.ts';
import { readRoutes } from './reads.ts';
import { answerThrown, refuse, requestReference } from './refuse.ts';
import { stepRoutes } from './steps.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
    requester: ActorContext | null;
    sessionKey: SessionKey;
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
  secureCookie: boolean;
  accessEventKey: Buffer;
  /** The proxies whose X-Forwarded-For names the source address of a request; none means the socket's peer is the source. */
  trustedProxies: string[];
}

export function buildApp(db: Kysely<DB>, options: AppOptions): App {
  const app = Fastify({
    logger: options.log ? apiLogger(options.log) : false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: true } },
    genReqId: requestReference,
    trustProxy: options.trustedProxies,
  }).withTypeProvider<WireTypes>();
  app.setErrorHandler(answerThrown(db));
  app.decorateRequest('requester', null);
  app.setNotFoundHandler(() => refuse('notFound', 'no such route'));
  loginRoutes(app, db, options.accessEventKey, options.secureCookie);
  app.register(async (signedIn) => {
    signedIn.decorateRequest('actor');
    signedIn.decorateRequest('sessionKey');
    signedIn.addHook('onRequest', async (req) => {
      ({ actor: req.actor, session: req.sessionKey } = await actorFor(db, req.cookies[SESSION_COOKIE]));
      req.requester = req.actor;
    });
    logoutRoute(signedIn, db);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
  });
  return app;
}
