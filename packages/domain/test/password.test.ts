import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DECIDED_PASSWORD, DEMO_PASSWORD, passwordRefusal } from '../src/password.ts';

describe('the decided password rule', () => {
  for (const [password, refusal] of [
    ['Fourteen-char1', 'A password needs at least 15 characters.'],
    ['Fifteen-chars-1', null],
    ['fifteen-chars-1', 'A password needs an uppercase letter.'],
    ['FIFTEEN-CHARS-1', 'A password needs a lowercase letter.'],
    ['Fifteen-chars-x', 'A password needs a digit.'],
    ['Fifteenchars123', 'A password needs a symbol.'],
    ['fifteencharsxyz', 'A password needs an uppercase letter, a digit and a symbol.'],
    ['Ünïcödé-pässwörd-9', null],
  ] as const)
    it(`answers ${JSON.stringify(refusal)} to ${JSON.stringify(password)}`, () => {
      assert.equal(passwordRefusal(DECIDED_PASSWORD, password), refusal);
    });

  it('counts characters, not UTF-16 units, toward the 15', () => {
    assert.equal(
      passwordRefusal(DECIDED_PASSWORD, 'Ab1-😀😀😀😀😀😀😀😀😀😀'),
      'A password needs at least 15 characters.',
    );
  });
});

describe("the demo-login exception's password rule", () => {
  it('asks only for 4 characters', () => {
    assert.equal(passwordRefusal(DEMO_PASSWORD, 'abc'), 'A password needs at least 4 characters.');
    assert.equal(passwordRefusal(DEMO_PASSWORD, 'abcd'), null);
  });
});
