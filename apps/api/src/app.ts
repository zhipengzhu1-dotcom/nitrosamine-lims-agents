import cookie from '@fastify/cookie';
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
import { actorFor, loginRoutes, logoutRoute, SESSION_COOKIE } from './auth.ts';
import { readRoutes } from './reads.ts';
import { answerThrown, refuse, requestReference } from './refuse.ts';
import { stepRoutes } from './steps.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
    sessionId: string;
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

export interface LogSink {
  write(line: string): void;
}
export interface AppOptions {
  log: LogSink | null;
  secureCookie: boolean;
}

const REDACTED = [
  'req.body',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  '*.*.password',
  // The err serializer copies pg's own fields onto the line, and detail quotes the failing row.
  'err.detail',
  'err.hint',
  'err.where',
  'err.internalQuery',
];

export function buildApp(db: Kysely<DB>, options: AppOptions): App {
  const app = Fastify({
    logger: options.log
      ? { level: 'info', stream: options.log, redact: { paths: REDACTED, censor: '[redacted]' } }
      : false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: true } },
    genReqId: requestReference,
  }).withTypeProvider<WireTypes>();
  app.setErrorHandler(answerThrown);
  app.setNotFoundHandler(() => refuse('notFound', 'no such route'));
  app.register(cookie, {
    parseOptions: { path: '/', httpOnly: true, sameSite: 'strict', secure: options.secureCookie },
  });
  loginRoutes(app, db);
  app.register(async (signedIn) => {
    signedIn.decorateRequest('actor');
    signedIn.decorateRequest('sessionId', '');
    signedIn.addHook('onRequest', async (req) => {
      ({ actor: req.actor, sessionId: req.sessionId } = await actorFor(db, req.cookies[SESSION_COOKIE]));
    });
    logoutRoute(signedIn, db);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
  });
  return app;
}
