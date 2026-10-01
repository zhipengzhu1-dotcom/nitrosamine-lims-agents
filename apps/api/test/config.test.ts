import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const UNREACHABLE = 'postgres://nobody@127.0.0.1:1';

function start(env: Record<string, string>) {
  return spawnSync(process.execPath, [api], {
    env: { LIMS_PG: UNREACHABLE, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

it('an empty PORT stops the API at start and names PORT', () => {
  const started = start({ PORT: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /PORT/);
});

it('a LIMS_ variable the API does not read stops it at start and names the closest setting', () => {
  const started = start({ LIMS_PGDATA: '/x' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.ok(
    started.stderr.includes('LIMS_PGDATA is not a LIMS setting; did you mean LIMS_PG?'),
    `stderr was: ${started.stderr}`,
  );
});

it('in production the API will not start without a log', () => {
  const started = start({ NODE_ENV: 'production' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /needs LIMS_LOG_FILE/);
});

it('LIMS_LOG_FILE is a setting the API reads', () => {
  const started = start({ LIMS_LOG_FILE: '/nonexistent/api.log', PORT: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.match(started.stderr, /PORT/);
  assert.doesNotMatch(started.stderr, /not a LIMS setting/);
});

it('LIMS_LOG is a setting the API reads', () => {
  const started = start({ LIMS_LOG: '1', PORT: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /PORT/);
  assert.doesNotMatch(started.stderr, /not a LIMS setting/);
});
