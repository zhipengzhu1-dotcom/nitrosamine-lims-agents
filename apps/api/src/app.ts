import cookie from '@fastify/cookie';
import { createDb, type DB } from '@lims/db';
import Fastify from 'fastify';
import type { Kysely } from 'kysely';
import { actorFor, loginRoutes, logoutRoute, SESSION_COOKIE } from './auth.ts';
import type { ActorContext } from './scope.ts';

declare module 'fastify' {
  interface FastifyRequest { actor: ActorContext }
}

export function buildApp(db: Kysely<DB>) {
  const app = Fastify({ logger: process.env.LIMS_LOG === '1', ajv: { customOptions: { coerceTypes: false } } });
  app.register(cookie);
  loginRoutes(app, db);
  app.register(async (signedIn) => {
    signedIn.decorateRequest('actor', null as unknown as ActorContext);
    signedIn.addHook('onRequest', async (req) => {
      req.actor = await actorFor(db, req.cookies[SESSION_COOKIE]);
    });
    logoutRoute(signedIn, db);
    signedIn.get('/api/me', async (req) => req.actor);
  });
  return app;
}

if (import.meta.main) {
  await buildApp(createDb()).listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
}
