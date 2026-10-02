import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSentence } from '../src/index.ts';

describe('a message for the person at the bench is a sentence', () => {
  const cases: { text: string; sentence: boolean }[] = [
    { text: 'This account is locked.', sentence: true },
    { text: 'The LIMS did not answer (status 502).', sentence: true },
    { text: 'This screen is locked. Ana Ferreira unlocks it with their password.', sentence: true },
    { text: 'this account is locked.', sentence: false },
    { text: 'This account is locked', sentence: false },
    { text: 'This account is locked..', sentence: false },
    { text: '4 Tests are waiting.', sentence: false },
    { text: '.', sentence: false },
    { text: '', sentence: false },
  ];
  for (const c of cases)
    it(`${JSON.stringify(c.text)} ${c.sentence ? 'is' : 'is not'} a sentence`, () => {
      assert.equal(isSentence(c.text), c.sentence);
    });
});
