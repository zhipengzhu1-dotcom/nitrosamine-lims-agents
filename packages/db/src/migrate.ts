import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseUrl } from './db.ts';

const migrations = new URL('../migrations/', import.meta.url);

/** Creates the database if it is missing, then applies each migration not yet applied, as the superuser. */
export async function migrate(database: string): Promise<string[]> {
  const admin = new pg.Client({ connectionString: databaseUrl('postgres') });
  await admin.connect();
  try {
    // Runners on one cluster take turns, because the migrations create cluster-wide roles. An advisory lock belongs
    // to one database, so every runner takes it in `postgres`, under the same arbitrary key, until `admin` ends.
    await admin.query('select pg_advisory_lock(58)');
    const { rowCount } = await admin.query('select from pg_database where datname = $1', [database]);
    if (!rowCount) await admin.query(`create database ${pg.escapeIdentifier(database)}`);
    return await applyPending(database);
  } finally {
    await admin.end();
  }
}

async function applyPending(database: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  await client.connect();
  try {
    await client.query(
      'create table if not exists public.schema_migration (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('select name from public.schema_migration')).rows.map((r) => r.name),
    );
    const pending = (await readdir(migrations)).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
    for (const name of pending) {
      await client.query('begin');
      try {
        await client.query(await readFile(new URL(name, migrations), 'utf8'));
        await client.query('reset role');
        await client.query('insert into public.schema_migration (name) values ($1)', [name]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${name} failed`, { cause: error });
      }
    }
    return pending;
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const database = process.env.LIMS_DB ?? 'lims';
  if (process.argv.includes('--print-url')) console.log(databaseUrl(database));
  else console.log(`applied to ${database}:`, (await migrate(database)).join(', ') || 'nothing pending');
}
