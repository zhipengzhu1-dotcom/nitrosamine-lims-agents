// runAudited's attempt (a savepoint the command body runs in) and withContext (a write as another
// identity inside the same transaction). The commit pipeline settles a refusal with these: the
// effect rolls back to the savepoint, the rows that must survive are written as svc:auth, and one
// COMMIT ends it, all under the one advisory lock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { SERVICE, COMPANY_LEDGER } from '../src/ledgers.ts';
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

const gaps = () => db.app.selectFrom('spec_gap').select('feature').orderBy('id').execute();

describe('attempt', () => {
  it('a rollback result undoes only the attempt; writes after it still commit', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
      const inner = await tx.attempt(async () => {
        await tx.db.insertInto('spec_gap').values({ feature: 'inside', command: 'c', person_id: fx.adam.id, detail: {} }).execute();
        return { rollback: 'refused' as const };
      });
      await tx.db.insertInto('spec_gap').values({ feature: 'after', command: 'c', person_id: fx.adam.id, detail: {} }).execute();
      return { commit: inner };
    });
    expect(out).toEqual({ commit: { rollback: 'refused' } });
    expect((await gaps()).map((g) => g.feature)).toEqual(['after']);
  });

  it('a database error inside the attempt leaves the transaction usable and is rethrown to the body', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
      let code: string | null = null;
      try {
        await tx.attempt(async () => {
          await tx.db.insertInto('auth_event').values({ person_id: fx.adam.id, kind: 'bogus', counts_toward_lockout: false }).execute();
          return { commit: null };
        });
      } catch (e) {
        code = (e as { code?: string }).code ?? null;
      }
      await tx.db.insertInto('spec_gap').values({ feature: 'recovered', command: 'c', person_id: fx.adam.id, detail: {} }).execute();
      return { commit: code };
    });
    expect(out).toEqual({ commit: '23514' });
    expect((await gaps()).map((g) => g.feature)).toEqual(['after', 'recovered']);
  });

  it('a commit result keeps the attempt\'s writes', async () => {
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
      await tx.attempt(async () => {
        await tx.db.insertInto('spec_gap').values({ feature: 'kept', command: 'c', person_id: fx.adam.id, detail: {} }).execute();
        return { commit: null };
      });
      return { commit: null };
    });
    expect((await gaps()).map((g) => g.feature)).toEqual(['after', 'recovered', 'kept']);
  });
});

describe('withContext', () => {
  it('writes inside it are audited as the other identity, and the original context returns afterwards', async () => {
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
      await tx.withContext({ ...tx.ctx, person: SERVICE.auth.person, role: SERVICE.auth.role, session: null, ledgers: [COMPANY_LEDGER] }, async () => {
        await tx.db.insertInto('auth_event').values({ person_id: fx.ann.id, kind: 'login_fail', counts_toward_lockout: true }).execute();
      });
      await tx.db.insertInto('spec_gap').values({ feature: 'as-admin', command: 'c', person_id: fx.adam.id, detail: {} }).execute();
      return { commit: null };
    });
    const entries = await db.app.selectFrom('audit_entry').select(['table_name', 'person_id', 'role']).where('table_name', 'in', ['auth_event', 'spec_gap'])
      .orderBy('seq').execute();
    expect(entries.filter((e) => e.table_name === 'auth_event')).toEqual([{ table_name: 'auth_event', person_id: SERVICE.auth.person, role: 'svc:auth' }]);
    expect(entries.at(-1)).toEqual({ table_name: 'spec_gap', person_id: fx.adam.id, role: 'Admin' });
  });

  it('the switched context is validated like any other: a role the identity lacks is LA004', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
        await tx.withContext({ ...tx.ctx, person: SERVICE.auth.person, role: 'svc:seed', session: null }, async () => {
          await tx.db.insertInto('auth_event').values({ person_id: fx.ann.id, kind: 'login_fail', counts_toward_lockout: true }).execute();
        });
        return { commit: null };
      }),
      'LA004',
    );
  });
});
