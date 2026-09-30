// Test-plan A7: ADR 0001 in SQL.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited, type AuditedTx } from '../src/audited.ts';
import { sign, type Sealed } from '../src/doors.ts';
import type { RecordId } from '../src/ids.ts';
import { seedFixture, type Fixture, type Person } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState, installWidget, newValue, newWidget, recordValue, committed } from './support.ts';

let db: TestDb;
let fx: Fixture;
let widget: RecordId;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await newWidget(tx, fx.labA, 'W') }));
  widget = committed(out);
});
afterAll(() => db.close());

const as = <T>(p: Person, role: string, fn: (tx: AuditedTx) => Promise<T>, reason: 'first_save' | 'change' = 'first_save') =>
  runAudited(db.app, fx.ctx(p, role, reason === 'change' ? { reason: { kind: 'picklist', code: 'transcription-error' } } : {}), { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await fn(tx) }))
    .then(committed);

const verified = (signer: Person, role: string, target: Sealed) =>
  as(signer, role, (tx) => sign(tx, { signer: signer.id, target, meaning: 'Verified', authenticator: 'totp', group: randomUUID() }));

const effective = (record: RecordId) =>
  db.app.selectFrom('effective_version').select(['id', 'version_no']).where('record_id', '=', record).executeTakeFirst();
const pending = (record: RecordId) =>
  db.app.selectFrom('pending_version').select(['id', 'version_no']).where('record_id', '=', record).execute();

describe('a critical Recorded Value', () => {
  let value: RecordId;
  let v1: Sealed;
  let v2: Sealed;

  it('a second version is pending, and effective_version still returns v1', async () => {
    ({ record: value, v1 } = await as(fx.ann, 'Analyst', (tx) => newValue(tx, fx.labA, widget, 'prep.weight', true, '100.12')));
    v2 = await as(fx.bob, 'Reviewer', (tx) => recordValue(tx, fx.labA, value, '100.21'), 'change');
    expect(v2).toMatchObject({ versionNo: 2, reused: false });
    const row = await db.app.selectFrom('record_version').select('requires_approval').where('id', '=', v2.versionId).executeTakeFirstOrThrow();
    expect(row.requires_approval).toBe(true);
    expect(await effective(value)).toEqual({ id: v1.versionId, version_no: 1 });
    expect(await pending(value)).toEqual([{ id: v2.versionId, version_no: 2 }]);
  });

  it('LS001: the proposer\'s own Verified signature on the proposal is refused', async () => {
    await expectSqlState(verified(fx.bob, 'Reviewer', v2), 'LS001');
  });

  it('LS002: the typist\'s Verified on any version of the value is refused', async () => {
    await expectSqlState(verified(fx.ann, 'Analyst', v2), 'LS002');
    await expectSqlState(verified(fx.ann, 'Analyst', v1), 'LS002');
  });

  it('another person\'s Verified makes v2 effective', async () => {
    await verified(fx.cid, 'QA', v2);
    expect(await effective(value)).toEqual({ id: v2.versionId, version_no: 2 });
    expect(await pending(value)).toEqual([]);
  });

  it('a rejected proposal never becomes effective', async () => {
    const v3 = await as(fx.bob, 'Reviewer', (tx) => recordValue(tx, fx.labA, value, '100.30'), 'change');
    expect(await effective(value)).toMatchObject({ version_no: 2 });
    await as(fx.cid, 'QA', (tx) =>
      tx.db.insertInto('version_rejection').values({ ledger_id: fx.labA, version_id: v3.versionId, rejected_by: fx.cid.id, reason_code: 'wrong-item-selected' }).execute(), 'change');
    expect(await effective(value)).toMatchObject({ version_no: 2 });
    expect(await pending(value)).toEqual([]);
  });
});

describe('a non-critical Recorded Value', () => {
  it('a second version is effective at once', async () => {
    const { record, v1 } = await as(fx.ann, 'Analyst', (tx) => newValue(tx, fx.labA, widget, 'run.sequence', false, '7'));
    const v2 = await as(fx.ann, 'Analyst', (tx) => recordValue(tx, fx.labA, record, '8'), 'change');
    expect(v1.versionNo).toBe(1);
    const row = await db.app.selectFrom('record_version').select('requires_approval').where('id', '=', v2.versionId).executeTakeFirstOrThrow();
    expect(row.requires_approval).toBe(false);
    expect(await effective(record)).toEqual({ id: v2.versionId, version_no: 2 });
  });
});
