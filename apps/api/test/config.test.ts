import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../src/main.ts', import.meta.url));

it('an empty PORT stops the API at start and names PORT', () => {
  const started = spawnSync(process.execPath, [api], {
    env: { LIMS_PG: 'postgres://nobody@127.0.0.1:1', PORT: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /PORT/);
});
