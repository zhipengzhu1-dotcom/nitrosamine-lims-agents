import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { containerNumber, type NumberTaken, recordNumber } from '../src/index.ts';

describe('a record number', () => {
  const cases: { name: string; taken: NumberTaken; number: string }[] = [
    {
      name: 'a Submission is numbered company-wide, with no Lab code',
      taken: { kind: 'Submission', seq: 45, labCode: 'RD', localDate: '2026-06-01' },
      number: 'SUB-2026-000045',
    },
    {
      name: 'a Sample carries its Lab code and S',
      taken: { kind: 'Sample', seq: 123, labCode: 'RD', localDate: '2026-06-01' },
      number: 'RD-S-2026-000123',
    },
    {
      name: 'a Test Report carries its Lab code and R',
      taken: { kind: 'TestReport', seq: 45, labCode: 'RD', localDate: '2026-06-01' },
      number: 'RD-R-2026-000045',
    },
    {
      name: "another Lab's Sample carries that Lab's code",
      taken: { kind: 'Sample', seq: 1, labCode: 'QCA', localDate: '2026-06-01' },
      number: 'QCA-S-2026-000001',
    },
    {
      name: 'the sequence fills six digits',
      taken: { kind: 'Sample', seq: 999_999, labCode: 'RD', localDate: '2026-06-01' },
      number: 'RD-S-2026-999999',
    },
    {
      name: "the year is the Lab's local year on its last day, whatever the date elsewhere",
      taken: { kind: 'Sample', seq: 7, labCode: 'RD', localDate: '2026-12-31' },
      number: 'RD-S-2026-000007',
    },
    {
      name: "the year is the Lab's local year on its first day, whatever the date elsewhere",
      taken: { kind: 'TestReport', seq: 8, labCode: 'TK', localDate: '2027-01-01' },
      number: 'TK-R-2027-000008',
    },
    {
      name: "a Submission's year is the local year of the Lab it was taken in",
      taken: { kind: 'Submission', seq: 1, labCode: 'RD', localDate: '2027-01-01' },
      number: 'SUB-2027-000001',
    },
  ];
  for (const c of cases) it(c.name, () => assert.equal(recordNumber(c.taken), c.number));
});

describe('a Container number', () => {
  const cases: { sample: string; container: number; number: string }[] = [
    { sample: 'RD-S-2026-000123', container: 1, number: 'RD-S-2026-000123-C01' },
    { sample: 'RD-S-2026-000123', container: 2, number: 'RD-S-2026-000123-C02' },
    { sample: 'RD-S-2026-000123', container: 12, number: 'RD-S-2026-000123-C12' },
  ];
  for (const c of cases) {
    it(`Container ${c.container} of ${c.sample} is ${c.number}`, () =>
      assert.equal(containerNumber(c.sample, c.container), c.number));
  }
});
