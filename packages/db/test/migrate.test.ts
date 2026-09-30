// A deployed stack runs migrate() on every start, so a second run on a migrated database must be
// a no-op, and a run after a new migration lands must apply just that one.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { connectionFor } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { dropDatabase } from '../src/testing/template.ts';

const name = `lims_test_migrate_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

beforeAll(async () => {
  const c = new pg.Client(connectionFor('postgres', 'postgres'));
  await c.connect();
  try {
    await c.query(`create database "${name}" owner lims_owner`);
  } finally {
    await c.end();
  }
});
afterAll(() => dropDatabase(name));

it('a second run applies nothing, and a run after a new migration applies just that one', async () => {
  const first = await migrate(name);
  expect(first.length).toBeGreaterThan(0);
  expect(await migrate(name)).toEqual([]);

  const extra = mkdtempSync(join(tmpdir(), 'lims-migration-'));
  writeFileSync(join(extra, '9999_extra.sql'), 'create table lims.extra_check (id int primary key);');
  expect(await migrate(name, [extra])).toEqual(['9999_extra.sql']);
  expect(await migrate(name, [extra])).toEqual([]);

  const c = new pg.Client(connectionFor('postgres', name));
  await c.connect();
  try {
    const owner = await c.query<{ owner: string }>(`select tableowner as owner from pg_tables where schemaname = 'lims' and tablename = 'extra_check'`);
    expect(owner.rows[0]?.owner).toBe('lims_owner');
  } finally {
    await c.end();
  }
});
