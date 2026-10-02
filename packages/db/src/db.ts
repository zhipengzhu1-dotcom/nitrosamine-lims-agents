import { CamelCasePlugin, type CamelCasePluginOptions, Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.ts';

export type { DB };
export { checkoutDatabase } from './checkout.ts';
export { type DbConfig, dbConfig } from './config.ts';
export type { IncidentKind, IncidentState, Json, Meaning, Role, SignInFailure, TestState } from './schema.ts';

export function databaseUrl(server: string, database: string, user?: string): string {
  const url = new URL(server);
  url.pathname = `/${database}`;
  if (user) url.username = user;
  return url.href;
}

export const camelCaseOptions: Readonly<CamelCasePluginOptions> = { maintainNestedObjectKeys: true };

/** Speaks camelCase to TypeScript and returns jsonb as stored, so Audit Trail row snapshots keep their column names. */
export function createDb(url: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000 }) }),
    plugins: [new CamelCasePlugin(camelCaseOptions)],
  });
}

export interface PostgresFault {
  sqlstate: string;
  constraint: string | null;
  table: string | null;
  column: string | null;
}

/** The Postgres error in `error` or its causes, reduced to the names it carries: never its message, detail or hint, which can quote a record. */
export function postgresFault(error: unknown): PostgresFault | null {
  for (let e = error; e instanceof Error; e = e.cause)
    if (e instanceof pg.DatabaseError && e.code)
      return { sqlstate: e.code, constraint: e.constraint ?? null, table: e.table ?? null, column: e.column ?? null };
  return null;
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
