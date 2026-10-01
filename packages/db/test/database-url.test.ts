import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { databaseUrl } from '../src/db.ts';

it('the shell scripts and the Node code use the same PostgreSQL server', () => {
  const pgScript = fileURLToPath(new URL('../../../scripts/pg.sh', import.meta.url));
  const server = execFileSync(pgScript, ['start'], { encoding: 'utf8' }).trim();
  assert.equal(databaseUrl('lims'), `${server}/lims`);
});
