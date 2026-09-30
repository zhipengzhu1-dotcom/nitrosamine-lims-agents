// pnpm --filter @lims/db migrate <database>
// Brings a local database on the scripts/pg.sh cluster to the current migrations: the roles, the
// database (created as lims_owner if missing), every unapplied migration. Idempotent.
import pg from 'pg';
import { connectionFor } from '../src/config.ts';
import { bootstrapRoles, migrate } from '../src/migrate.ts';

const database = process.argv[2];
if (!database) {
  console.error('usage: pnpm --filter @lims/db migrate <database>');
  process.exit(2);
}
await bootstrapRoles();
const client = new pg.Client(connectionFor('postgres', 'postgres'));
await client.connect();
try {
  const exists = await client.query('select 1 from pg_database where datname = $1', [database]);
  if (exists.rowCount === 0) await client.query(`create database "${database}" owner lims_owner`);
} finally {
  await client.end();
}
const applied = await migrate(database);
console.log(applied.length ? `applied ${applied.join(', ')}` : 'up to date');
