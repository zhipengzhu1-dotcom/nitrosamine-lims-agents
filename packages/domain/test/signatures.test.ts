import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Meaning, unsignedMeanings } from '../src/index.ts';

const row = (meaning: Meaning, unsigned: boolean) => ({ meaning, unsigned });

describe('a record names as unsigned only the Signature Meanings no Signature gives on it as it reads now', () => {
  const cases: { name: string; rows: ReturnType<typeof row>[]; unsigned: Meaning[] }[] = [
    { name: 'a record whose Signatures all cover it names none', rows: [row('Performed', false)], unsigned: [] },
    {
      name: 'a record changed after signing names each meaning once, in signing order',
      rows: [row('Performed', true), row('Reviewed', true), row('Performed', true)],
      unsigned: ['Performed', 'Reviewed'],
    },
    {
      name: 'a meaning signed again on the record as it reads now is not named, though its earlier Signature is unsigned',
      rows: [row('Performed', true), row('Reviewed', true), row('Approved', false), row('Performed', false)],
      unsigned: ['Reviewed'],
    },
  ];
  for (const c of cases) it(c.name, () => assert.deepEqual(unsignedMeanings(c.rows), c.unsigned));
});
