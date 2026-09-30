// TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step) with the secret encrypted at rest under
// AES-256-GCM. The code is judged at the database clock, never at Date.now(). Which step a code
// belongs to is what the database accepts once per person (totp_step_used).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

export const TOTP_PERIOD_SECONDS = 30;

const totp = (secretBase32: string, label: string) =>
  new TOTP({ issuer: 'Nitrosamine LIMS', label, algorithm: 'SHA1', digits: 6, period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32) });

export const newTotpSecret = (): string => new Secret({ size: 20 }).base32;

/** The otpauth:// URI the person scans. It is the only response that ever carries a secret, and it goes to the enrolling person alone. */
export const otpauthUri = (secretBase32: string, username: string): string => totp(secretBase32, username).toString();

export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);

/** The step the code belongs to when it is one of the three valid at `at`, else null. */
export function matchTotp(secretBase32: string, token: string, at: Date): number | null {
  const delta = totp(secretBase32, '').validate({ token, timestamp: at.getTime(), window: 1 });
  return delta === null ? null : totpStep(at) + delta;
}

/** For the seed script and tests, which act as a person's authenticator app. */
export const totpCode = (secretBase32: string, at: Date, stepOffset = 0): string =>
  totp(secretBase32, '').generate({ timestamp: at.getTime() + stepOffset * TOTP_PERIOD_SECONDS * 1000 });

export function encryptSecret(key: Buffer, secretBase32: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptSecret(key: Buffer, stored: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(0, 12));
  decipher.setAuthTag(stored.subarray(12, 28));
  return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]).toString('utf8');
}
