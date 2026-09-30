import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connectionFor } from '../config.ts';
import { bootstrapRoles, migrate, schemaFingerprint } from '../migrate.ts';

const TEMPLATE_PREFIX = 'lims_tpl_';
const TEST_PREFIX = 'lims_test_';
const BUILD_LOCK = 7_240_001;

export async function templateName(): Promise<string> {
  return TEMPLATE_PREFIX + (await schemaFingerprint());
}

async function withMaintenance<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(connectionFor('postgres', 'postgres'));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Makes sure a migrated template database exists for the current migrations, building it once
 * under an advisory lock so concurrent suites share it. Templates for other fingerprints are
 * dropped. Returns the template's name.
 */
export async function ensureTemplate(): Promise<string> {
  await bootstrapRoles();
  const name = await templateName();
  return withMaintenance(async (c) => {
    await c.query('select pg_advisory_lock($1)', [BUILD_LOCK]);
    try {
      const stale = await c.query<{ datname: string }>(
        `select datname from pg_database where datname like $1 and datname <> $2`,
        [`${TEMPLATE_PREFIX}%`, name],
      );
      for (const { datname } of stale.rows) {
        await c.query(`alter database "${datname}" is_template false`);
        await c.query(`drop database "${datname}" with (force)`);
      }
      const ready = await c.query(`select 1 from pg_database where datname = $1 and datistemplate`, [name]);
      if (ready.rowCount === 1) return name;
      await c.query(`drop database if exists "${name}" with (force)`);
      await c.query(`create database "${name}" owner lims_owner`);
      await migrate(name);
      await c.query(`alter database "${name}" is_template true allow_connections false`);
      return name;
    } finally {
      await c.query('select pg_advisory_unlock($1)', [BUILD_LOCK]);
    }
  });
}

/** Clones the template into a fresh database and returns its name. */
export async function cloneTemplate(): Promise<string> {
  const name = TEST_PREFIX + randomUUID().replaceAll('-', '').slice(0, 12);
  const template = await templateName();
  await withMaintenance((c) => c.query(`create database "${name}" template "${template}" owner lims_owner`));
  return name;
}

export async function dropDatabase(name: string): Promise<void> {
  await withMaintenance((c) => c.query(`drop database if exists "${name}" with (force)`));
}

/** Drops every test database left behind by an interrupted run. */
export async function dropAllTestDatabases(): Promise<readonly string[]> {
  return withMaintenance(async (c) => {
    const rows = await c.query<{ datname: string }>(`select datname from pg_database where datname like $1`, [`${TEST_PREFIX}%`]);
    for (const { datname } of rows.rows) await c.query(`drop database "${datname}" with (force)`);
    return rows.rows.map((r) => r.datname);
  });
}
