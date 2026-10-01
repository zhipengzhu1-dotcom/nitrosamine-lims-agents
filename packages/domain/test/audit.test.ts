import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chainVerification,
  type ChainVerification,
  describeTrail,
  type HistoryEntry,
  inZone,
  instantOf,
  type RawEntry,
  referencedRecords,
} from '../src/index.ts';

const instant = instantOf;

describe('a recomputed chain reads as how far it is intact', () => {
  const cases: { name: string; last: string; failure: string | null; expected: Omit<ChainVerification, 'chain'> }[] = [
    {
      name: 'an untouched chain is intact through its last entry',
      last: '12',
      failure: null,
      expected: { lastEntry: '12', intactThrough: '12', firstFailure: null, report: 'intact through entry 12' },
    },
    {
      name: 'an empty chain is intact through entry 0',
      last: '0',
      failure: null,
      expected: { lastEntry: '0', intactThrough: '0', firstFailure: null, report: 'intact through entry 0' },
    },
    {
      name: 'an altered entry is the first failure, and the chain is intact through the entry before it',
      last: '12',
      failure: '5',
      expected: {
        lastEntry: '12',
        intactThrough: '4',
        firstFailure: '5',
        report: 'entry 5 fails to verify; intact through entry 4',
      },
    },
    {
      name: 'a moved chain head fails after the last entry',
      last: '12',
      failure: '13',
      expected: {
        lastEntry: '12',
        intactThrough: '12',
        firstFailure: '13',
        report: 'the chain head does not match entry 12; intact through entry 12',
      },
    },
  ];
  for (const c of cases)
    it(c.name, () => assert.deepEqual(chainVerification('lab', c.last, c.failure), { chain: 'lab', ...c.expected }));
});

describe('an instant renders on the wall clock of a zone with its offset', () => {
  const cases: [string, string, string][] = [
    ['2026-01-15T12:00:00.000000Z', 'America/New_York', '2026-01-15 07:00:00 -05:00'],
    ['2026-07-15T12:00:00.123456Z', 'America/New_York', '2026-07-15 08:00:00 -04:00'],
    ['2026-07-15T12:00:00.000000Z', 'UTC', '2026-07-15 12:00:00 +00:00'],
    ['2026-07-15T23:30:00.000000Z', 'Asia/Kolkata', '2026-07-16 05:00:00 +05:30'],
  ];
  for (const [at, zone, expected] of cases)
    it(`${at} in ${zone}`, () => assert.equal(inZone(instant(at), zone), expected));
});

const LAB = 'a4d6a9d1-0000-4000-8000-000000000001';
const entry = (over: Partial<RawEntry>): RawEntry => ({
  chain: LAB,
  seq: '1',
  at: instant('2026-10-01T10:00:00.000000Z'),
  actor: 'person:lena.manager',
  role: 'LabManager',
  reason: 'assign',
  table: 'test',
  op: 'UPDATE',
  oldRow: null,
  newRow: null,
  prevHash: '00',
  hash: '01',
  ...over,
});
const history: HistoryEntry[] = [
  {
    table: 'person',
    at: instant('2026-10-01T08:00:00.000000Z'),
    row: { id: 'p1', username: 'lena.manager', display_name: 'Lena Varga' },
  },
  {
    table: 'person',
    at: instant('2026-10-01T08:00:00.000000Z'),
    row: { id: 'p2', username: 'ana.analyst', display_name: 'Ana Ferreira' },
  },
  {
    table: 'person',
    at: instant('2026-10-01T11:00:00.000000Z'),
    row: { id: 'p2', username: 'ana.analyst', display_name: 'Ana Ferreira-Souza' },
  },
  { table: 'sample', at: instant('2026-10-01T09:00:00.000000Z'), row: { id: 's1', number: 'RD-S00001' } },
];

describe('an entry reads in glossary words with labels as they stood at its time', () => {
  const assign = entry({
    oldRow: { id: 't1', lab_id: LAB, sample_id: 's1', state: 'Ready', assignee_id: null },
    newRow: { id: 't1', lab_id: LAB, sample_id: 's1', state: 'Assigned', assignee_id: 'p2' },
  });
  const later = entry({
    seq: '2',
    at: instant('2026-10-01T12:00:00.000000Z'),
    actor: 'person:ana.analyst',
    role: 'Analyst',
    reason: 'enterResult',
    table: 'result',
    op: 'INSERT',
    newRow: { id: 'r1', lab_id: LAB, test_id: 't1', analyte: 'NDMA', value: '0.0300', unit: 'ppm', entered_by: 'p2' },
  });
  const submission = entry({
    chain: 'company',
    seq: '7',
    at: instant('2026-10-01T09:30:00.000000Z'),
    actor: 'svc:seed',
    role: 'system',
    table: 'submission',
    op: 'INSERT',
    newRow: { id: 'sub1', customer_id: 'c1', submitted_by: 'p1' },
  });
  const [first, second, third] = describeTrail([later, assign, submission], history, {
    id: LAB,
    zone: 'America/New_York',
  });

  it('orders by time across chains and marks each chain', () =>
    assert.deepEqual(
      [first, second, third].map((e) => [e?.chain, e?.seq, e?.atLab]),
      [
        ['company', '7', null],
        ['lab', '1', '2026-10-01 06:00:00 -04:00'],
        ['lab', '2', '2026-10-01 08:00:00 -04:00'],
      ],
    ));

  it('names the field, the old and the new value, and the referenced record by its label at the time', () =>
    assert.deepEqual(second?.changes, [
      { field: 'state', label: 'State', old: { text: 'Ready', ref: null }, new: { text: 'Assigned', ref: null } },
      {
        field: 'assignee_id',
        label: 'Analyst',
        old: null,
        new: { text: 'Ana Ferreira', ref: { table: 'person', id: 'p2' } },
      },
    ]));

  it('labels the actor and the record as they stood at the time, and lists only the fields a row carries', () =>
    assert.deepEqual(
      [
        [second?.actor, second?.record],
        [third?.actor, third?.record.label, third?.changes.find((c) => c.field === 'entered_by')?.new?.text],
        [first?.actor.label, first?.record.label, first?.changes.length],
      ],
      [
        [
          { label: 'Lena Varga', role: 'LabManager' },
          { table: 'test', id: 't1', kind: 'Test', label: 'RD-S00001' },
        ],
        [{ label: 'Ana Ferreira-Souza', role: 'Analyst' }, 'NDMA 0.0300 ppm', 'Ana Ferreira-Souza'],
        ['svc:seed', 'Submission from c1', 2],
      ],
    ));

  it('highlights a change to a saved value after first save, not a forward step', () => {
    const renamed = entry({
      table: 'person',
      chain: 'company',
      oldRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 0 },
      newRow: { id: 'p2', display_name: 'Ana Ferreira-Souza', failed_logins: 0 },
    });
    const signedIn = entry({
      table: 'person',
      chain: 'company',
      oldRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 2 },
      newRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 0 },
    });
    assert.deepEqual(
      describeTrail([assign, renamed, signedIn, later], history, { id: LAB, zone: 'UTC' }).map((e) => e.afterFirstSave),
      [false, true, false, false],
    );
  });

  it('collects every record whose history the labels need', () =>
    assert.deepEqual(
      referencedRecords([assign, later, submission])
        .map((r) => `${r.table}: ${[...r.ids].sort().join(' ')}`)
        .sort(),
      ['customer: c1', 'person: p1 p2', 'result: r1', 'sample: s1', 'submission: sub1', 'test: t1'],
    ));
});
