import { databaseUrl, dbConfig } from '@lims/db';

export interface ApiConfig {
  databaseUrl: string;
  listen: { port: number; host: string };
  log: boolean;
  secureCookie: boolean;
}

function port(value: string | undefined): number {
  if (value === undefined) return 3000;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > 65_535)
    throw new Error(`PORT must be a TCP port from 1 to 65535, not ${JSON.stringify(value)}`);
  return n;
}

/** Reads the API's environment once, at start: a missing or malformed value stops the process here. */
export function apiConfig(env: Readonly<Record<string, string | undefined>> = process.env): ApiConfig {
  const { server, database } = dbConfig(env);
  return {
    databaseUrl: databaseUrl(server, database, 'lims_app'),
    listen: { port: port(env.PORT), host: env.HOST ?? '127.0.0.1' },
    log: env.LIMS_LOG === '1',
    secureCookie: env.NODE_ENV === 'production',
  };
}
