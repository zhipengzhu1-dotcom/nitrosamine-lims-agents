import type { IncomingMessage, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import { createDb, type DB } from '@lims/db';
import type { ActorContext } from '@lims/domain';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyTypeProvider,
  type RawServerDefault,
} from 'fastify';
import type { Kysely } from 'kysely';
import type { Static, StaticDecode, TSchema } from 'typebox';
import { actorFor, loginRoutes, logoutRoute, SESSION_COOKIE } from './auth.ts';
import { readRoutes } from './reads.ts';
import { stepRoutes } from './steps.ts';

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext;
  }
}

/**
 * Types a request by its wire values and a handler's return by the decoded values, so a handler gives a Date where
 * the reply schema has an instant, and the response schema's serializer writes it as the wire value.
 */
interface WireTypes extends FastifyTypeProvider {
  validator: this['schema'] extends TSchema ? Static<this['schema']> : unknown;
  serializer: this['schema'] extends TSchema ? StaticDecode<this['schema']> : unknown;
}
export type App = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, FastifyBaseLogger, WireTypes>;

export function buildApp(db: Kysely<DB>): App {
  const app = Fastify({
    logger: process.env.LIMS_LOG === '1',
    ajv: { customOptions: { coerceTypes: false } },
  }).withTypeProvider<WireTypes>();
  app.register(cookie);
  loginRoutes(app, db);
  app.register(async (signedIn) => {
    signedIn.decorateRequest('actor');
    signedIn.addHook('onRequest', async (req) => {
      req.actor = await actorFor(db, req.cookies[SESSION_COOKIE]);
    });
    logoutRoute(signedIn, db);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
  });
  return app;
}

if (import.meta.main) {
  await buildApp(createDb()).listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
}
