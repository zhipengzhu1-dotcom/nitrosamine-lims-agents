import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import type { Credentials } from './auth.ts';
import { documentRoutes } from './documents.ts';
import { incidentRoutes } from './incident-steps.ts';

/** The routes of the records signed outside the Test chain, System Incidents and Documents, with their reads. */
export function recordStepRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  incidentRoutes(app, db, credentials, release);
  documentRoutes(app, db, credentials, release);
}
