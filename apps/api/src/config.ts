import { databaseUrl, dbConfig } from '@lims/db';
import type { Login } from './auth.ts';

/** How often the API runs the expiry sweep. */
export const SWEEP_EVERY_MS = 60_000;

export interface ApiConfig {
  databaseUrl: string;
  listen: { port: number; host: string };
  log: boolean;
  logFile: string | null;
  secureCookie: boolean;
  accessEventKey: Buffer;
  passwordPepper: Buffer;
  totpKey: Buffer;
  trustedProxies: string[];
  login: Login;
  release: string;
}

const API_SETTINGS = [
  'LIMS_LOG',
  'LIMS_LOG_FILE',
  'LIMS_ACCESS_EVENT_KEY',
  'LIMS_PASSWORD_PEPPER',
  'LIMS_TOTP_KEY',
  'LIMS_TRUSTED_PROXIES',
  'LIMS_LOGIN',
  'LIMS_RELEASE',
];

function port(value: string | undefined): number {
  if (value === undefined) return 3000;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > 65_535)
    throw new Error(`PORT must be a TCP port from 1 to 65535, not ${JSON.stringify(value)}`);
  return n;
}

/** A secret of 32 bytes or more, given as hex, that the API needs and has no default for. */
function secret(name: string, value: string | undefined, what: string): Buffer {
  if (value === undefined || !/^([0-9a-f]{2}){32,}$/i.test(value))
    throw new Error(`${name} must hold ${what}: at least 64 hex digits, such as \`openssl rand -hex 32\` prints`);
  return Buffer.from(value, 'hex');
}

function totpKey(value: string | undefined): Buffer {
  const key = secret('LIMS_TOTP_KEY', value, 'the key that encrypts TOTP secrets');
  if (key.length !== 32) throw new Error('LIMS_TOTP_KEY must be exactly 64 hex digits: an AES-256 key');
  return key;
}

function login(value: string | undefined): Login {
  if (value === undefined) return 'demo';
  if (value === 'demo' || value === 'decided') return value;
  throw new Error(`LIMS_LOGIN must be decided or demo, not ${JSON.stringify(value)}`);
}

function release(value: string | undefined): string {
  if (value) return value;
  throw new Error('The API needs LIMS_RELEASE: every Signature records the app release');
}

/** Reads the API's environment once, at start: a missing or malformed value stops the process here. */
export function apiConfig(): ApiConfig {
  const env = process.env;
  const { server, database } = dbConfig(API_SETTINGS);
  const log = env.LIMS_LOG === '1';
  const logFile = env.LIMS_LOG_FILE || null;
  const secureCookie = env.NODE_ENV === 'production';
  if (secureCookie && !log && !logFile)
    throw new Error(
      'In production the API needs LIMS_LOG_FILE: its log is the only witness of an unwritten System Incident',
    );
  return {
    databaseUrl: databaseUrl(server, database, 'lims_app'),
    listen: { port: port(env.PORT), host: env.HOST ?? '127.0.0.1' },
    log,
    logFile,
    secureCookie,
    accessEventKey: secret('LIMS_ACCESS_EVENT_KEY', env.LIMS_ACCESS_EVENT_KEY, 'the Access Event HMAC key'),
    trustedProxies: (env.LIMS_TRUSTED_PROXIES ?? '')
      .split(',')
      .map((proxy) => proxy.trim())
      .filter(Boolean),
    login: login(env.LIMS_LOGIN),
    release: release(env.LIMS_RELEASE),
    passwordPepper: secret('LIMS_PASSWORD_PEPPER', env.LIMS_PASSWORD_PEPPER, 'the password pepper'),
    totpKey: totpKey(env.LIMS_TOTP_KEY),
  };
}
