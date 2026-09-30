// Test-plan A9: Admin exclusivity.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
});
afterAll(() => db.close());

const grant = (person: string, role: string, lab: string | null) =>
  runAudited(db.app, fx.ctx(fx.adam, 'Admin', { action: 'role.grant' }), { kind: 'company' }, async (tx) => {
    await tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: person, role, lab_id: lab }).execute();
    return { commit: null };
  });

describe('LI001', () => {
  it('granting Admin to an Analyst is refused', async () => {
    await expectSqlState(grant(fx.ann.id, 'Admin', null), 'LI001');
  });

  it('granting Analyst to an Admin is refused', async () => {
    await expectSqlState(grant(fx.adam.id, 'Analyst', fx.labA), 'LI001');
  });

  it('a revoked business role no longer blocks Admin', async () => {
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin', { action: 'role.revoke', reason: { kind: 'action' } }), { kind: 'company' }, async (tx) => {
      await tx.db.updateTable('role_grant').set({ revoked_at: tx.dbNow }).where('person_id', '=', fx.eve.id).execute();
      return { commit: null };
    });
    await grant(fx.eve.id, 'Admin', null);
  });
});
