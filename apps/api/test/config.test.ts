import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

// The files deploy/mac/secrets.sh writes: 32 random bytes, base64, with a trailing newline.
function secretsDir(bytes = 32): string {
  const dir = mkdtempSync(join(tmpdir(), 'lims-config-'));
  writeFileSync(join(dir, 'pepper'), `${randomBytes(bytes).toString('base64')}\n`, { mode: 0o600 });
  writeFileSync(join(dir, 'totp'), `${randomBytes(bytes).toString('base64')}\n`, { mode: 0o600 });
  return dir;
}

function deployEnv(dir: string): NodeJS.ProcessEnv {
  return {
    PGDATABASE: 'lims',
    PORT: '3000',
    LIMS_LISTEN_HOST: '0.0.0.0',
    LIMS_RELEASE: 'r-test',
    LIMS_PASSWORD_PEPPER_FILE: join(dir, 'pepper'),
    LIMS_TOTP_ENCRYPTION_KEY_FILE: join(dir, 'totp'),
  };
}

describe('loadConfig reads the runtime contract deploy/compose.yaml sets', () => {
  it('decodes the base64 secret files into 32-byte keys an AES-256 cipher accepts', () => {
    const config = loadConfig(deployEnv(secretsDir()));
    expect(config.totpKey.length).toBe(32);
    expect(config.pepper.length).toBe(32);
    expect(config).toMatchObject({ database: 'lims', port: 3000, host: '0.0.0.0', release: 'r-test' });
  });

  it('refuses a key file that does not decode to 32 bytes', () => {
    expect(() => loadConfig(deployEnv(secretsDir(16)))).toThrow(/32 bytes/);
  });

  it('listens on loopback unless the deployment names a host', () => {
    const env = deployEnv(secretsDir());
    delete env['LIMS_LISTEN_HOST'];
    expect(loadConfig(env).host).toBe('127.0.0.1');
  });
});
