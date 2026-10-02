import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { it } from 'node:test';
import { hashPassword, verifyPassword } from '../src/credentials.ts';

const PASSWORD = 'Fifteen-chars-1';

it('a password hashed with the pepper verifies only with the same pepper', async () => {
  const pepper = randomBytes(32);
  const stored = await hashPassword(PASSWORD, pepper);
  assert.match(stored, /^scrypt-hmac\$/);
  assert.equal(await verifyPassword(PASSWORD, stored, pepper), true);
  assert.equal(await verifyPassword('Fifteen-chars-2', stored, pepper), false);
  assert.equal(await verifyPassword(PASSWORD, stored, randomBytes(32)), false);
  assert.equal(await verifyPassword(PASSWORD, stored), false, 'without the pepper the hash proves nothing');
});

it("a demo account's hash, made without the pepper, still verifies", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPassword(PASSWORD, stored, randomBytes(32)), true);
});
