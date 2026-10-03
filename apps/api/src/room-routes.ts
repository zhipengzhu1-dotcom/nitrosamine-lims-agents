import type { DB } from '@lims/db';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import type { Credentials } from './auth.ts';
import { equipmentRoutes } from './equipment.ts';
import { workstationRoutes } from './workstations.ts';

/** The routes of the records that stand in one of the Lab's Rooms: its Workstations and its Equipment. */
export function roomRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  workstationRoutes(app, db);
  equipmentRoutes(app, db, credentials, release);
}
