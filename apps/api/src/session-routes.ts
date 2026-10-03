import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { actorFor, labSwitchRoute, lockScreenRoutes, SESSION_COOKIE, type Credentials } from './auth.ts';
import { passwordChangeRoute } from './password-change.ts';
import { preferenceRoutes } from './preferences.ts';
import { readRoutes } from './reads.ts';
import { roomRoutes } from './room-routes.ts';
import { staffRoutes } from './staff.ts';
import { writeRoutes } from './write-routes.ts';

/** Every route that needs a session. A locked session reaches only lock, unlock and sign-out; every other route answers sessionLocked. */
export function sessionRoutes(
  app: App,
  db: Kysely<DB>,
  credentials: Credentials,
  release: string,
  verifyReadLimitSeconds?: number,
): void {
  const limits = credentials.policy;
  const withSession = (whileLocked: boolean, routes: (scope: App) => void) =>
    app.register(async (scope) => {
      scope.decorateRequest('actor');
      scope.decorateRequest('sessionKey');
      scope.decorateRequest('signedInView');
      scope.addHook('onRequest', async (req) => {
        ({
          actor: req.actor,
          session: req.sessionKey,
          view: req.signedInView,
        } = await actorFor(db, req.cookies[SESSION_COOKIE], limits, { whileLocked }));
        req.requester = req.actor;
      });
      routes(scope);
    });
  withSession(true, (lockScreen) => lockScreenRoutes(lockScreen, db, credentials));
  withSession(false, (signedIn) => {
    labSwitchRoute(signedIn, db, credentials);
    passwordChangeRoute(signedIn, db, credentials);
    preferenceRoutes(signedIn, db);
    readRoutes(signedIn, db, verifyReadLimitSeconds);
    staffRoutes(signedIn, db, limits);
    writeRoutes(signedIn, db, credentials, release);
    roomRoutes(signedIn, db, credentials, release);
  });
}
