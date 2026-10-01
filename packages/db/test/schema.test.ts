import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { after, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CamelCasePlugin } from 'kysely';
import pg from 'pg';
import { camelCaseOptions, checkoutDatabase, databaseUrl, dbConfig } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();

const DATABASE = checkoutDatabase('lims_schema_test');
const SCRATCH = checkoutDatabase('lims_schema_scratch_test');
const packageDir = new URL('../', import.meta.url);

async function freshlyMigrated(database: string, folder?: URL): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
  } finally {
    await admin.end();
  }
  await migrate(server, database, folder);
}

class RoundTrip extends CamelCasePlugin {
  survives(name: string): boolean {
    return this.snakeCase(this.camelCase(name)) === name;
  }
}
const roundTrip = new RoundTrip(camelCaseOptions);

async function namesThatDoNotRoundTrip(database: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl(server, database) });
  await client.connect();
  try {
    const { rows } = await client.query<{ table: string; column: string | null }>(
      `select table_name as table, null as column from information_schema.tables where table_schema = 'lims'
       union all
       select table_name, column_name from information_schema.columns where table_schema = 'lims'
       order by 1, 2 nulls first`,
    );
    return rows.flatMap(({ table, column }) =>
      roundTrip.survives(column ?? table) ? [] : [column === null ? table : `${table}.${column}`],
    );
  } finally {
    await client.end();
  }
}

const copies: string[] = [];
after(() => Promise.all(copies.map((dir) => rm(dir, { recursive: true, force: true }))));

function verifySchemaTs(database: string): void {
  execFileSync('env', [`LIMS_DB=${database}`, 'pnpm', 'types', '--verify'], {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

async function migratedWithScratchTable(): Promise<void> {
  const dir = await mkdtemp(`${tmpdir()}/lims-migrations-`);
  copies.push(dir);
  await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
  const folder = pathToFileURL(`${dir}/`);
  await writeFile(new URL('9999_scratch.sql', folder), 'create table lims.scratch (limit_2 integer);\n');
  await freshlyMigrated(SCRATCH, folder);
}

it('schema.ts is what the types script generates from a freshly migrated database', async () => {
  await freshlyMigrated(DATABASE);
  try {
    verifySchemaTs(DATABASE);
  } catch (error) {
    throw new Error(
      'packages/db/src/schema.ts is not what the migrations generate. Run `pnpm --filter @lims/db types` and commit it.',
      { cause: error },
    );
  }
});

it("every lims table and column name survives CamelCasePlugin's round trip", async () => {
  await freshlyMigrated(DATABASE);
  const offenders = await namesThatDoNotRoundTrip(DATABASE);
  assert.deepEqual(offenders, [], `CamelCasePlugin would map ${offenders.join(', ')} to another name`);
});

it('the drift check fails when schema.ts lacks a table the migrations create', async () => {
  await migratedWithScratchTable();
  assert.throws(
    () => verifySchemaTs(SCRATCH),
    (error) => error instanceof Error && 'stderr' in error && String(error.stderr).includes('Scratch'),
  );
});

it('the round-trip check names a column CamelCasePlugin would map to another name', async () => {
  await migratedWithScratchTable();
  assert.deepEqual(await namesThatDoNotRoundTrip(SCRATCH), ['scratch.limit_2']);
});
