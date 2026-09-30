import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { verifyChain } from '../src/doors.ts';
import { COMPANY_LEDGER } from '../src/ids.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
});
afterAll(() => db.close());

describe('the harness', () => {
  it('seeds two Labs and six people through the audited write path, on an intact company chain', async () => {
    const labs = await db.app.selectFrom('lab').select('code').orderBy('code').execute();
    expect(labs.map((l) => l.code)).toEqual(['QC', 'RD']);
    const chain = await verifyChain(db.app, COMPANY_LEDGER);
    expect(chain.headMatches).toBe(true);
    expect(chain.firstBreak).toBeNull();
    expect(chain.intactThrough).toBeGreaterThan(20);
  });

  it('rolls back what a refused transaction wrote', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('spec_gap').values({ feature: 'x', command: 'y', person_id: fx.ann.id, detail: {} }).execute();
      return { rollback: 'refused' as const };
    });
    expect(out).toEqual({ rollback: 'refused' });
    const gaps = await db.app.selectFrom('spec_gap').select('id').execute();
    expect(gaps).toHaveLength(0);
  });
});
