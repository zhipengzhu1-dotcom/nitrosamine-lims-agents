import { databaseUrl, dbConfig } from '@lims/db';

export interface ApiConfig {
  databaseUrl: string;
  listen: { port: number; host: string };
  log: boolean;
  secureCookie: boolean;
  accessEventKey: Buffer;
}

const API_SETTINGS = ['LIMS_LOG', 'LIMS_ACCESS_EVENT_KEY'];

function port(value: string | undefined): number {
  if (value === undefined) return 3000;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > 65_535)
    throw new Error(`PORT must be a TCP port from 1 to 65535, not ${JSON.stringify(value)}`);
  return n;
}

function accessEventKey(value: string | undefined): Buffer {
  if (value === undefined || !/^([0-9a-f]{2}){32,}$/i.test(value))
    throw new Error('LIMS_ACCESS_EVENT_KEY must hold the Access Event HMAC key: at least 64 hex digits, such as `openssl rand -hex 32` prints');
  return Buffer.from(value, 'hex');
}

/** Reads the API's environment once, at start: a missing or malformed value stops the process here. */
export function apiConfig(): ApiConfig {
  const env = process.env;
  const { server, database } = dbConfig(API_SETTINGS);
  return {
    databaseUrl: databaseUrl(server, database, 'lims_app'),
    listen: { port: port(env.PORT), host: env.HOST ?? '127.0.0.1' },
    log: env.LIMS_LOG === '1',
    secureCookie: env.NODE_ENV === 'production',
    accessEventKey: accessEventKey(env.LIMS_ACCESS_EVENT_KEY),
  };
}
