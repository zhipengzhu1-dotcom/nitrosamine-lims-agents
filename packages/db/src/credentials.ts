import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
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

export function otpauthUri(username: string, secret: string): string {
  return `otpauth://totp/NitroLIMS:${encodeURIComponent(username)}?secret=${secret}&issuer=NitroLIMS`;
}
