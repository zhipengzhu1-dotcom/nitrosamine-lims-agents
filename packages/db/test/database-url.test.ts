import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { databaseUrl, dbServer } from '../src/db.ts';

it('the shell scripts and the Node code use the same PostgreSQL server', () => {
  const pgScript = fileURLToPath(new URL('../../../scripts/pg.sh', import.meta.url));
  const printed = execFileSync(pgScript, ['start'], { encoding: 'utf8' }).trim();
  const server = dbServer();
  assert.equal(databaseUrl(server, 'lims'), `${printed}/lims`);
});
