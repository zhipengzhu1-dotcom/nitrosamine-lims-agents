import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migrate = fileURLToPath(new URL('../src/migrate.ts', import.meta.url));

it('a LIMS_ variable migrate does not read stops it at start and names the closest setting', () => {
  const started = spawnSync(process.execPath, [migrate, '--print-url'], {
    env: { LIMS_PG: 'postgres://nobody@127.0.0.1:1', LIMS_PGDATA: '/x' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(started.signal, null);
  assert.notEqual(started.status, 0);
  assert.ok(
    started.stderr.includes('LIMS_PGDATA is not a LIMS setting; did you mean LIMS_PG?'),
    `stderr was: ${started.stderr}`,
  );
  assert.equal(started.stdout, '');
});
