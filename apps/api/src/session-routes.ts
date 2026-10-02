import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { actorFor, lockRoutes, logoutRoute, SESSION_COOKIE } from './auth.ts';
import { readRoutes } from './reads.ts';
import { stepRoutes } from './steps.ts';
import { workstationRoutes } from './workstations.ts';

/** Every route that needs a session. A locked session reaches only lock, unlock and sign-out; every other route answers sessionLocked. */
export function sessionRoutes(app: App, db: Kysely<DB>): void {
  const withSession = (whileLocked: boolean, routes: (scope: App) => void) =>
    app.register(async (scope) => {
      scope.decorateRequest('actor');
      scope.decorateRequest('sessionKey');
      scope.addHook('onRequest', async (req) => {
        ({ actor: req.actor, session: req.sessionKey } = await actorFor(db, req.cookies[SESSION_COOKIE], {
          whileLocked,
        }));
        req.requester = req.actor;
      });
      routes(scope);
    });
  withSession(true, (lockScreen) => {
    lockRoutes(lockScreen, db);
    logoutRoute(lockScreen, db);
  });
  withSession(false, (signedIn) => {
    readRoutes(signedIn, db);
    stepRoutes(signedIn, db);
    workstationRoutes(signedIn, db);
  });
}
