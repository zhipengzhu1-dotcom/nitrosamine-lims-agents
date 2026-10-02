import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { acceptedStep, base32, openSecret, otpauthUri, sealSecret, stepAt, totpCode } from '../src/totp.ts';

const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP codes', () => {
  for (const [seconds, code] of [
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ] as const)
    it(`the code at ${seconds} s is the last six digits of RFC 6238's SHA-1 vector, ${code}`, () => {
      assert.equal(totpCode(RFC_SECRET, stepAt(seconds * 1000)), code);
    });

  it('a code is accepted from the step before or after now, and not from two steps away', () => {
    const now = 1_234_567_890_000;
    for (const off of [-1, 0, 1]) {
      const step = stepAt(now) + off;
      assert.equal(acceptedStep(RFC_SECRET, totpCode(RFC_SECRET, step), now, null), step);
    }
    assert.equal(acceptedStep(RFC_SECRET, totpCode(RFC_SECRET, stepAt(now) - 2), now, null), null);
  });

  it('a code from the last used step, or from before it, is refused', () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    assert.equal(acceptedStep(RFC_SECRET, totpCode(RFC_SECRET, step), now, step), null);
    assert.equal(acceptedStep(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step), null);
    assert.equal(acceptedStep(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step), step + 1);
  });

  it('a code that is not six digits is refused', () => {
    assert.equal(acceptedStep(RFC_SECRET, '', 0, null), null);
    assert.equal(acceptedStep(RFC_SECRET, '28708', 59_000, null), null);
  });
});

describe('the enrolment secret', () => {
  it('reads as RFC 4648 base32 text and in the otpauth URI', () => {
    assert.equal(base32(RFC_SECRET), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(
      otpauthUri('ana.analyst', RFC_SECRET),
      'otpauth://totp/Nitrosamine%20LIMS%3Aana.analyst?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' +
        '&issuer=Nitrosamine%20LIMS&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('is stored sealed: it opens under its key and under no other', () => {
    const key = randomBytes(32);
    const sealed = sealSecret(key, RFC_SECRET);
    assert.ok(!sealed.includes(RFC_SECRET), 'the sealed bytes do not hold the secret');
    assert.deepEqual(openSecret(key, sealed), RFC_SECRET);
    assert.throws(() => openSecret(randomBytes(32), sealed));
  });
});
