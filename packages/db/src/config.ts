import { readFileSync } from 'node:fs';

export interface DbConfig {
  server: string;
  database: string;
  demoPassword: string | undefined;
}

const PID_FILE = new URL('../../../.pg/data/postmaster.pid', import.meta.url);

// PostgreSQL keeps a running cluster's port on line 4 of postmaster.pid, and scripts/pg.sh reads the same line.
function checkoutServer(): string {
  try {
    return `postgres://postgres@localhost:${readFileSync(PID_FILE, 'utf8').split('\n')[3]}`;
  } catch (error) {
    throw new Error('This checkout has no PostgreSQL running. Run scripts/pg.sh start, or set LIMS_PG.', {
      cause: error,
    });
  }
}

/** Reads the environment once, at a process's start: a checkout with no PostgreSQL server to reach stops here. */
export function dbConfig(): DbConfig {
  const env = process.env;
  return { server: env.LIMS_PG || checkoutServer(), database: env.LIMS_DB ?? 'lims', demoPassword: env.DEMO_PASSWORD };
}
