import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './generated.ts';
import { connectionFor, type DbRole } from './config.ts';

/** The one place a Kysely instance is built. The API builds exactly one, as lims_app. */
export function createDb(database: string, role: DbRole = 'lims_app', max = 10): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ ...connectionFor(role, database), max }) }) });
}
