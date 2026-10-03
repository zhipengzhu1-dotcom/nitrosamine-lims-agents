import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const UNREACHABLE = 'postgres://nobody@127.0.0.1:1';
const SECRETS = { LIMS_PASSWORD_PEPPER: 'cd'.repeat(32), LIMS_TOTP_KEY: 'ef'.repeat(32) };

function start(env: Record<string, string>) {
  return spawnSync(process.execPath, [api], {
    env: { LIMS_PG: UNREACHABLE, LIMS_DB: 'lims_unreachable', LIMS_RELEASE: 'config-test', ...SECRETS, ...env },
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

it('an empty LIMS_DB stops the API at start and names LIMS_DB', () => {
  const started = start({ LIMS_DB: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.ok(started.stderr.includes('LIMS_DB is not set'), `stderr was: ${started.stderr}`);
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
for (const [name, key] of [
  ['without an', undefined],
  ['with a short', 'ab'.repeat(31)],
  ['with a non-hex', 'zz'.repeat(32)],
] as const) {
  it(`the API ${name} Access Event HMAC key stops at start and names LIMS_ACCESS_EVENT_KEY`, () => {
    const started = start({ PORT: '3000', ...(key === undefined ? {} : { LIMS_ACCESS_EVENT_KEY: key }) });
    assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
    assert.notEqual(started.status, 0);
    assert.match(started.stderr, /LIMS_ACCESS_EVENT_KEY must hold the Access Event HMAC key/);
  });
}

for (const [setting, message] of [
  ['LIMS_PASSWORD_PEPPER', /LIMS_PASSWORD_PEPPER must hold the password pepper/],
  ['LIMS_TOTP_KEY', /LIMS_TOTP_KEY must hold the key that encrypts TOTP secrets/],
] as const) {
  it(`the API without ${setting}, a secret with no default, stops at start and names it`, () => {
    const started = start({ PORT: '3000', LIMS_ACCESS_EVENT_KEY: 'ab'.repeat(32), [setting]: '' });
    assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
    assert.notEqual(started.status, 0);
    assert.match(started.stderr, message);
  });
}

it('a TOTP key that is not an AES-256 key stops the API at start', () => {
  const started = start({ PORT: '3000', LIMS_ACCESS_EVENT_KEY: 'ab'.repeat(32), LIMS_TOTP_KEY: 'ef'.repeat(33) });
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /LIMS_TOTP_KEY must be exactly 64 hex digits/);
});

it('a LIMS_LOGIN other than decided or demo stops the API at start and names LIMS_LOGIN', () => {
  const started = start({ PORT: '3000', LIMS_ACCESS_EVENT_KEY: 'ab'.repeat(32), LIMS_LOGIN: 'strict' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /LIMS_LOGIN must be decided or demo, not "strict"/);
});

it('LIMS_LOG is a setting the API reads', () => {
  const started = start({ LIMS_LOG: '1', PORT: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /PORT/);
  assert.doesNotMatch(started.stderr, /not a LIMS setting/);
});

it('LIMS_TRUSTED_PROXIES is a setting the API reads', () => {
  const started = start({ LIMS_TRUSTED_PROXIES: '172.16.0.0/12', PORT: '' });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.match(started.stderr, /PORT/);
  assert.doesNotMatch(started.stderr, /not a LIMS setting/);
});

it('a missing LIMS_RELEASE stops the API at start, because every Signature records the app release', () => {
  const started = start({ LIMS_RELEASE: '', LIMS_ACCESS_EVENT_KEY: 'ab'.repeat(32) });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /LIMS_RELEASE/);
});

it('a trusted proxy that is not an address or range stops the API at start', () => {
  const started = start({ LIMS_TRUSTED_PROXIES: '172.16.0.0/12, caddy,', LIMS_ACCESS_EVENT_KEY: 'ab'.repeat(32) });
  assert.equal(started.signal, null, 'the API stopped by itself instead of listening');
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /invalid IP address: caddy/);
});
