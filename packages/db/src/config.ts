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

function refuseStrays(known: readonly string[]): void {
  const strays = Object.keys(process.env)
    .filter((name) => name.startsWith('LIMS_') && !known.includes(name))
    .sort();
  if (strays.length > 0)
    throw new Error(
      strays.map((name) => `${name} is not a LIMS setting; did you mean ${closest(name, known)}?`).join('\n'),
    );
}

/** Reads the environment once, at a process's start: a LIMS_ variable that neither this nor `alsoReads` names, or a checkout with no PostgreSQL to reach, stops the process here. */
export function dbConfig(alsoReads: readonly string[] = []): DbConfig {
  refuseStrays([...DB_SETTINGS, ...alsoReads]);
  const env = process.env;
  return { server: env.LIMS_PG || checkoutServer(), database: env.LIMS_DB ?? 'lims', demoPassword: env.DEMO_PASSWORD };
}
