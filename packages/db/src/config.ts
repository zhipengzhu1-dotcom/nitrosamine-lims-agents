import { readFileSync } from 'node:fs';

export interface DbConfig {
  server: string;
  database: string;
  demoPassword: string | undefined;
}

const DB_SETTINGS = ['LIMS_PG', 'LIMS_DB'];

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

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let distance = b.length;
  for (let i = 0; i < a.length; i++) {
    let diagonal = i;
    distance = i + 1;
    const current = [distance];
    for (const [j, up] of previous.slice(1).entries()) {
      distance = Math.min(up + 1, distance + 1, diagonal + (a[i] === b[j] ? 0 : 1));
      current.push(distance);
      diagonal = up;
    }
    previous = current;
  }
  return distance;
}

function closest(name: string, known: readonly string[]): string {
  return known.reduce((best, candidate) =>
    editDistance(name, candidate) < editDistance(name, best) ? candidate : best,
  );
}

function refuseStrays(env: NodeJS.ProcessEnv, known: readonly string[]): void {
  const strays = Object.keys(env)
    .filter((name) => name.startsWith('LIMS_') && !known.includes(name))
    .sort();
  if (strays.length > 0)
    throw new Error(
      strays.map((name) => `${name} is not a LIMS setting; did you mean ${closest(name, known)}?`).join('\n'),
    );
}

/** The PostgreSQL server for a process that names no database, such as a test that creates its own: a LIMS_ variable that neither this nor `alsoReads` names, or a checkout with no PostgreSQL to reach, stops the process here. */
export function dbServer(alsoReads: readonly string[] = []): string {
  refuseStrays(process.env, [...DB_SETTINGS, ...alsoReads]);
  return process.env.LIMS_PG || checkoutServer();
}

/** Reads the environment once, at a process's start: everything `dbServer` refuses, or no LIMS_DB, stops the process here, so no process falls back to a database it did not name. */
export function dbConfig(alsoReads: readonly string[] = []): DbConfig {
  const server = dbServer(alsoReads);
  const { LIMS_DB: database, DEMO_PASSWORD: demoPassword } = process.env;
  if (!database) throw new Error('LIMS_DB is not set. Name the database this process uses, such as LIMS_DB=lims_dev.');
  return { server, database, demoPassword };
}

/** The seed's settings: `dbConfig` plus LIMS_PASSWORD_PEPPER, the API's hex pepper, given when the seeded accounts are to sign in under the decided login, which admits no hash made without it. */
export function seedConfig(): DbConfig & { passwordPepper: Buffer | undefined } {
  const config = dbConfig(['LIMS_PASSWORD_PEPPER']);
  const pepper = process.env.LIMS_PASSWORD_PEPPER;
  if (pepper !== undefined && !/^([0-9a-f]{2}){32,}$/i.test(pepper))
    throw new Error('LIMS_PASSWORD_PEPPER must hold the password pepper: at least 64 hex digits');
  return { ...config, passwordPepper: pepper === undefined ? undefined : Buffer.from(pepper, 'hex') };
}
