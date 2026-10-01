import { readFileSync } from 'node:fs';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.ts';

export type { DB };
export type { Meaning, Role, TestState } from './schema.ts';

const PID_FILE = new URL('../../../.pg/data/postmaster.pid', import.meta.url);

// PostgreSQL keeps a running cluster's port on line 4 of postmaster.pid, and scripts/pg.sh reads the same line.
function serverUrl(): string {
  if (process.env.LIMS_PG) return process.env.LIMS_PG;
  try {
    return `postgres://postgres@localhost:${readFileSync(PID_FILE, 'utf8').split('\n')[3]}`;
  } catch (error) {
    throw new Error('This checkout has no PostgreSQL running. Run scripts/pg.sh start, or set LIMS_PG.', {
      cause: error,
    });
  }
}

export function databaseUrl(database = process.env.LIMS_DB ?? 'lims', user?: string): string {
  const url = new URL(serverUrl());
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
