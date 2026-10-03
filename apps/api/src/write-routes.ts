import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import type { Credentials } from './auth.ts';
import { changeRoutes } from './changes.ts';
import { stepRoutes } from './steps.ts';

/** Every route that writes a step: the Test steps and System Incident steps, then the Critical Data Change steps, which sign through the same credentials and release. */
export function writeRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  stepRoutes(app, db, credentials, release);
  changeRoutes(app, db, credentials, release);
}
