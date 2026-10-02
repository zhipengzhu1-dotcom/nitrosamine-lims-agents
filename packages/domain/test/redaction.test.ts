import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Value } from 'typebox/value';
import { instant, REDACTED, redactionFor, type TrailEntry } from '../src/index.ts';

const HASH = 'ab'.repeat(32);
const at = Value.Decode(instant, '2026-10-01T12:00:00.000000Z');

function entryNaming(text: string): TrailEntry {
  return {
    chain: 'company',
    seq: '7',
    at,
    atLab: null,
    actor: { label: 'Quinn Adeyemi', role: 'QA' },
    reason: `Note ${text}`,
    op: 'UPDATE',
    record: { table: 'method', id: 'm-1', kind: 'Method', label: text },
    changes: [{ field: 'title', label: 'Title', old: null, new: { text, ref: { table: 'sample', id: text } } }],
    afterFirstSave: true,
    raw: {
      chain: 'company',
      seq: '7',
      at,
      actor: 'person:quinn.qa',
      role: 'QA',
      reason: `Note ${text}`,
      table: 'method',
      op: 'UPDATE',
      oldRow: null,
      newRow: { id: 'm-1', title: text, nested: [{ note: text }], count: 3 },
      transactionId: null,
      prevHash: HASH,
      hash: HASH,
    },
  };
}

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap((v) => strings(v))
      : [];

describe("an Audit Export replaces another Customer's identifiers and keeps the requesting Customer's", () => {
  const own = ['RD-S-2026-000001', 'Northwind Pharma (fictional)'];
  const others = ['RD-S-2026-000002', 'Northwind', 'Contoso Labs (fictional)'];
  const cases: { name: string; text: string; expected: string; redacted: boolean }[] = [
    {
      name: "another Customer's Sample number is redacted",
      text: 'Run with RD-S-2026-000002',
      expected: `Run with ${REDACTED}`,
      redacted: true,
    },
    {
      name: "the requesting Customer's Sample number stays",
      text: 'Run with RD-S-2026-000001',
      expected: 'Run with RD-S-2026-000001',
      redacted: false,
    },
    {
      name: 'both in one value: only the other is redacted',
      text: 'RD-S-2026-000001, RD-S-2026-000002',
      expected: `RD-S-2026-000001, ${REDACTED}`,
      redacted: true,
    },
    {
      name: "another Customer's name inside the requesting Customer's name is left alone",
      text: 'For Northwind Pharma (fictional)',
      expected: 'For Northwind Pharma (fictional)',
      redacted: false,
    },
    {
      name: "another Customer's name on its own is redacted",
      text: 'For Northwind and Contoso Labs (fictional)',
      expected: `For ${REDACTED} and ${REDACTED}`,
      redacted: true,
    },
    {
      name: "another Customer's name in another case is redacted",
      text: 'Called CONTOSO LABS (FICTIONAL) about rd-s-2026-000002',
      expected: `Called ${REDACTED} about ${REDACTED}`,
      redacted: true,
    },
    {
      name: "another Customer's name inside a longer word is left alone",
      text: 'Northwinds and Contoso Labs (fictional)s',
      expected: 'Northwinds and Contoso Labs (fictional)s',
      redacted: false,
    },
    {
      name: 'a value naming no Customer is unchanged',
      text: 'NDMA by LC-MS/MS',
      expected: 'NDMA by LC-MS/MS',
      redacted: false,
    },
  ];
  const redact = redactionFor(own, others);
  for (const c of cases)
    it(c.name, () => {
      const out = redact(entryNaming(c.text));
      assert.equal(out.redacted, c.redacted);
      assert.equal(out.record.label, c.expected);
      assert.equal(out.reason, `Note ${c.expected}`);
      assert.equal(out.changes[0]?.new?.text, c.expected);
      assert.equal(out.changes[0]?.new?.ref?.id, c.expected);
      assert.deepEqual(out.raw.newRow, { id: 'm-1', title: c.expected, nested: [{ note: c.expected }], count: 3 });
      assert.equal(out.raw.reason, `Note ${c.expected}`);
    });

  it('no string anywhere in a redacted entry still holds the other identifier, and the hashes are kept as stored', () => {
    const out = redact(entryNaming('RD-S-2026-000002 for Contoso Labs (fictional)'));
    for (const s of strings(out)) for (const other of others) assert.ok(!s.includes(other), `${s} holds ${other}`);
    assert.deepEqual([out.raw.hash, out.raw.prevHash], [HASH, HASH]);
  });

  it('with no other Customer nothing is redacted', () => {
    const entry = entryNaming('RD-S-2026-000002');
    assert.deepEqual(redactionFor(own, [])(entry), { ...entry, redacted: false });
  });
});
