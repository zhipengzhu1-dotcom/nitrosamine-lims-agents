import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Value } from 'typebox/value';
import {
  type BreakKind,
  breakReport,
  type ChainBreakFound,
  chainReading,
  type ChainReading,
  currentLabel,
  describeTrail,
  fromTheFirstEntry,
  instant,
  instantKey,
  type RowImage,
  referencedRecords,
  type Resumed,
  storedInstants,
  type TimedEntry,
} from '../src/index.ts';

const at = (s: string) => Value.Decode(instant, s);

describe('a recomputed chain reads as how far it is intact, and names each break with its System Incident', () => {
  const open = (entry: string, incident: string, kind: BreakKind = 'Changed', through = entry, breaks = 1) => ({
    entry,
    incident,
    incidentState: 'Open' as const,
    kind,
    through,
    breaks,
  });
  const read = ({ entry, incident, incidentState }: ChainBreakFound, failure: string) => ({
    entry,
    incident,
    incidentState,
    failure,
  });
  const cases: {
    name: string;
    last: string;
    breaks: ChainBreakFound[];
    expected: Omit<ChainReading, 'chain' | keyof Resumed>;
  }[] = [
    {
      name: 'an untouched chain is intact through its last entry',
      last: '12',
      breaks: [],
      expected: {
        verdict: 'Intact',
        lastEntry: '12',
        intactThrough: '12',
        breaks: [],
        report: 'verified through entry 12',
      },
    },
    {
      name: 'an empty chain is intact through entry 0',
      last: '0',
      breaks: [],
      expected: {
        verdict: 'Intact',
        lastEntry: '0',
        intactThrough: '0',
        breaks: [],
        report: 'verified through entry 0',
      },
    },
    {
      name: 'an altered entry is a break, and the chain is intact through the entry before it',
      last: '12',
      breaks: [open('5', 'RF000001')],
      expected: {
        verdict: 'Broken',
        lastEntry: '12',
        intactThrough: '4',
        breaks: [read(open('5', 'RF000001'), 'entry 5 fails to verify')],
        report: 'intact through entry 4',
      },
    },
    {
      name: 'a moved chain head is a break after the last entry',
      last: '12',
      breaks: [open('13', 'RF000001', 'HeadMoved')],
      expected: {
        verdict: 'Broken',
        lastEntry: '12',
        intactThrough: '12',
        breaks: [read(open('13', 'RF000001', 'HeadMoved'), 'the chain head does not match entry 12')],
        report: 'intact through entry 12',
      },
    },
    {
      name: 'every break is named with its own System Incident in its state, and the first sets how far the chain is intact',
      last: '12',
      breaks: [{ ...open('3', 'RF000001'), incidentState: 'Closed' }, open('7', 'RF000002', 'Missing', '8')],
      expected: {
        verdict: 'Broken',
        lastEntry: '12',
        intactThrough: '2',
        breaks: [
          { entry: '3', incident: 'RF000001', incidentState: 'Closed', failure: 'entry 3 fails to verify' },
          { entry: '7', incident: 'RF000002', incidentState: 'Open', failure: 'entries 7 to 8 are missing' },
        ],
        report: 'intact through entry 2',
      },
    },
    {
      name: 'the breaks after those recorded one by one read as how many there are and the entries they span',
      last: '2000',
      breaks: [open('1', 'RF000001'), open('101', 'RF000002', 'More', '2000', 1900)],
      expected: {
        verdict: 'Broken',
        lastEntry: '2000',
        intactThrough: '0',
        breaks: [
          read(open('1', 'RF000001'), 'entry 1 fails to verify'),
          read(open('101', 'RF000002'), '1900 more breaks, from entry 101 to entry 2000'),
        ],
        report: 'intact through entry 0',
      },
    },
  ];
  for (const c of cases)
    it(c.name, () =>
      assert.deepEqual(chainReading('lab', c.last, c.breaks), {
        chain: 'lab',
        ...fromTheFirstEntry,
        ...c.expected,
      }),
    );

  it('a break reads as where the chain fails and its System Incident in its state', () => {
    const [closed, head] = chainReading('lab', '12', [
      { ...open('3', 'RF000001'), incidentState: 'Closed' },
      open('13', 'RF000002', 'HeadMoved'),
    ]).breaks;
    assert.deepEqual(
      [closed, head].map((b) => b && breakReport(b)),
      [
        'entry 3 fails to verify, recorded as System Incident RF000001 (Closed)',
        'the chain head does not match entry 12, recorded as System Incident RF000002 (Open)',
      ],
    );
  });
});

const LAB = 'a4d6a9d1-0000-4000-8000-000000000001';
const HASH = '0'.repeat(64);
const entry = (over: Partial<TimedEntry>): TimedEntry => ({
  chain: LAB,
  seq: '1',
  at: at('2026-10-01T10:00:00.000000Z'),
  atLab: at('2026-10-01T06:00:00.000000-04:00'),
  actor: 'person:lena.manager',
  role: 'LabManager',
  reason: 'assign',
  table: 'test',
  op: 'UPDATE',
  oldRow: null,
  newRow: null,
  transactionId: null,
  prevHash: HASH,
  hash: HASH,
  ...over,
});
const images: RowImage[] = [
  {
    table: 'person',
    at: at('2026-10-01T08:00:00.000000Z'),
    row: { id: 'p1', username: 'lena.manager', display_name: 'Lena Varga' },
  },
  {
    table: 'person',
    at: at('2026-10-01T08:00:00.000000Z'),
    row: { id: 'p2', username: 'ana.analyst', display_name: 'Ana Ferreira' },
  },
  {
    table: 'person',
    at: at('2026-10-01T11:00:00.000000Z'),
    row: { id: 'p2', username: 'ana.analyst', display_name: 'Ana Ferreira-Souza' },
  },
  { table: 'sample', at: at('2026-10-01T09:00:00.000000Z'), row: { id: 's1', number: 'RD-S00001' } },
  { table: 'sample', at: at('2026-10-01T13:00:00.000000Z'), row: { id: 's1', number: 'RD-S00001-R' } },
  { table: 'customer', at: at('2026-10-01T07:00:00.000000Z'), row: { id: 'c1', name: 'Northwind' } },
];

describe('an entry reads in glossary words with labels as they stood at its time', () => {
  const assign = entry({
    oldRow: { id: 't1', lab_id: LAB, sample_id: 's1', state: 'Ready', assignee_id: null },
    newRow: { id: 't1', lab_id: LAB, sample_id: 's1', state: 'Assigned', assignee_id: 'p2' },
  });
  const later = entry({
    seq: '2',
    at: at('2026-10-01T12:00:00.000000Z'),
    atLab: at('2026-10-01T08:00:00.000000-04:00'),
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
    at: at('2026-10-01T09:30:00.000000Z'),
    atLab: null,
    actor: 'svc:seed',
    role: 'system',
    table: 'submission',
    op: 'INSERT',
    newRow: { id: 'sub1', customer_id: 'c1', submitted_by: 'p1' },
  });
  const [first, second, third] = describeTrail([later, assign, submission], images, LAB, new Map());

  it('orders by time across chains, marks each chain, and keeps the Lab-zone instant only on the Lab chain', () =>
    assert.deepEqual(
      [first, second, third].map((e) => [e?.chain, e?.seq, e?.atLab]),
      [
        ['company', '7', null],
        ['lab', '1', '2026-10-01T06:00:00.000000-04:00'],
        ['lab', '2', '2026-10-01T08:00:00.000000-04:00'],
      ],
    ));

  it('names the field, the old and the new value, and the referenced record by its label at the time', () =>
    assert.deepEqual(second?.changes, [
      {
        field: 'state',
        label: 'State',
        old: { text: 'Ready', ref: null, instant: null },
        new: { text: 'Assigned', ref: null, instant: null },
      },
      {
        field: 'assignee_id',
        label: 'Analyst',
        old: null,
        new: { text: 'Ana Ferreira', ref: { table: 'person', id: 'p2' }, instant: null },
      },
    ]));

  it('labels the actor and the record as they stood at the time, two references deep, and lists only the fields a row carries', () =>
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
        ['svc:seed', 'from Northwind', 2],
      ],
    ));

  it('a Submission is labelled after its kind, "Submission from <Customer>"', () =>
    assert.equal(first?.record.label, 'from Northwind'));

  it('the current label of a record is its latest image, after every entry', () =>
    assert.equal(currentLabel(images, 'test', 't1'), 't1'));

  it('the current label follows a reference to its latest image', () =>
    assert.equal(
      currentLabel(
        [
          ...images,
          ...describeTrail([assign], [], LAB, new Map()).map((e) => ({
            table: 'test' as const,
            at: e.at,
            row: e.raw.newRow ?? {},
          })),
        ],
        'test',
        't1',
      ),
      'RD-S00001-R',
    ));

  it('highlights a change to a saved value after first save, not a forward step', () => {
    const renamed = entry({
      table: 'person',
      chain: 'company',
      atLab: null,
      oldRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 0 },
      newRow: { id: 'p2', display_name: 'Ana Ferreira-Souza', failed_logins: 0 },
    });
    const signedIn = entry({
      table: 'person',
      chain: 'company',
      atLab: null,
      oldRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 2 },
      newRow: { id: 'p2', display_name: 'Ana Ferreira', failed_logins: 0 },
    });
    assert.deepEqual(
      describeTrail([assign, renamed, signedIn, later], images, LAB, new Map()).map((e) => e.afterFirstSave),
      [false, true, false, false],
    );
  });

  it("reads a person's reduced-motion save as Reduce motion, not as a change after first save", () => {
    const saved = entry({
      table: 'person',
      chain: 'company',
      atLab: null,
      oldRow: { id: 'p2', display_name: 'Ana Ferreira', reduced_motion: false },
      newRow: { id: 'p2', display_name: 'Ana Ferreira', reduced_motion: true },
    });
    const [described] = describeTrail([saved], images, LAB, new Map());
    assert.deepEqual(
      [described?.afterFirstSave, described?.changes.map((c) => [c.label, c.old?.text, c.new?.text])],
      [false, [['Reduce motion', 'false', 'true']]],
    );
  });

  it("collects every record the given rows reference, each row's own record included", () =>
    assert.deepEqual(
      referencedRecords([
        { table: 'test', at: assign.at, row: assign.newRow ?? {} },
        { table: 'result', at: later.at, row: later.newRow ?? {} },
        { table: 'submission', at: submission.at, row: submission.newRow ?? {} },
      ])
        .map((r) => `${r.table}: ${[...r.ids].sort().join(' ')}`)
        .sort(),
      ['customer: c1', 'person: p1 p2', 'result: r1', 'sample: s1', 'submission: sub1', 'test: t1'],
    ));
});

describe('a stored value reads in glossary words, not as the database stores it', () => {
  const signedAt = '2026-10-01T23:50:10.383672+00:00';
  const rendered = { at: at('2026-10-01T23:50:10.383672Z'), atLab: at('2026-10-01T19:50:10.383672-04:00') };
  const version = entry({
    table: 'record_version',
    op: 'INSERT',
    newRow: {
      id: 'v1',
      record_table: 'test_report',
      record_id: 'tr1',
      content: '\\x7b2261223a20317d',
      content_hash: `\\x${'ab'.repeat(32)}`,
      saved_at: signedAt,
    },
  });
  const locked = entry({
    chain: 'company',
    atLab: null,
    table: 'person',
    oldRow: { id: 'p2', locked_at: null },
    newRow: { id: 'p2', locked_at: signedAt },
  });
  const [shown, companyShown] = describeTrail([version, locked], [], LAB, new Map([[signedAt, rendered]])).map(
    (e) => new Map(e.changes.map((c) => [c.field, c.new])),
  );

  it('a Record kind reads as its glossary noun', () =>
    assert.deepEqual(shown?.get('record_table'), { text: 'Test Report', ref: null, instant: null }));

  it('a hash reads as hex, without the bytea prefix', () =>
    assert.deepEqual(shown?.get('content_hash'), { text: 'ab'.repeat(32), ref: null, instant: null }));

  it('signed content reads as its UTF-8 text', () => assert.equal(shown?.get('content')?.text, '{"a": 1}'));

  it('a stored instant carries its UTC and Lab-zone renderings on the Lab chain, and only UTC on the company chain', () =>
    assert.deepEqual(
      [shown?.get('saved_at')?.instant, companyShown?.get('locked_at')?.instant],
      [rendered, { at: rendered.at, atLab: null }],
    ));

  it('collects each stored instant once, from old and new rows', () =>
    assert.deepEqual(storedInstants([version, locked]), [{ stored: signedAt, zone: null }]));

  const signature = entry({
    table: 'signature',
    op: 'INSERT',
    newRow: { id: 'sig1', signed_at: signedAt, signed_time_zone: 'America/New_York' },
  });
  const keptZone = { at: rendered.at, atLab: at('2026-10-01T19:50:10.383672-04:00') };
  const labZoneNow = { at: rendered.at, atLab: at('2026-10-02T08:50:10.383672+09:00') };

  it('a Signed at reads on the Lab time zone its Signature kept, not on the zone the Lab holds now', () => {
    const wanted = storedInstants([signature]);
    const instants = new Map([
      [signedAt, labZoneNow],
      [instantKey({ stored: signedAt, zone: 'America/New_York' }), keptZone],
    ]);
    const [described] = describeTrail([signature], [], LAB, instants);
    assert.deepEqual(
      [wanted, described?.changes.find((c) => c.field === 'signed_at')?.new?.instant],
      [[{ stored: signedAt, zone: 'America/New_York' }], keptZone],
    );
  });
});
