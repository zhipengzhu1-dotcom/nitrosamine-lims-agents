// What an Authorisation may be (decision 19, iso 6): valid for at most 12 months, and never a
// Released Authorisation for the Lab Manager of the same Lab.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { runAudited } from '../src/audited.ts';
import { ledgerOf } from '../src/ledgers.ts';
import { seedFixture, type Fixture, type Person } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
});
afterAll(() => db.close());

const draft = (grantee: Person, meaning: string, validFrom: string, validUntil: string) =>
  runAudited(db.app, fx.ctx(fx.cid, 'QA', { action: 'authorisation.grant' }), { kind: 'lab', labId: fx.labA }, async (tx) => {
    const id = randomUUID();
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id, kind: 'authorisation' }).execute();
    await tx.db.insertInto('authorisation').values({
      lab_id: fx.labA, id, person_id: grantee.id, meaning, scope: 'NA-LCMS-001', valid_from: sql`${validFrom}::date`, valid_until: sql`${validUntil}::date`,
    }).execute();
    return { commit: null };
  });

describe('an Authorisation is valid for at most 12 months', () => {
  it('accepts exactly 12 months, the last day exclusive', async () => {
    expect(await draft(fx.ann, 'Performed', '2026-10-01', '2027-10-01')).toMatchObject({ commit: null });
  });

  it('refuses one day more', async () => {
    await expectSqlState(draft(fx.ann, 'Performed', '2026-10-01', '2027-10-02'), '23514');
  });

  it('counts calendar months at a leap day', async () => {
    expect(await draft(fx.ann, 'Performed', '2028-02-29', '2029-02-28')).toMatchObject({ commit: null });
    await expectSqlState(draft(fx.ann, 'Performed', '2028-02-29', '2029-03-01'), '23514');
  });
});

describe('LI002: the Lab Manager never holds a Released Authorisation in that Lab', () => {
  it('refuses Released for the Lab Manager', async () => {
    await expectSqlState(draft(fx.dee, 'Released', '2026-10-01', '2027-10-01'), 'LI002');
  });

  it('allows the Lab Manager other meanings, and Released for anyone else', async () => {
    expect(await draft(fx.dee, 'Reviewed', '2026-10-01', '2027-10-01')).toMatchObject({ commit: null });
    expect(await draft(fx.bob, 'Released', '2026-10-01', '2027-10-01')).toMatchObject({ commit: null });
  });

  it('allows Released to someone who manages another Lab', async () => {
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin', { action: 'role.grant' }), { kind: 'company' }, async (tx) => {
      await tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: fx.eve.id, role: 'LabManager', lab_id: fx.labB }).execute();
      return { commit: null };
    });
    expect(await draft(fx.eve, 'Released', '2026-10-01', '2027-10-01')).toMatchObject({ commit: null });
  });
});
