// Boot configuration, parsed once from the environment deploy/compose.yaml sets. The two keys are
// read from files the operator owns (Compose secrets); they are never in the environment or the repo.

import { readFileSync } from 'node:fs';

export type Config = {
  readonly database: string;
  readonly port: number;
  readonly host: string;
  /** The app release id, registered in lims.release at boot and stamped on every audit entry. */
  readonly release: string;
  readonly pepper: Buffer;
  /** AES-256-GCM key for TOTP secrets at rest. */
  readonly totpKey: Buffer;
  /** The report-store volume: True Copies and issued PDFs, content-addressed. */
  readonly reportStore: string;
};

// deploy/mac/secrets.sh writes each key as 32 random bytes in base64.
function key(path: string): Buffer {
  const decoded = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  if (decoded.length !== 32) throw new Error(`${path} must hold 32 bytes in base64`);
  return decoded;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    database: need('PGDATABASE'),
    port: Number(env['PORT'] ?? 3000),
    host: env['LIMS_LISTEN_HOST'] ?? '127.0.0.1',
    release: need('LIMS_RELEASE'),
    pepper: key(need('LIMS_PASSWORD_PEPPER_FILE')),
    totpKey: key(need('LIMS_TOTP_ENCRYPTION_KEY_FILE')),
    reportStore: need('LIMS_REPORT_STORE'),
  };
}
