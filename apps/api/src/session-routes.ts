import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { actorFor, labSwitchRoute, lockScreenRoutes, SESSION_COOKIE, type SessionLimits } from './auth.ts';
import { readRoutes } from './reads.ts';
import { stepRoutes } from './steps.ts';
import { workstationRoutes } from './workstations.ts';

/** Every route that needs a session. A locked session reaches only lock, unlock and sign-out; every other route answers sessionLocked. */
export function sessionRoutes(app: App, db: Kysely<DB>, limits: SessionLimits, release: string): void {
  const withSession = (whileLocked: boolean, routes: (scope: App) => void) =>
    app.register(async (scope) => {
      scope.decorateRequest('actor');
      scope.decorateRequest('sessionKey');
      scope.decorateRequest('sessionClock');
      scope.addHook('onRequest', async (req) => {
        ({
          actor: req.actor,
          session: req.sessionKey,
          clock: req.sessionClock,
        } = await actorFor(db, req.cookies[SESSION_COOKIE], limits, { whileLocked }));
        req.requester = req.actor;
      });
      routes(scope);
    });
  withSession(true, (lockScreen) => lockScreenRoutes(lockScreen, db, limits));
  withSession(false, (signedIn) => {
    labSwitchRoute(signedIn, db, limits);
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db, release);
    workstationRoutes(signedIn, db);
  });
}
