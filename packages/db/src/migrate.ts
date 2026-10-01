import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseUrl } from './db.ts';

const migrations = new URL('../migrations/', import.meta.url);

/** A migration file as read from disk. `sha256` is the digest of the raw bytes, so a whitespace edit changes it. */
interface Migration {
  name: string;
  bytes: Buffer;
  sha256: Buffer;
}

/** A recorded migration. `sha256` is null only on a row written before hashes were kept, until migrate adopts it. */
interface Applied {
  name: string;
  sha256: Buffer | null;
}

// Each statement is a no-op where it has already run. A row hashed when applied gets hashed_at = applied_at, and a row
// adopted from before hashes were kept gets the adopting transaction's time, so hashed_at > applied_at marks it.
const TABLE = [
  'create table if not exists public.schema_migration (name text primary key, applied_at timestamptz not null default now())',
  'alter table public.schema_migration add column if not exists sha256 bytea check (octet_length(sha256) = 32)',
  'alter table public.schema_migration add column if not exists hashed_at timestamptz not null default now()',
];

const REFUSAL = [
  'alter table public.schema_migration alter column sha256 set not null',
  `create or replace function public.refuse_schema_migration_change() returns trigger
   language plpgsql as $$
   begin
     raise exception 'schema_migration rows are never changed or removed' using errcode = 'LA002';
   end $$`,
  `create or replace trigger refuse_change before update or delete on public.schema_migration
   for each row execute function public.refuse_schema_migration_change()`,
  `create or replace trigger refuse_truncate before truncate on public.schema_migration
   for each statement execute function public.refuse_schema_migration_change()`,
];

/**
 * Creates the database if it is missing, refuses before applying anything when an applied migration's file changed or
 * is gone, then applies each pending file as the superuser and records the SHA-256 of its bytes.
 */
export async function migrate(database: string, folder: URL = migrations): Promise<string[]> {
  const admin = new pg.Client({ connectionString: databaseUrl('postgres') });
  await admin.connect();
  try {
    // Runners on one cluster take turns, because the migrations create cluster-wide roles. An advisory lock belongs
    // to one database, so every runner takes it in `postgres`, under the same arbitrary key, until `admin` ends.
    await admin.query('select pg_advisory_lock(58)');
    const files = await readMigrations(folder);
    const { rowCount } = await admin.query('select from pg_database where datname = $1', [database]);
    if (!rowCount) await admin.query(`create database ${pg.escapeIdentifier(database)}`);
    return await applyPending(database, files);
  } finally {
    await admin.end();
  }
}

async function readMigrations(folder: URL): Promise<Migration[]> {
  const names = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(new URL(name, folder));
      return { name, bytes, sha256: createHash('sha256').update(bytes).digest() };
    }),
  );
}

/** One line for the person running migrate per applied migration whose file is gone or no longer hashes the same. */
function diverged(applied: Applied[], files: Map<string, Migration>): string[] {
  return applied.flatMap(({ name, sha256 }) => {
    const recorded = sha256 ? `recorded SHA-256 ${sha256.toString('hex')}` : 'applied before hashes were kept';
    const file = files.get(name);
    if (!file) return [`${name} was applied, but the file is missing (${recorded}).`];
    if (sha256 && !sha256.equals(file.sha256)) {
      return [`${name} changed after it was applied (${recorded}, file now ${file.sha256.toString('hex')}).`];
    }
    return [];
  });
}

async function applyPending(database: string, files: Migration[]): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  await client.connect();
  try {
    const byName = new Map(files.map((file) => [file.name, file]));
    await client.query('begin');
    for (const statement of TABLE) await client.query(statement);
    const applied = (await client.query<Applied>('select name, sha256 from public.schema_migration')).rows;
    const problems = diverged(applied, byName);
    if (problems.length > 0) {
      await client.query('rollback');
      throw new Error(
        `migrate refused to run on ${database}:\n  ${problems.join('\n  ')}\n` +
          'Migrations are forward-only. Restore the file and put the change in a new migration.',
      );
    }
    for (const { name } of applied.filter((row) => row.sha256 === null)) {
      await client.query('update public.schema_migration set sha256 = $2 where name = $1 and sha256 is null', [
        name,
        byName.get(name)?.sha256,
      ]);
    }
    for (const statement of REFUSAL) await client.query(statement);
    await client.query('commit');

    const done = new Set(applied.map((row) => row.name));
    const pending = files.filter((file) => !done.has(file.name));
    for (const { name, bytes, sha256 } of pending) {
      await client.query('begin');
      try {
        await client.query(bytes.toString('utf8'));
        await client.query('reset role');
        await client.query('insert into public.schema_migration (name, sha256) values ($1, $2)', [name, sha256]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${name} failed`, { cause: error });
      }
    }
    return pending.map((file) => file.name);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const database = process.env.LIMS_DB ?? 'lims';
  if (process.argv.includes('--print-url')) console.log(databaseUrl(database));
  else console.log(`applied to ${database}:`, (await migrate(database)).join(', ') || 'nothing pending');
}
