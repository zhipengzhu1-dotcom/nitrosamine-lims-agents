// The views every record screen shares, read as a person reads them: the inline Audit Trail with
// who (name, username, role), field names and old -> new values; a record's Recorded Values with
// their unit, critical flag and Verified and pending state; and a version's standing with the
// record's label, its Lab and each meaning's statement (decision 23 rules 10 and 12).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEntryDto, PreparedSigningDto, StandingDto, ValueDto } from '@lims/contract';
import { login, signAs, testApi, type Client, type TestApi } from '../src/testing/harness.ts';
import { cast, createWidget, installWidget, newWidget, recordWeight, widgetKind, type People } from './support.ts';

let api: TestApi;
let people: People;
let ann: Client;
let bob: Client;
let widget: string;
let weight: Awaited<ReturnType<typeof recordWeight>>;

beforeAll(async () => {
  api = await testApi({ kinds: [widgetKind], commands: [createWidget] });
  await installWidget(api);
  people = await cast(api);
  ann = await login(api, people.ann);
  bob = await login(api, people.bob);
  widget = await newWidget(ann, 'W1');
  weight = await recordWeight(ann, widget, '100.12');
  const changed = await bob.command('value.change', { role: 'Reviewer', value: weight.value, to: { type: 'decimal', value: '100.21', unit: 'mg' }, reason: { code: 'transcription-error' } });
  if (changed.status !== 200) throw new Error(JSON.stringify(changed.body));
});
afterAll(() => api.close());

const RAW_COLUMNS = ['value_text', 'content', 'content_hash', 'version_id', 'record_id', 'ledger_id', 'parent_id', 'created_by'];

describe('record.audit reads as a person reads it', () => {
  it("a value's own trail shows the value typed and the change proposed, old -> new, with who and why", async () => {
    const r = await ann.view('record.audit', { recordId: weight.value });
    expect(r.status).toBe(200);
    const entries = (r.body as { entries: AuditEntryDto[] }).entries;
    const valueRows = entries.flatMap((e) => e.changes.filter((c) => c.field === 'P1 weight').map((c) => ({ ...c, person: e.person, username: e.username, role: e.role, reason: e.reason, later: e.afterFirstSave })));
    expect(valueRows).toEqual([
      { field: 'P1 weight', from: null, to: '100.12 mg', person: 'Ann Analyst', username: 'ann', role: 'Analyst', reason: 'First save', later: false },
      { field: 'P1 weight', from: '100.12 mg', to: '100.21 mg', person: 'Bob Reviewer', username: 'bob', role: 'Reviewer', reason: 'Transcription error', later: true },
    ]);
    expect(entries.every((e) => e.record === 'P1 weight on Widget W1')).toBe(true);
  });

  it('names fields, never table columns or stored bytes', async () => {
    const entries = ((await ann.view('record.audit', { recordId: weight.value })).body as { entries: AuditEntryDto[] }).entries;
    const fields = entries.flatMap((e) => e.changes.map((c) => c.field));
    for (const raw of RAW_COLUMNS) expect(fields, raw).not.toContain(raw);
    expect(fields).toContain('Record Version');
  });

  it("a record's trail includes its Recorded Values' entries", async () => {
    const entries = ((await ann.view('record.audit', { recordId: widget })).body as { entries: AuditEntryDto[] }).entries;
    expect(entries.map((e) => e.record)).toEqual(expect.arrayContaining(['Widget W1', 'P1 weight on Widget W1']));
    expect(entries.flatMap((e) => e.changes).some((c) => c.field === 'P1 weight' && c.to === '100.12 mg')).toBe(true);
  });
});

describe('record.values', () => {
  it("lists a record's values with their field register, the effective value and the pending change", async () => {
    const r = await ann.view('record.values', { parent: widget });
    expect(r.status).toBe(200);
    expect((r.body as { values: ValueDto[] }).values).toEqual([expect.objectContaining({
      valueId: weight.value, field: 'prep.weight', subject: 'P1', label: 'P1 weight', unit: 'mg', critical: true, text: '100.12', verified: false,
      pending: expect.objectContaining({ text: '100.21' }),
    })]);
  });
});

describe('signing.standing', () => {
  it("carries the record's label, its Lab and each signature's statement", async () => {
    const fresh = await recordWeight(ann, widget, '99.87', 'P2');
    const signed = await signAs(bob, people.bob, 'Verified', 'Reviewer', [fresh.value]);
    expect(signed.status).toBe(200);
    const s = (await ann.view('signing.standing', { versionId: fresh.version.versionId })).body as StandingDto;
    expect(s).toMatchObject({
      kind: 'signed', record: 'P2 weight on Widget W1', lab: 'RD',
      signatures: [{ meaning: 'Verified', username: 'bob', statement: 'I checked this entry against its source and it is correct.' }],
    });
    const unsigned = (await ann.view('signing.standing', { versionId: weight.version.versionId })).body as StandingDto;
    expect(unsigned).toMatchObject({ kind: 'unsigned', record: 'P1 weight on Widget W1', lab: 'RD' });
  });
});

describe('what the signer sees (signing.prepare)', () => {
  it("lists each record's values with who recorded them, and the attestation's values with who ticked each", async () => {
    const reviewed = await newWidget(ann, 'W2');
    await recordWeight(ann, reviewed, '12.5');
    const attestation = await newWidget(bob, 'W3', 'Reviewer');
    await recordWeight(bob, attestation, '1.0', 'P1', 'Reviewer');
    const r = await bob.command('signing.prepare', { meaning: 'Reviewed', role: 'Reviewer', targets: [reviewed], attestation });
    expect(r.status).toBe(200);
    const data = (r.body as { data: PreparedSigningDto }).data;
    expect(data.items[0]!.values).toEqual([expect.objectContaining({ label: 'P1 weight', text: '12.5', unit: 'mg', by: 'Ann Analyst (ann)' })]);
    expect(data.items[0]!.values[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.attestation).toMatchObject({ label: 'Widget W3', values: [expect.objectContaining({ label: 'P1 weight', text: '1.0', by: 'Bob Reviewer (bob)' })] });
  });
});
