import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { databaseUrl, dbConfig } from '../src/db.ts';
import { migrate, runnerLock } from '../src/migrate.ts';

const { server } = dbConfig();

const repoMigrations = new URL('../migrations/', import.meta.url);
const migrations = await sqlFiles(repoMigrations);

async function sqlFiles(folder: URL): Promise<string[]> {
  return (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
}

async function asSuperuser<R extends pg.QueryResultRow>(
  database: string,
  statement: string,
  values: unknown[] = [],
): Promise<R[]> {
  const superuser = new pg.Client({ connectionString: databaseUrl(server, database) });
  await superuser.connect();
  try {
    return (await superuser.query<R>(statement, values)).rows;
  } finally {
    await superuser.end();
  }
}

async function recorded(database: string): Promise<string[]> {
  const rows = await asSuperuser<{ name: string }>(database, 'select name from public.schema_migration order by name');
  return rows.map((row) => row.name);
}

async function dropDatabase(database: string): Promise<void> {
  await asSuperuser('postgres', `drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
}

/** Starts one runner for each entry at the same moment, on databases that do not exist yet, and waits for them all. */
async function migrateAtOnce(databases: string[]): Promise<string[][]> {
  for (const database of new Set(databases)) await dropDatabase(database);
  const runners = databases.map((database) => migrate(server, database));
  await Promise.allSettled(runners);
  return Promise.all(runners);
}

describe('migration runners started at the same moment on one cluster', () => {
  it('each migrate their own new database', async () => {
    const databases = ['lims_migrate_1', 'lims_migrate_2', 'lims_migrate_3', 'lims_migrate_4'];
    const applied = await migrateAtOnce(databases);
    assert.deepEqual(
      applied,
      databases.map(() => migrations),
    );
    for (const database of databases) assert.deepEqual(await recorded(database), migrations);
  });

  it('apply each migration to a shared new database exactly once', async () => {
    const database = 'lims_migrate_shared';
    const applied = await migrateAtOnce([database, database, database, database]);
    assert.deepEqual(applied.flat().sort(), migrations);
    assert.deepEqual(await recorded(database), migrations);
  });
});

const copies: string[] = [];
after(() => Promise.all(copies.map((dir) => rm(dir, { recursive: true, force: true }))));

async function copyOfMigrations(): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'lims-migrations-'));
  copies.push(dir);
  await cp(repoMigrations, dir, { recursive: true });
  return pathToFileURL(`${dir}/`);
}

async function fresh(database: string, folder: URL): Promise<string[]> {
  await dropDatabase(database);
  return migrate(server, database, folder);
}

interface Hash {
  name: string;
  sha256: string;
}

async function hashesOnDisk(folder: URL): Promise<Hash[]> {
  return Promise.all(
    (await sqlFiles(folder)).map(async (name) => ({
      name,
      sha256: createHash('sha256')
        .update(await readFile(new URL(name, folder)))
        .digest('hex'),
    })),
  );
}

async function hashesRecorded(database: string): Promise<Hash[]> {
  return asSuperuser<Hash>(
    database,
    `select name, encode(sha256, 'hex') as sha256 from public.schema_migration order by name`,
  );
}

async function whenHashed(database: string): Promise<string[]> {
  const rows = await asSuperuser<{ hashed: string }>(
    database,
    `select case when hashed_at = applied_at then 'when applied' when hashed_at > applied_at then 'later' end as hashed
       from public.schema_migration order by name`,
  );
  return rows.map((row) => row.hashed);
}

async function migrateWithoutHashes(database: string, folder: URL): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query('select pg_advisory_lock($1)', [runnerLock]);
    await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
    await admin.query(`create database ${pg.escapeIdentifier(database)}`);
    const client = new pg.Client({ connectionString: databaseUrl(server, database) });
    await client.connect();
    try {
      await client.query(
        'create table public.schema_migration (name text primary key, applied_at timestamptz not null default now())',
      );
      for (const name of await sqlFiles(folder)) {
        await client.query('begin');
        await client.query(await readFile(new URL(name, folder), 'utf8'));
        await client.query('reset role');
        await client.query('insert into public.schema_migration (name) values ($1)', [name]);
        await client.query('commit');
      }
    } finally {
      await client.end();
    }
  } finally {
    await admin.end();
  }
}

function refusedWith(code: string) {
  return (error: unknown) => error instanceof Error && 'code' in error && error.code === code;
}

const probe = 'create table public.probe (id integer);\n';

describe('the SHA-256 of each applied migration', () => {
  it('migrate records the SHA-256 of each file as it applies it', async () => {
    const folder = await copyOfMigrations();
    const database = 'lims_migrate_hashes';
    assert.deepEqual(await fresh(database, folder), migrations);
    assert.deepEqual(await hashesRecorded(database), await hashesOnDisk(folder));
    assert.deepEqual(
      await whenHashed(database),
      migrations.map(() => 'when applied'),
    );
  });

  it('migrate refuses a migration whose applied file gained one space, names the file and applies nothing', async () => {
    const folder = await copyOfMigrations();
    const database = 'lims_migrate_edited';
    await fresh(database, folder);
    const before = await hashesRecorded(database);
    await appendFile(new URL('0002_audit_trail.sql', folder), ' ');
    await writeFile(new URL('9999_probe.sql', folder), probe);
    const recordedHash = before.find((row) => row.name === '0002_audit_trail.sql')?.sha256 ?? '';
    const currentHash = (await hashesOnDisk(folder)).find((row) => row.name === '0002_audit_trail.sql')?.sha256 ?? '';
    assert.match(recordedHash, /^[0-9a-f]{64}$/);
    assert.notEqual(recordedHash, currentHash);

    await assert.rejects(migrate(server, database, folder), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /0002_audit_trail\.sql/);
      assert.ok(error.message.includes(recordedHash), 'the refusal shows the recorded SHA-256');
      assert.ok(error.message.includes(currentHash), "the refusal shows the file's current SHA-256");
      return true;
    });
    const [table] = await asSuperuser<{ probe: string | null }>(
      database,
      `select to_regclass('public.probe')::text as probe`,
    );
    assert.deepEqual(table, { probe: null });
    assert.deepEqual(await hashesRecorded(database), before);
  });

  it('migrate reruns an unchanged set without applying anything, then applies only a newly added file', async () => {
    const folder = await copyOfMigrations();
    const database = 'lims_migrate_rerun';
    await fresh(database, folder);
    assert.deepEqual(await migrate(server, database, folder), []);
    await writeFile(new URL('9999_probe.sql', folder), probe);
    assert.deepEqual(await migrate(server, database, folder), ['9999_probe.sql']);
    assert.deepEqual(await recorded(database), [...migrations, '9999_probe.sql']);
  });

  it('migrate refuses when the file of an applied migration is missing, and names it', async () => {
    const folder = await copyOfMigrations();
    const database = 'lims_migrate_missing';
    await fresh(database, folder);
    await rm(new URL('0003_sample_chain.sql', folder));
    await assert.rejects(migrate(server, database, folder), /0003_sample_chain\.sql/);
  });

  it('migrate records the hash of the file on disk for a migration applied before hashes were kept', async () => {
    const folder = await copyOfMigrations();
    const database = 'lims_migrate_legacy';
    await migrateWithoutHashes(database, folder);
    assert.deepEqual(await migrate(server, database, folder), []);
    assert.deepEqual(await hashesRecorded(database), await hashesOnDisk(folder));
    assert.deepEqual(
      await whenHashed(database),
      migrations.map(() => 'later'),
    );

    await appendFile(new URL('0001_roles.sql', folder), ' ');
    await assert.rejects(migrate(server, database, folder), /0001_roles\.sql/);
  });

  it('the database refuses to update, delete or truncate a recorded migration', async () => {
    const database = 'lims_migrate_refusal';
    await fresh(database, await copyOfMigrations());
    const superuser = new pg.Client({ connectionString: databaseUrl(server, database) });
    await superuser.connect();
    try {
      await assert.rejects(
        superuser.query('update public.schema_migration set sha256 = $1 where name = $2', [
          Buffer.alloc(32),
          '0001_roles.sql',
        ]),
        refusedWith('LA002'),
      );
      await assert.rejects(
        superuser.query('delete from public.schema_migration where name = $1', ['0001_roles.sql']),
        refusedWith('LA002'),
      );
      await assert.rejects(superuser.query('truncate public.schema_migration'), refusedWith('LA002'));
    } finally {
      await superuser.end();
    }
    assert.deepEqual(await recorded(database), migrations);
  });

  it('the database refuses a recorded migration without a 32-byte hash', async () => {
    const database = 'lims_migrate_unhashed';
    await fresh(database, await copyOfMigrations());
    await assert.rejects(
      asSuperuser(database, 'insert into public.schema_migration (name) values ($1)', ['9999_unhashed.sql']),
      refusedWith('23502'),
    );
    await assert.rejects(
      asSuperuser(database, 'insert into public.schema_migration (name, sha256) values ($1, $2)', [
        '9999_short.sql',
        Buffer.from([1, 2, 3]),
      ]),
      refusedWith('23514'),
    );
  });
});
