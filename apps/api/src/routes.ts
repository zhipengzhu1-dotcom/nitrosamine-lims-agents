import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, loginRoutes } from './auth.ts';
import { enrolmentRoute } from './enrolment.ts';
import { sessionRoutes } from './session-routes.ts';

/** Every route of the API: those before a session (sign-in, the Labs, a password set through a link, enrolment), then every route that needs one. */
export function apiRoutes(
  app: App,
  db: Kysely<DB>,
  options: { accessEventKey: Buffer; secureCookie: boolean; release: string },
  credentials: Credentials,
): void {
  loginRoutes(app, db, options.accessEventKey, options.secureCookie, credentials);
  enrolmentRoute(app, db, options.accessEventKey, credentials);
  sessionRoutes(app, db, credentials, options.release);
}
