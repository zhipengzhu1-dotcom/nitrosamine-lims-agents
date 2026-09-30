// Test-plan A16: the scope seam (the test ADR 0002 asks for).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { runAudited } from '../src/audited.ts';
import { COMPANY_LEDGER } from '../src/ledgers.ts';
import type { CustomerId } from '@lims/domain/ids';
import { openRead, ScopeViolation, scopePlugin, type CompanyRead, type CustomerRead, type ReadDb } from '../src/scope.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { installWidget, newWidget, WIDGET_CLASSES, type TestDB } from './support.ts';

let db: TestDb;
let fx: Fixture;
let app: Kysely<TestDB>;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  app = db.app as unknown as Kysely<TestDB>;
  await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    await newWidget(tx, fx.labA, 'A1');
    await newWidget(tx, fx.labA, 'A2');
    return { commit: null };
  });
  await runAudited(db.app, fx.ctx(fx.eve, 'Analyst'), { kind: 'lab', labId: fx.labB }, async (tx) => {
    await newWidget(tx, fx.labB, 'B1');
    return { commit: null };
  });
});
afterAll(() => db.close());

const read = <S extends Parameters<typeof openRead>[1], T>(scope: S, fn: (q: ReadDb<TestDB>) => Promise<T>) =>
  openRead(db.app, scope, (q) => fn(q as unknown as ReadDb<TestDB>), WIDGET_CLASSES);

describe('the scope seam', () => {
  it('a company-scope handle naming a Lab table throws ScopeViolation before the query runs', async () => {
    await expect(read({ kind: 'company' }, (q) => q.selectFrom('widget').selectAll().execute())).rejects.toBeInstanceOf(ScopeViolation);
    await expect(read({ kind: 'company' }, (q) => q.selectFrom('person').innerJoin('widget', 'widget.id', 'person.id').selectAll().execute()))
      .rejects.toMatchObject({ table: 'widget', scope: 'company' });
  });

  it('a Lab A handle never returns Lab B rows: plain, aliased, joined, in a CTE, in a subquery', async () => {
    const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name).sort();
    const plain = await read({ kind: 'lab', labId: fx.labA }, (q) => q.selectFrom('widget').select('name').execute());
    expect(names(plain)).toEqual(['A1', 'A2']);
    const aliased = await read({ kind: 'lab', labId: fx.labB }, (q) => q.selectFrom('widget as w').select('w.name').execute());
    expect(names(aliased)).toEqual(['B1']);
    const joined = await read({ kind: 'lab', labId: fx.labA }, (q) =>
      q.selectFrom('record as r').innerJoin('widget as w', 'w.id', 'r.id').select('w.name').execute());
    expect(names(joined)).toEqual(['A1', 'A2']);
    const cte = await read({ kind: 'lab', labId: fx.labA }, (q) =>
      q.with('w', (qb) => qb.selectFrom('widget').select('name')).selectFrom('w').select('name').execute());
    expect(names(cte)).toEqual(['A1', 'A2']);
    const sub = await read({ kind: 'lab', labId: fx.labA }, (q) =>
      q.selectFrom('record').select('id').where('id', 'in', (qb) => qb.selectFrom('widget').select('id')).execute());
    expect(sub).toHaveLength(2);
    const leftJoined = await read({ kind: 'lab', labId: fx.labA }, (q) =>
      q.selectFrom('lab').leftJoin('widget', 'widget.lab_id', 'lab.id').select(['lab.code', 'widget.name']).execute());
    expect(leftJoined.map((r) => [r.code, r.name]).sort()).toEqual([['QC', null], ['RD', 'A1'], ['RD', 'A2']]);
  });

  it('ledger tables are filtered to the scope\'s ledgers', async () => {
    const labA = await read({ kind: 'lab', labId: fx.labA }, (q) => q.selectFrom('record').select('ledger_id').execute());
    expect(new Set(labA.map((r) => r.ledger_id))).toEqual(new Set([fx.labA]));
    const company = await read({ kind: 'company' }, (q) => q.selectFrom('record').select('ledger_id').execute());
    expect(company).toEqual([]);
    const entries = await read({ kind: 'company' }, (q) => q.selectFrom('audit_entry').select('ledger_id').distinct().execute());
    expect(entries).toEqual([{ ledger_id: COMPANY_LEDGER }]);
  });

  it('a customer handle can name only portal views', async () => {
    const customer = { kind: 'customer', customerId: 'c1' as CustomerId } as const;
    await expect(read(customer, (q) => q.selectFrom('person').selectAll().execute())).rejects.toBeInstanceOf(ScopeViolation);
    await expect(read(customer, (q) => q.selectFrom('record').selectAll().execute())).rejects.toBeInstanceOf(ScopeViolation);
    await expect(read(customer, (q) => q.selectFrom('widget').selectAll().execute())).rejects.toBeInstanceOf(ScopeViolation);
    const typed = (q: CustomerRead) =>
      // @ts-expect-error a Customer handle has no Lab or company table in its type
      q.selectFrom('person');
    const company = (q: CompanyRead) =>
      // @ts-expect-error a company handle has no Lab table in its type
      q.selectFrom('widget');
    void typed;
    void company;
  });

  it('a read handle has no write methods, and the transaction refuses a write anyway (25006)', async () => {
    const typed = (q: ReadDb<TestDB>) =>
      // @ts-expect-error ReadDb has no insertInto
      q.insertInto('spec_gap');
    void typed;
    await expect(openRead(db.app, { kind: 'company' }, (q) => sql`insert into lims.release (id) values ('x')`.execute(q as never)))
      .rejects.toBeInstanceOf(ScopeViolation);
    await expect(db.app.transaction().setAccessMode('read only').execute((trx) => trx.insertInto('release').values({ id: 'x' }).execute()))
      .rejects.toMatchObject({ code: '25006' });
  });

  it('a raw root query on a scoped handle is refused', async () => {
    const scoped = app.withPlugin(scopePlugin({ kind: 'lab', labId: fx.labA }, WIDGET_CLASSES));
    await expect(sql`select 1`.execute(scoped)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(scoped.selectFrom(sql`lims.widget`.as('w')).selectAll().execute()).rejects.toBeInstanceOf(ScopeViolation);
  });

  it('a scoped write handle cannot update another Lab\'s rows even when the query names them', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { reason: { kind: 'action' } }), { kind: 'lab', labId: fx.labA }, async (tx) => {
      const r = await (tx.db as unknown as Kysely<TestDB>).updateTable('widget').set({ state: 'Touched' }).where('lab_id', '=', fx.labB).executeTakeFirst();
      return { commit: Number(r.numUpdatedRows) };
    }, WIDGET_CLASSES);
    expect(out).toEqual({ commit: 0 });
  });
});
