import type pg from 'pg';

/** The cluster from scripts/pg.sh, unless PGHOST/PGPORT say otherwise. Trust auth: no passwords. */
export function clusterConfig(): { host: string; port: number } {
  return {
    host: process.env['PGHOST'] ?? 'localhost',
    port: Number(process.env['PGPORT'] ?? 54329),
  };
}

export type DbRole = 'postgres' | 'lims_migrator' | 'lims_app';

export function connectionFor(role: DbRole, database: string): pg.ClientConfig {
  return { ...clusterConfig(), user: role, database };
}
