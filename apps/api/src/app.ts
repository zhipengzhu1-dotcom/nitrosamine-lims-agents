import cookie from '@fastify/cookie';
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
  endExpiredSessions,
  type Login,
  loginRoutes,
  logoutRoute,
  SESSION_COOKIE,
  SESSION_LIMITS,
  type SessionKey,
} from './auth.ts';
import { readRoutes } from './reads.ts';
import { answerThrown, refuse, requestReference } from './refuse.ts';
import { stepRoutes } from './steps.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
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

export interface LogSink {
  write(line: string): void;
}
export interface AppOptions {
  log: LogSink | null;
  secureCookie: boolean;
  accessEventKey: Buffer;
  login: Login;
  /** How often to run the expiry sweep, or null for an API whose caller runs it. */
  sweepEveryMs: number | null;
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
  const limits = SESSION_LIMITS[options.login];
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
  loginRoutes(app, db, options.accessEventKey, limits);
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
    });
    logoutRoute(signedIn, db);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
  });
  if (options.sweepEveryMs !== null) {
    // A failed sweep is logged and the next one retries: each expiry is recorded at its computed end, so a late sweep
    // writes the same record. A tick skips while a sweep is still running, and close waits for it.
    let running: Promise<void> | null = null;
    const sweep = setInterval(() => {
      running ??= endExpiredSessions(db, limits)
        .catch((err: unknown) => app.log.error({ err }, 'expiry sweep failed'))
        .finally(() => {
          running = null;
        });
    }, options.sweepEveryMs);
    app.addHook('onClose', async () => {
      clearInterval(sweep);
      await running;
    });
  }
  return app;
}
