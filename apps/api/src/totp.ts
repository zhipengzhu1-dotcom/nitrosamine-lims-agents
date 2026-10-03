import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_MS = 30_000;
const DIGITS = 6;
/** Steps either side of now that a code may come from, for a phone clock a little off the server's. */
const DRIFT_STEPS = 1;
const ISSUER = 'Nitrosamine LIMS';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The RFC 6238 time step that `atMs` falls in. */
export const stepAt = (atMs: number): number => Math.floor(atMs / STEP_MS);

/** The 6-digit RFC 6238 code (HMAC-SHA-1, 30-second steps) of `secret` at time step `step`. */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  return String(mac.readUInt32BE(offset) & 0x7fffffff)
    .slice(-DIGITS)
    .padStart(DIGITS, '0');
}

/**
 * The time step whose code `code` is, among the steps within the drift of `atMs` and later than `lastUsedStep`, so a
 * code accepted once, or one older than it, is never accepted again; null when none matches.
 */
export function acceptedStep(secret: Buffer, code: string, atMs: number, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(atMs);
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++)
    if (
      (lastUsedStep === null || step > lastUsedStep) &&
      timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))
    )
      return step;
  return null;
}

/** A fresh 160-bit TOTP secret, the length RFC 4226 recommends. */
export const newTotpSecret = (): Buffer => randomBytes(20);

/** The secret as the base32 text an authenticator app accepts typed in, for a device without a camera. */
export function base32(secret: Buffer): string {
  let bits = '';
  for (const byte of secret) bits += byte.toString(2).padStart(8, '0');
  let text = '';
  for (let at = 0; at < bits.length; at += 5) text += BASE32[Number.parseInt(bits.slice(at, at + 5).padEnd(5, '0'), 2)];
  return text;
}

/** The otpauth URI that the enrolment QR code carries, which Microsoft Authenticator and Duo Mobile both read. */
export function otpauthUri(username: string, secret: Buffer): string {
  const label = encodeURIComponent(`${ISSUER}:${username}`);
  const issuer = encodeURIComponent(ISSUER);
  return `otpauth://totp/${label}?secret=${base32(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=30`;
}

/** Encrypts a TOTP secret under the API's TOTP key with AES-256-GCM, so the database never holds it in the clear. */
export function sealSecret(key: Buffer, secret: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]);
}

/** Decrypts what `sealSecret` made; throws when the key is not the one it was sealed under or the bytes changed. */
export function openSecret(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV_BYTES));
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}
