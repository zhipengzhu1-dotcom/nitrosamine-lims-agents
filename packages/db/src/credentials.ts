import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const derive = (password: string, salt: Buffer, length: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, (error, key) => (error ? reject(error) : resolve(key)));
  });

export const MIN_PASSWORD_LENGTH = 4;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`a password needs at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await derive(password, salt, 64)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'base64'), expected.length), expected);
}
