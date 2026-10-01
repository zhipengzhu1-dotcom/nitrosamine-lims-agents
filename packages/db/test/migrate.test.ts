import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { describe, it } from 'node:test';
import pg from 'pg';
import { databaseUrl } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();

async function asSuperuser(database: string, statement: string): Promise<{ name: string }[]> {
  const superuser = new pg.Client({ connectionString: databaseUrl(database) });
  await superuser.connect();
  try {
    return (await superuser.query<{ name: string }>(statement)).rows;
  } finally {
    await superuser.end();
  }
}

async function recorded(database: string): Promise<string[]> {
  return (await asSuperuser(database, 'select name from public.schema_migration order by name')).map((row) => row.name);
}

/** Starts one runner for each entry at the same moment, on databases that do not exist yet, and waits for them all. */
async function migrateAtOnce(databases: string[]): Promise<string[][]> {
  for (const database of new Set(databases)) {
    await asSuperuser('postgres', `drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
  }
  const runners = databases.map((database) => migrate(database));
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
