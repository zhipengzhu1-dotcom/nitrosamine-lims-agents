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

it('migrate without LIMS_DB stops at start, names LIMS_DB and prints no database URL', () => {
  const started = spawnSync(process.execPath, [migrate, '--print-url'], {
    env: { LIMS_PG: 'postgres://nobody@127.0.0.1:1' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(started.status, 0);
  assert.ok(started.stderr.includes('LIMS_DB is not set'), `stderr was: ${started.stderr}`);
  assert.equal(started.stdout, '');
});

it('the types script without LIMS_DB stops before kysely-codegen starts and names LIMS_DB', () => {
  const started = spawnSync(
    'env',
    ['-u', 'LIMS_DB', 'LIMS_PG=postgres://nobody@127.0.0.1:1', 'pnpm', 'types', '--verify'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.notEqual(started.status, 0);
  assert.ok(started.stderr.includes('LIMS_DB is not set'), `stderr was: ${started.stderr}`);
  assert.ok(!started.stdout.includes("Using dialect 'postgres'"), `kysely-codegen started: ${started.stdout}`);
});
