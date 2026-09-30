// The compose `db-init` job. Brings a cluster to the state the API expects: the roles from
// packages/db's runner, passwords on the two login roles, the database, every migration applied.
// Idempotent, so it runs before the API on every start.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type Pg from 'pg';
import { connectionFor } from '../../packages/db/src/config.ts';
import { bootstrapRoles, migrate } from '../../packages/db/src/migrate.ts';

// The pg that packages/db resolves, so the job and the runner share one driver.
const pg = createRequire(new URL('../../packages/db/package.json', import.meta.url))('pg') as typeof Pg;

const LOGIN_ROLES = [
  { role: 'lims_migrator', secret: 'db_migrator_password' },
  { role: 'lims_app', secret: 'db_app_password' },
] as const;

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password. Sending the verifier instead of the
 * password keeps the plaintext out of the server's statement and audit logs. The passwords are
 * generated hex, so SASLprep has nothing to normalise.
 */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const storedKey = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function secret(name: string): Promise<string> {
  return (await readFile(`/run/secrets/${name}`, 'utf8')).trim();
}

async function init(database: string): Promise<readonly string[]> {
  await bootstrapRoles();
  const admin = new pg.Client(connectionFor('postgres', 'postgres'));
  await admin.connect();
  try {
    for (const { role, secret: name } of LOGIN_ROLES) {
      await admin.query(`alter role ${role} password ${admin.escapeLiteral(scramVerifier(await secret(name)))}`);
    }
    const exists = await admin.query('select 1 from pg_database where datname = $1', [database]);
    if (exists.rowCount === 0) await admin.query(`create database ${admin.escapeIdentifier(database)} owner lims_owner`);
  } finally {
    await admin.end();
  }
  return migrate(database);
}

if (import.meta.main) {
  const database = process.env['PGDATABASE'] ?? 'lims';
  const applied = await init(database);
  console.log(`db-init: ${database} ready; applied ${applied.length === 0 ? 'nothing new' : applied.join(', ')}`);
}
