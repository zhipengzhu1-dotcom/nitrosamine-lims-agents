// Test-plan A2: no context, no write.
import { afterAll, beforeAll, describe, it } from 'vitest';
import { sql } from 'kysely';
import { contextRow, runAudited } from '../src/audited.ts';
import { ledgerOf } from '../src/ids.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState, installWidget, newWidget, withRawContext } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
});
afterAll(() => db.close());

describe('the audit context', () => {
  it('LA001: an INSERT with no lims.ctx is refused', async () => {
    await expectSqlState(
      db.app.insertInto('spec_gap').values({ feature: 'x', command: 'y', person_id: fx.ann.id, detail: {} }).execute(),
      'LA001',
    );
  });

  it('LA002: a context missing its reason is refused', async () => {
    const { reason_code: _dropped, ...noReason } = contextRow(fx.ctx(fx.adam, 'Admin'));
    await expectSqlState(
      withRawContext(db.app, noReason, (trx) =>
        trx.insertInto('spec_gap').values({ feature: 'x', command: 'y', person_id: fx.adam.id, detail: {} }).execute()),
      'LA002',
    );
  });

  it('LA003: reason "other" with no text is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.adam, 'Admin', { reason: { kind: 'picklist', code: 'other', text: '' } }), { kind: 'company' }, async (tx) => {
        await tx.db.insertInto('spec_gap').values({ feature: 'x', command: 'y', person_id: fx.adam.id, detail: {} }).execute();
        return { commit: null };
      }),
      'LA003',
    );
  });

  it('LA004: a role the person does not hold in the acting Lab is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'QA'), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await newWidget(tx, fx.labA, 'W');
        return { commit: null };
      }),
      'LA004',
    );
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.eve, 'Analyst', { actingLab: fx.labA, ledgers: [ledgerOf(fx.labA), ledgerOf(fx.labB)] }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await newWidget(tx, fx.labA, 'W');
        return { commit: null };
      }),
      'LA004',
    );
  });

  it('LA009: a person with no live session of their own is refused, even with a held role', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { session: null }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await newWidget(tx, fx.labA, 'W');
        return { commit: null };
      }),
      'LA009',
    );
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { session: fx.bob.session }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await newWidget(tx, fx.labA, 'W');
        return { commit: null };
      }),
      'LA009',
    );
  });

  it('LA009: a locked session cannot write', async () => {
    await runAudited(db.app, fx.ctx(fx.dee, 'LabManager', { reason: { kind: 'action' } }), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'manual' }).where('id', '=', fx.dee.session).execute();
      return { commit: null };
    });
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.dee, 'LabManager'), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await newWidget(tx, fx.labA, 'W');
        return { commit: null };
      }),
      'LA009',
    );
  });
});
