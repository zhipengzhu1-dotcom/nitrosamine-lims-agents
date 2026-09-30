// Test-plan A6: Lab scoping in the database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { ledgerOf, type RecordId } from '../src/ids.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState, installWidget, widgets } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
});
afterAll(() => db.close());

describe('the database half of the Lab seam', () => {
  it('LA006: a record for Lab B written while acting in Lab A is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { ledgers: [ledgerOf(fx.labA), ledgerOf(fx.labB)] }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labB), id: randomUUID(), kind: 'widget' }).execute();
        return { commit: null };
      }),
      'LA006',
    );
  });

  it('LA006: a head row with lab_id of Lab B written while acting in Lab A is refused', async () => {
    const id = randomUUID() as RecordId;
    await runAudited(db.app, fx.seedCtx({ ledgers: [ledgerOf(fx.labB)] }), { kind: 'company' }, async (tx) => {
      await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labB), id, kind: 'widget' }).execute();
      return { commit: null };
    });
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { ledgers: [ledgerOf(fx.labA), ledgerOf(fx.labB)] }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await widgets(tx).insertInto('widget').values({ lab_id: fx.labB, id, name: 'B', state: 'Open' }).execute();
        return { commit: null };
      }),
      'LA006',
    );
  });

  it('LA005: a write to a ledger the context did not declare is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { ledgers: [ledgerOf(fx.labA)] }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('spec_gap').values({ feature: 'x', command: 'y', person_id: fx.ann.id, detail: {} }).execute();
        return { commit: null };
      }),
      'LA005',
    );
  });

  it('LA010: a context declaring a ledger with no chain is refused before any write', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { ledgers: [ledgerOf(fx.labA), randomUUID() as never] }), { kind: 'lab', labId: fx.labA }, async () => ({ commit: null })),
      'LA010',
    );
  });
});
