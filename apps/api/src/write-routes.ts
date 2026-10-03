import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { auditExportRoutes } from './audit-export.ts';
import type { Credentials } from './auth.ts';
import { checklistRoutes } from './checklists.ts';
import { incidentRoutes } from './incident-steps.ts';
import { stepRoutes } from './steps.ts';

/**
 * Every route that writes a record on a person's press, signing through the same credentials and release: the Test
 * steps, the System Incident steps, the review checklists and the Audit Exports.
 */
export function writeRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  stepRoutes(app, db, credentials, release);
  incidentRoutes(app, db, credentials, release);
  checklistRoutes(app, db, credentials, release);
  auditExportRoutes(app, db);
}
