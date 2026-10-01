import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await derive(password, salt, 64)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'base64'), expected.length), expected);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A 160-bit TOTP secret in RFC 4648 base32, the form authenticator apps take. */
export function newTotpSecret(): string {
  let bits = '';
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((chunk) => BASE32[parseInt(chunk, 2)]).join('');
}

export function totpStep(at = Date.now()): number {
  return Math.floor(at / 30_000);
}

/** The RFC 6238 six-digit code for one 30-second time step, with HMAC-SHA1 as authenticator apps use. */
export function totpCode(secret: string, step: number): string {
  let bits = '';
  for (const char of secret) bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', key).update(counter).digest();
  return String((mac.readUInt32BE(mac[mac.length - 1]! & 0xf) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function otpauthUri(username: string, secret: string): string {
  return `otpauth://totp/NitroLIMS:${encodeURIComponent(username)}?secret=${secret}&issuer=NitroLIMS`;
}
