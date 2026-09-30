// Test-plan A8: the release lock, over the cite closure.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited, type AuditedTx } from '../src/audited.ts';
import { lockReleased, seal, sign, standingFailures, versionStands, type Sealed } from '../src/doors.ts';
import type { RecordId } from '../src/ids.ts';
import { seedFixture, type Fixture, type Person } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { bodyBytes, expectSqlState, installWidget, newValue, newWidget, recordValue, widgets, committed } from './support.ts';

let db: TestDb;
let fx: Fixture;

let test: RecordId;
let run: RecordId;
let report: RecordId;
let weight: RecordId;
let runValue: RecordId;
let testV1: Sealed;
let runV1: Sealed;
let reportV1: Sealed;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  await as(fx.ann, 'Analyst', async (tx) => {
    test = await newWidget(tx, fx.labA, 'T');
    run = await newWidget(tx, fx.labA, 'R');
    report = await newWidget(tx, fx.labA, 'TR');
    const w = await newValue(tx, fx.labA, test, 'prep.weight', true, '100.12');
    weight = w.record;
    const rv = await newValue(tx, fx.labA, run, 'runcheck.value', true, '0.95');
    runValue = rv.record;
    runV1 = await seal(tx, run, bodyBytes({ kind: 'run' }, [rv.v1]), 'run@1', [rv.v1]);
    testV1 = await seal(tx, test, bodyBytes({ kind: 'test' }, [w.v1, runV1]), 'test@1', [w.v1, runV1]);
    reportV1 = await seal(tx, report, bodyBytes({ kind: 'report' }, [testV1]), 'report@1', [testV1]);
  });
});
afterAll(() => db.close());

async function as<T>(p: Person, role: string, fn: (tx: AuditedTx) => Promise<T>, reason: boolean | 'action' = false): Promise<T> {
  const ctx = fx.ctx(p, role, reason === 'action' ? { reason: { kind: 'action' } } : reason ? { reason: { kind: 'picklist', code: 'transcription-error' } } : {});
  return committed(await runAudited(db.app, ctx, { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await fn(tx) })));
}

describe('before release', () => {
  it('every sealed version stands, and the cites form the Merkle tree', async () => {
    for (const v of [testV1, runV1, reportV1]) expect(await versionStands(db.app, v.versionId)).toBe(true);
    const cites = await db.app.selectFrom('record_version_cite').select(['version_id', 'cited_version']).execute();
    expect(cites).toHaveLength(4);
  });

  it('LV002 and LV003: a cite must match the stored hash and appear in the content', async () => {
    const forged = { ...testV1, hash: testV1.hash.replace(/^./, testV1.hash.startsWith('0') ? '1' : '0') as never };
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => seal(tx, report, bodyBytes({ x: 1 }, [forged]), 'report@1', [forged])), 'LV002');
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => seal(tx, report, bodyBytes({ x: 2 }), 'report@1', [testV1])), 'LV003');
  });

  it('the pinned identity column may be set once from null, then never changes (LR002)', async () => {
    const pin = randomUUID();
    await as(fx.dee, 'LabManager', (tx) => widgets(tx).updateTable('widget').set({ spec_pin: pin }).where('id', '=', test).execute(), true);
    await expectSqlState(
      as(fx.dee, 'LabManager', (tx) => widgets(tx).updateTable('widget').set({ spec_pin: randomUUID() }).where('id', '=', test).execute(), true),
      'LR002',
    );
  });
});

describe('after release', () => {
  it('the Released signature locks the report, the Test, the Run and every value in the closure', async () => {
    const locked = await as(fx.cid, 'QA', async (tx) => {
      const s = await sign(tx, { signer: fx.cid.id, target: reportV1, meaning: 'Released', authenticator: 'totp', group: randomUUID() });
      await widgets(tx).updateTable('widget').set({ state: 'Reported' }).where('id', '=', test).execute();
      await widgets(tx).updateTable('widget').set({ state: 'Released' }).where('id', '=', report).execute();
      return lockReleased(tx, s.signatureId);
    }, 'action');
    expect(locked).toBe(5);
    const rows = await db.app.selectFrom('record_lock').select('record_id').execute();
    expect(new Set(rows.map((r) => r.record_id))).toEqual(new Set([report, test, run, weight, runValue]));
  });

  it('LR001: a new version of the Test, of a Recorded Value under it, of the Run\'s value, or of the report is refused', async () => {
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => seal(tx, test, bodyBytes({ kind: 'test', v: 2 }), 'test@1'), true), 'LR001');
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => recordValue(tx, fx.labA, weight, '100.13'), true), 'LR001');
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => recordValue(tx, fx.labA, runValue, '0.96'), true), 'LR001');
    await expectSqlState(as(fx.cid, 'QA', (tx) => seal(tx, report, bodyBytes({ kind: 'report', v: 2 }), 'report@1'), true), 'LR001');
  });

  it('LR001: a value added under a locked Test cannot get a version', async () => {
    await expectSqlState(as(fx.ann, 'Analyst', (tx) => newValue(tx, fx.labA, test, 'prep.dilution', true, '50.0')), 'LR001');
  });

  it('LR001: an in-place lifecycle change to a locked head is refused, and LR002 still guards identity', async () => {
    await expectSqlState(
      as(fx.dee, 'LabManager', (tx) => widgets(tx).updateTable('widget').set({ state: 'Reopened' }).where('id', '=', test).execute(), true),
      'LR001',
    );
    await expectSqlState(
      as(fx.dee, 'LabManager', (tx) => widgets(tx).updateTable('widget').set({ spec_pin: randomUUID() }).where('id', '=', test).execute(), true),
      'LR002',
    );
  });

  it('locking again is a no-op', async () => {
    const sig = await db.app.selectFrom('signature').select('id').where('meaning', '=', 'Released').executeTakeFirstOrThrow();
    expect(await as(fx.cid, 'QA', (tx) => lockReleased(tx, sig.id as never), true)).toBe(0);
  });

  it('LR003: only a Released signature locks', async () => {
    const sig = await as(fx.bob, 'Reviewer', (tx) => sign(tx, { signer: fx.bob.id, target: testV1, meaning: 'Reviewed', authenticator: 'totp', group: randomUUID() }));
    await expectSqlState(as(fx.bob, 'Reviewer', (tx) => lockReleased(tx, sig.signatureId), true), 'LR003');
  });
});

describe('version_stands, the recursive rule', () => {
  let test2: RecordId;
  let run2: RecordId;
  let runValue2: RecordId;
  let run2V1: Sealed;
  let test2V1: Sealed;

  it('a Test version stands while its cited Run version and values are effective', async () => {
    await as(fx.ann, 'Analyst', async (tx) => {
      test2 = await newWidget(tx, fx.labA, 'T2');
      run2 = await newWidget(tx, fx.labA, 'R2');
      const rv = await newValue(tx, fx.labA, run2, 'runcheck.value', true, '0.95');
      runValue2 = rv.record;
      run2V1 = await seal(tx, run2, bodyBytes({ kind: 'run' }, [rv.v1]), 'run@1', [rv.v1]);
      test2V1 = await seal(tx, test2, bodyBytes({ kind: 'test' }, [run2V1]), 'test@1', [run2V1]);
    });
    expect(await versionStands(db.app, test2V1.versionId)).toBe(true);
  });

  it('a pending change to a cited value leaves the version standing', async () => {
    await as(fx.bob, 'Reviewer', (tx) => recordValue(tx, fx.labA, runValue2, '0.97'), true);
    expect(await versionStands(db.app, run2V1.versionId)).toBe(true);
    expect(await versionStands(db.app, test2V1.versionId)).toBe(true);
  });

  it('an approved change to the Run\'s value unsigns the Run version and, through the cite, the Test version', async () => {
    const v2 = await db.app.selectFrom('pending_version').select(['id', 'content_hash']).where('record_id', '=', runValue2).executeTakeFirstOrThrow();
    await as(fx.cid, 'QA', (tx) =>
      sign(tx, { signer: fx.cid.id, target: { versionId: v2.id as never, hash: v2.content_hash!.toString('hex') as never }, meaning: 'Verified', authenticator: 'totp', group: randomUUID() }));
    expect(await versionStands(db.app, run2V1.versionId)).toBe(false);
    expect(await versionStands(db.app, test2V1.versionId)).toBe(false);
    const why = await standingFailures(db.app, test2V1.versionId);
    expect(why.map((f) => f.reason)).toEqual(['superseded']);
    expect(why[0]!.versionId).not.toBe(test2V1.versionId);
  });

  it('a value added under the Run after sealing unsigns the Run version', async () => {
    await as(fx.ann, 'Analyst', async (tx) => {
      const run3 = await newWidget(tx, fx.labA, 'R3');
      const v = await seal(tx, run3, bodyBytes({ kind: 'run' }), 'run@1');
      expect(await versionStands(tx.db, v.versionId)).toBe(true);
      await newValue(tx, fx.labA, run3, 'runcheck.value', true, '1.0');
      const why = await standingFailures(tx.db, v.versionId);
      expect(why.map((f) => f.reason.split(':')[0])).toEqual(['child-added']);
    });
  });
});
