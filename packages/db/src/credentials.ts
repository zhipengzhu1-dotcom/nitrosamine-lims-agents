import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const derive = (password: string | Buffer, salt: Buffer, length: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** The scheme of a hash made with the pepper: scrypt over the password's HMAC-SHA-256 under the pepper secret. */
const PEPPERED = 'scrypt-hmac';
const peppered = (password: string, pepper: Buffer) => createHmac('sha256', pepper).update(password).digest();

export const MIN_PASSWORD_LENGTH = 4;

/**
 * Hashes a password with scrypt and a fresh salt, and with the pepper secret when one is given, so a copy of the
 * database alone cannot test guesses. The seed's demo accounts are hashed without it.
 */
export async function hashPassword(password: string, pepper?: Buffer): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`a password needs at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = randomBytes(16);
  const key = await derive(pepper ? peppered(password, pepper) : password, salt, 64);
  return `${pepper ? PEPPERED : 'scrypt'}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Answers whether `password` is the one `stored` was hashed from; a peppered hash needs the same pepper. */
export async function verifyPassword(password: string, stored: string, pepper?: Buffer): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (!salt || !key) return false;
  const withPepper = scheme === PEPPERED && pepper !== undefined;
  if (scheme !== 'scrypt' && !withPepper) return false;
  const expected = Buffer.from(key, 'base64');
  const input = withPepper ? peppered(password, pepper) : password;
  return timingSafeEqual(await derive(input, Buffer.from(salt, 'base64'), expected.length), expected);
}
