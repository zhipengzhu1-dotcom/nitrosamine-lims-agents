// The sample chain's own database rules: a Customer writes only its own rows into a Lab, and
// numbers are gapless per Lab, kind and year.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { runAudited, type AuditContext } from '../src/audited.ts';
import { seal, sign } from '../src/doors.ts';
import { COMPANY_LEDGER, ledgerOf } from '../src/ledgers.ts';
import type { CustomerId, PersonId, RecordId, SessionId } from '@lims/domain/ids';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { bodyBytes, committed, expectSqlState, reauth } from './support.ts';

let db: TestDb;
let fx: Fixture;
const customerA = randomUUID() as CustomerId;
const customerB = randomUUID() as CustomerId;
const product = randomUUID();
const productB = randomUUID();
const submission = randomUUID();
const submissionB = randomUUID();
let cara: { id: PersonId; session: SessionId };

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  const substance = randomUUID();
  cara = { id: randomUUID() as PersonId, session: randomUUID() as SessionId };
  committed(await runAudited(db.app, fx.seedCtx(), { kind: 'company' }, async (tx) => {
    await tx.db.insertInto('customer').values([{ id: customerA, code: 'ACME', name: 'Acme Pharma' }, { id: customerB, code: 'BETA', name: 'Beta Labs' }]).execute();
    await tx.db.insertInto('substance').values({ id: substance, cas: '0-00-0', name: 'Fictionib', kind: 'api' }).execute();
    await tx.db.insertInto('product').values([
      { id: product, customer_id: customerA, code: 'FIC-01', name: 'Fictionib API', api_substance_id: substance },
      { id: productB, customer_id: customerB, code: 'BET-01', name: 'Betanib API', api_substance_id: substance },
    ]).execute();
    await tx.db.insertInto('person').values({ id: cara.id, printed_name: 'Cara Customer' }).execute();
    await tx.db.insertInto('account').values({ person_id: cara.id, username: 'cara', password_hash: 'x', totp_secret_enc: Buffer.from('x') }).execute();
    await tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: cara.id, role: 'CustomerUser', customer_id: customerA }).execute();
    return { commit: null };
  }));
  committed(await runAudited(db.app, fx.ctx(fx.dee, 'LabManager'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    await tx.db.insertInto('submission').values([
      { id: submission, customer_id: customerA, number: 'SUB-2026-000001', entered_by: cara.id, submitted_at: sql`clock_timestamp()` },
      { id: submissionB, customer_id: customerB, number: 'SUB-2026-000002', entered_by: cara.id, submitted_at: sql`clock_timestamp()` },
    ]).execute();
    return { commit: null };
  }));
  committed(await runAudited(db.app, fx.authCtx(), { kind: 'company' }, async (tx) => {
    await tx.db.insertInto('session').values({
      id: cara.session, token_hash: createHash('sha256').update(cara.session).digest(), person_id: cara.id, customer_id: customerA,
      workstation: 'portal', absolute_end_at: new Date(tx.dbNow.getTime() + 3600_000),
    }).execute();
    await tx.db.insertInto('session_activity').values({ session_id: cara.session, last_activity_at: sql`clock_timestamp()` }).execute();
    return { commit: null };
  }));
});
afterAll(() => db.close());

/** Cara acting for Customer A, writing into Lab A the way submission.submit does. */
const asCara = (over: Partial<AuditContext> = {}): AuditContext => ({
  person: cara.id, role: 'CustomerUser', actingLab: null, customer: customerA, action: 'submission.submit', reason: { kind: 'first_save' },
  appRelease: 'test', session: cara.session, commitKey: randomUUID() as never, ledgers: [ledgerOf(fx.labA), COMPANY_LEDGER], ...over,
});

const sampleRow = (customer: CustomerId) => ({
  lab_id: fx.labA, id: randomUUID(), customer_id: customer, submission_id: customer === customerA ? submission : submissionB,
  product_id: customer === customerA ? product : productB, lot_number: 'L1', state: 'Expected' as const,
});

describe('a Customer writing into a Lab', () => {
  it('may insert a Sample and a Test that name its own Customer, and the bare record row the Test needs', async () => {
    const sample = sampleRow(customerA);
    const test = randomUUID();
    const method = await methodId();
    committed(await runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('sample').values(sample).execute();
      await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id: test, kind: 'test' }).execute();
      await tx.db.insertInto('test').values({ lab_id: fx.labA, id: test, customer_id: customerA, sample_id: sample.id, seq: 1, method_id: method, state: 'Requested' }).execute();
      return { commit: null };
    }));
    const trail = await db.app.selectFrom('audit_entry').select(['table_name', 'role', 'customer_id', 'acting_lab_id']).where('ledger_id', '=', ledgerOf(fx.labA)).where('person_id', '=', cara.id).execute();
    expect(trail).toEqual(expect.arrayContaining([
      { table_name: 'sample', role: 'CustomerUser', customer_id: customerA, acting_lab_id: null },
      { table_name: 'test', role: 'CustomerUser', customer_id: customerA, acting_lab_id: null },
    ]));
  });

  it("LA006: a Sample naming another Customer is refused", async () => {
    await expectSqlState(
      runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('sample').values(sampleRow(customerB)).execute();
        return { commit: null };
      }),
      'LA006',
    );
  });

  it('LA006: a Customer never changes a Lab row in place, even its own', async () => {
    const sample = sampleRow(customerA);
    committed(await runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('sample').values(sample).execute();
      return { commit: null };
    }));
    await expectSqlState(
      runAudited(db.app, asCara({ reason: { kind: 'picklist', code: 'other', text: 'wrong lot' } }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.updateTable('sample').set({ lot_number: 'L2' }).where('id', '=', sample.id).execute();
        return { commit: null };
      }),
      'LA006',
    );
  });

  it('LA006: the bare record row a Customer may write is a Test\'s with no parent, never another kind\'s', async () => {
    const insert = (row: { kind: string; parent_id?: string }) => runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id: randomUUID(), ...row }).execute();
      return { commit: null };
    });
    await expectSqlState(insert({ kind: 'run' }), 'LA006');
    const test = await db.app.selectFrom('test').select('id').where('customer_id', '=', customerA).executeTakeFirstOrThrow();
    await expectSqlState(insert({ kind: 'test', parent_id: test.id }), 'LA006');
  });

  it('a Customer\'s Sample or Test never points at another Customer\'s Product or Sample: the schema refuses (23503)', async () => {
    await expectSqlState(
      runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('sample').values({ ...sampleRow(customerA), product_id: productB }).execute();
        return { commit: null };
      }),
      '23503',
    );
    const sampleB = sampleRow(customerB);
    committed(await runAudited(db.app, fx.ctx(fx.dee, 'LabManager'), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('sample').values(sampleB).execute();
      return { commit: null };
    }));
    const method = await methodId();
    await expectSqlState(
      runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
        const test = randomUUID();
        await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id: test, kind: 'test' }).execute();
        await tx.db.insertInto('test').values({ lab_id: fx.labA, id: test, customer_id: customerA, sample_id: sampleB.id, seq: 1, method_id: method, state: 'Requested' }).execute();
        return { commit: null };
      }),
      '23503',
    );
  });

  it('LA006: a Customer\'s Sample arrives Expected, with no Lab number and no receipt', async () => {
    const insert = (row: Parameters<ReturnType<typeof db.app.insertInto<'sample'>>['values']>[0]) =>
      runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('sample').values(row).execute();
        return { commit: null };
      });
    await expectSqlState(insert({ ...sampleRow(customerA), number: 'RD-S-2026-0001' }), 'LA006');
    await expectSqlState(insert({ ...sampleRow(customerA), state: 'Received', received_at: sql`clock_timestamp()`, received_by: fx.ann.id }), 'LA006');
  });

  it('LA006: a Customer\'s Test is Requested, with no pin, number or assignee', async () => {
    const method = await methodId();
    const methodVersion = await methodVersionId(method);
    const sample = sampleRow(customerA);
    committed(await runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('sample').values(sample).execute();
      return { commit: null };
    }));
    for (const over of [{ state: 'Accepted' as const }, { number: 'RD-T-2026-0001' }, { assigned_analyst: fx.ann.id }, { method_version_id: methodVersion }, { gxp_class: 'non-GMP' as const }]) {
      await expectSqlState(
        runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
          const test = randomUUID();
          await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id: test, kind: 'test' }).execute();
          await tx.db.insertInto('test').values({ lab_id: fx.labA, id: test, customer_id: customerA, sample_id: sample.id, seq: 2, method_id: method, state: 'Requested', ...over }).execute();
          return { commit: null };
        }),
        'LA006',
      );
    }
  });

  it('a Customer\'s download event names the downloader and its own report; LA006 for anyone or any report else', async () => {
    const version = await releasedReportVersion(customerA, submission);
    const versionB = await releasedReportVersion(customerB, submissionB);
    const download = (person: PersonId, of: string) => runAudited(db.app, asCara({ action: 'report.download' }), { kind: 'lab', labId: fx.labA }, async (tx) => {
      await tx.db.insertInto('report_download').values({ lab_id: fx.labA, id: randomUUID(), customer_id: customerA, report_version_id: of, person_id: person }).execute();
      return { commit: null };
    });
    await expectSqlState(download(fx.ann.id, version), 'LA006');
    await expectSqlState(download(cara.id, versionB), 'LA006');
    committed(await download(cara.id, version));
    expect(await db.app.selectFrom('report_download').select(['person_id', 'report_version_id']).where('customer_id', '=', customerA).execute()).toEqual([{ person_id: cara.id, report_version_id: version }]);
  });

  it('LA006: a Customer cannot insert a Lab row that carries no customer_id', async () => {
    await expectSqlState(
      runAudited(db.app, asCara(), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await tx.db.insertInto('equipment').values({ lab_id: fx.labA, id: randomUUID(), code: 'LCMS-9', kind: 'LC-MS/MS', fitness_status: 'In use' }).execute();
        return { commit: null };
      }),
      'LA006',
    );
  });
});

describe('numbering', () => {
  it('next_number is gapless per scope, kind and year, and independent across them', async () => {
    const next = async (scope: string, kind: string, year: number) =>
      (await sql<{ n: number }>`select lims.next_number(${scope}, ${kind}, ${year}) as n`.execute(db.app)).rows[0]!.n;
    expect([await next('RD', 'sample', 2026), await next('RD', 'sample', 2026), await next('RD', 'sample', 2026)]).toEqual([1, 2, 3]);
    expect(await next('RD', 'sample', 2027)).toBe(1);
    expect(await next('RD', 'report', 2026)).toBe(1);
    expect(await next('QC', 'sample', 2026)).toBe(1);
  });
});

async function methodVersionId(method: string): Promise<string> {
  const id = randomUUID();
  committed(await runAudited(db.app, fx.seedCtx(), { kind: 'company' }, async (tx) => {
    await tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id, kind: 'method_version' }).execute();
    await tx.db.insertInto('method_version').values({ id, method_id: method, version: 1, data: {} }).execute();
    return { commit: null };
  }));
  return id;
}

/** A Customer's Released Test Report version with its issued PDF, the row a download event references. */
async function releasedReportVersion(customer: CustomerId, of: string): Promise<string> {
  const report = randomUUID() as RecordId;
  const pdf = Buffer.from(`%PDF-1.7 fictional ${report}`);
  const sha = createHash('sha256').update(pdf).digest();
  const sealed = committed(await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(fx.labA), id: report, kind: 'test_report' }).execute();
    await tx.db.insertInto('test_report').values({ lab_id: fx.labA, id: report, customer_id: customer, submission_id: of, number: `RD-TR-${report.slice(0, 8)}`, state: 'Released' }).execute();
    return { commit: await seal(tx, report, bodyBytes({ kind: 'report', report }), 'test_report@1') };
  }));
  committed(await runAudited(db.app, fx.ctx(fx.cid, 'QA', { reason: { kind: 'action' } }), { kind: 'lab', labId: fx.labA }, async (tx) => {
    await reauth(tx, fx.cid.id);
    const s = await sign(tx, { signer: fx.cid.id, target: sealed, meaning: 'Released', authenticator: 'totp', group: randomUUID() });
    await tx.db.insertInto('blob').values({ ledger_id: ledgerOf(fx.labA), sha256: sha, size_bytes: pdf.length, media_type: 'application/pdf' }).execute();
    await tx.db.insertInto('report_issue').values({ lab_id: fx.labA, report_version_id: sealed.versionId, released_signature: s.signatureId, pdf_sha256: sha, renderer_release: 'test' }).execute();
    return { commit: null };
  }));
  return sealed.versionId;
}

async function methodId(): Promise<string> {
  const existing = await db.app.selectFrom('method').select('id').executeTakeFirst();
  if (existing) return existing.id;
  const id = randomUUID();
  committed(await runAudited(db.app, fx.seedCtx(), { kind: 'company' }, async (tx) => {
    await tx.db.insertInto('method').values({ id, number: 'NA-LCMS-001', title: 'Nitrosamines by LC-MS/MS' }).execute();
    return { commit: null };
  }));
  return id;
}
