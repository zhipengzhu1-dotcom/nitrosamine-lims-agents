import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.ts';

export type { DB };

export function databaseUrl(database = process.env.LIMS_DB ?? 'lims', user?: string): string {
  const url = new URL(process.env.LIMS_PG ?? 'postgres://postgres@localhost:54339');
  url.pathname = `/${database}`;
  if (user) url.username = user;
  return url.href;
}

export function createDb(url = databaseUrl(undefined, 'lims_app')): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) }) });
}

export interface AuditContext {
  actor: string;
  role: string;
  reason: string;
}

/** The only write path: every write inside `fn` is captured in the Audit Trail under `ctx`. */
export function audited<T>(db: Kysely<DB>, ctx: AuditContext, fn: (tx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('lims.actor', ${ctx.actor}, true), set_config('lims.role', ${ctx.role}, true),
                     set_config('lims.reason', ${ctx.reason}, true)`.execute(tx);
    return fn(tx);
  });
}
