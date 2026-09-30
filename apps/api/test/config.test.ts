import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

// The files deploy/mac/secrets.sh writes: 32 random bytes, base64, with a trailing newline.
function secretsDir(bytes = 32): string {
  const dir = mkdtempSync(join(tmpdir(), 'lims-config-'));
  writeFileSync(join(dir, 'pepper'), `${randomBytes(bytes).toString('base64')}\n`, { mode: 0o600 });
  writeFileSync(join(dir, 'totp'), `${randomBytes(bytes).toString('base64')}\n`, { mode: 0o600 });
  writeFileSync(join(dir, 'commit-input'), `${randomBytes(bytes).toString('base64')}\n`, { mode: 0o600 });
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
    LIMS_COMMIT_INPUT_KEY_FILE: join(dir, 'commit-input'),
    LIMS_REPORT_STORE: '/var/lib/lims/reports',
  };
}

describe('loadConfig reads the runtime contract deploy/compose.yaml sets', () => {
  it('decodes the base64 secret files into 32-byte keys an AES-256 cipher accepts', () => {
    const config = loadConfig(deployEnv(secretsDir()));
    expect(config.totpKey.length).toBe(32);
    expect(config.pepper.length).toBe(32);
    expect(config.commitInputKey.length).toBe(32);
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

  it('is a fictional-data deployment unless LIMS_DATA_CLASS says otherwise', () => {
    expect(loadConfig(deployEnv(secretsDir())).dataClass).toBe('fictional');
    expect(loadConfig({ ...deployEnv(secretsDir()), LIMS_DATA_CLASS: 'fictional' }).dataClass).toBe('fictional');
  });

  it('refuses to start as real, since anchoring is not built (#34), and refuses an unknown class', () => {
    expect(() => loadConfig({ ...deployEnv(secretsDir()), LIMS_DATA_CLASS: 'real' })).toThrow(/anchoring/);
    expect(() => loadConfig({ ...deployEnv(secretsDir()), LIMS_DATA_CLASS: 'demo' })).toThrow(/fictional or real/);
  });
});

const repo = (path: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', path), 'utf8');

/** The key files loadConfig opens, by the environment variable that names each. */
function keyFilesRead(): string[] {
  const read = new Set<string>();
  const env = new Proxy(deployEnv(secretsDir()), { get: (t, k: string) => (read.add(k), t[k]) });
  loadConfig(env);
  return [...read].filter((k) => k.endsWith('_FILE'));
}

describe('every key file loadConfig reads is provided by the deploy and dev scripts', () => {
  const compose = repo('deploy/compose.yaml');
  const apiService = compose.slice(compose.indexOf('\n  api:\n'), compose.indexOf('\n  web:\n'));

  it.each(keyFilesRead())('%s', (variable) => {
    const secret = new RegExp(`^ +${variable}: /run/secrets/([a-z_]+)$`, 'm').exec(apiService)?.[1];
    expect(secret, `compose.yaml's api service sets ${variable} to a Compose secret`).toBeDefined();
    expect(apiService).toMatch(new RegExp(`^ +- ${secret}$`, 'm'));
    expect(compose).toContain(`  ${secret}: { file: "\${LIMS_SECRETS_DIR:?}/${secret}" }`);
    expect(repo('deploy/mac/secrets.sh'), 'secrets.sh generates it as a base64 key').toMatch(new RegExp(`^ +${secret}:base64$`, 'm'));
    expect(repo('deploy/mac/start.sh'), 'start.sh refuses to launch without it').toMatch(new RegExp(`^required=\\([^)]*\\b${secret}\\b`, 'm'));
    expect(repo('scripts/dev.sh'), 'dev.sh exports it').toMatch(new RegExp(`^export ${variable}=`, 'm'));
  });
});
