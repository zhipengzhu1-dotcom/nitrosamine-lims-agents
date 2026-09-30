// Boot configuration, parsed once from the environment. The two secrets are read from files the
// operator owns (Compose secrets in production); they are never in the environment or the repo.

import { readFileSync } from 'node:fs';

export type Config = {
  readonly database: string;
  readonly port: number;
  /** The app release id, registered in lims.release at boot and stamped on every audit entry. */
  readonly release: string;
  readonly pepper: Buffer;
  /** AES-256-GCM key for TOTP secrets at rest. */
  readonly totpKey: Buffer;
};

function secret(path: string, bytes: number): Buffer {
  const raw = readFileSync(path);
  const trimmed = raw.subarray(0, raw.length - (raw.at(-1) === 0x0a ? 1 : 0));
  if (trimmed.length < bytes) throw new Error(`${path} must hold at least ${bytes} bytes`);
  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    database: need('LIMS_DATABASE'),
    port: Number(env['LIMS_PORT'] ?? 3000),
    release: need('LIMS_RELEASE'),
    pepper: secret(need('LIMS_PEPPER_FILE'), 32),
    totpKey: secret(need('LIMS_TOTP_KEY_FILE'), 32),
  };
}
