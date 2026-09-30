import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { connectionFor } from './config.ts';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
const ROLES_SQL = new URL('../bootstrap/roles.sql', import.meta.url);

async function migrationFiles(): Promise<readonly { name: string; sql: string }[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(new URL(name, MIGRATIONS_DIR), 'utf8') })));
}

/** Creates the cluster roles if they are missing. Runs as a superuser, once per cluster. */
export async function bootstrapRoles(database = 'postgres'): Promise<void> {
  const client = new pg.Client(connectionFor('postgres', database));
  await client.connect();
  try {
    await client.query(await readFile(ROLES_SQL, 'utf8'));
  } finally {
    await client.end();
  }
}

/** A fingerprint of everything that shapes a migrated database; the test template is keyed by it. */
export async function schemaFingerprint(): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(ROLES_SQL, 'utf8'));
  for (const f of await migrationFiles()) {
    hash.update(f.name).update('\0').update(f.sql).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Applies the unapplied migrations in name order, each in its own transaction as lims_owner.
 * Returns the names applied. Safe to rerun: an applied migration is skipped.
 */
export async function migrate(database: string): Promise<readonly string[]> {
  const client = new pg.Client(connectionFor('lims_migrator', database));
  await client.connect();
  try {
    const ledger = await client.query<{ exists: boolean }>(`select to_regclass('lims.migration') is not null as exists`);
    const applied = new Set(
      ledger.rows[0]?.exists
        ? (await client.query<{ name: string }>('select name from lims.migration')).rows.map((r) => r.name)
        : [],
    );
    const done: string[] = [];
    for (const f of await migrationFiles()) {
      if (applied.has(f.name)) continue;
      await client.query('begin');
      try {
        await client.query('set local role lims_owner');
        await client.query(f.sql);
        await client.query('insert into lims.migration (name) values ($1)', [f.name]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${f.name} failed: ${(e as Error).message}`, { cause: e });
      }
      done.push(f.name);
    }
    return done;
  } finally {
    await client.end();
  }
}
