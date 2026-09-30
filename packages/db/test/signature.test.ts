// Test-plan A5: the signature binds to stored bytes.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { contextRow, runAudited } from '../src/audited.ts';
import { seal, sign, type Sealed } from '../src/doors.ts';
import { ledgerOf } from '../src/ledgers.ts';
import type { RecordId, Sha256Hex } from '@lims/domain/ids';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { bodyBytes, expectSqlState, installWidget, newWidget, reauth, committed } from './support.ts';

let db: TestDb;
let fx: Fixture;
let widget: RecordId;
let v1: Sealed;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    widget = await newWidget(tx, fx.labA, 'W');
    return { commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W' }), 'widget@1') };
  });
  v1 = committed(out);
});
afterAll(() => db.close());

const signAs = (who: Fixture['ann'], role: string, signer: Fixture['ann'], hash: Sha256Hex) =>
  runAudited(db.app, fx.ctx(who, role), { kind: 'lab', labId: fx.labA }, async (tx) => {
    await reauth(tx, signer.id);
    return { commit: await sign(tx, { signer: signer.id, target: { versionId: v1.versionId, hash }, meaning: 'Performed', authenticator: 'totp', group: randomUUID() }) };
  });

describe('signature binding', () => {
  it('a signature whose content_hash differs from the stored hash fails on the foreign key', async () => {
    const wrong = v1.hash.replace(/^../, v1.hash.startsWith('00') ? 'ff' : '00') as Sha256Hex;
    await expectSqlState(signAs(fx.ann, 'Analyst', fx.ann, wrong), '23503');
  });

  it('the same signature with the stored hash is accepted and carries the context\'s role, session and release', async () => {
    committed(await signAs(fx.ann, 'Analyst', fx.ann, v1.hash));
    const row = await db.app.selectFrom('signature').selectAll().where('record_version_id', '=', v1.versionId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ meaning: 'Performed', signer_person_id: fx.ann.id, username: 'ann', printed_name: 'Ann Analyst',
      role: 'Analyst', signer_lab_id: fx.labA, session_id: fx.ann.session, app_release: 'test', authenticator: 'totp' });
    expect(row.content_hash.toString('hex')).toBe(v1.hash);
  });

  it('LS000: a signature whose signer is not the audit context\'s person is refused', async () => {
    await expectSqlState(signAs(fx.bob, 'Reviewer', fx.ann, v1.hash), 'LS000');
  });

  it('a version\'s created_by is the context\'s person whatever the app passed', async () => {
    const seen = await runAudited(db.app, fx.ctx(fx.bob, 'Reviewer'), { kind: 'lab', labId: fx.labA }, async (tx) => ({
      commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W', note: 'second' }), 'widget@1'),
    }));
    const v2 = committed(seen);
    const row = await db.app.selectFrom('record_version').select(['created_by', 'app_release', 'version_no']).where('id', '=', v2.versionId).executeTakeFirstOrThrow();
    expect(row).toEqual({ created_by: fx.bob.id, app_release: 'test', version_no: 2 });

    const c = await db.superuser.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('lims.ctx', $1, true)`, [JSON.stringify(contextRow(fx.ctx(fx.ann, 'Analyst')))]);
      const direct = await c.query<{ created_by: string; app_release: string }>(
        `insert into lims.record_version (ledger_id, id, record_id, version_no, content, content_schema, created_by, app_release)
         values ($1, gen_random_uuid(), $2, 3, 'x'::bytea, 'widget@1', $3, 'forged') returning created_by, app_release`,
        [ledgerOf(fx.labA), widget, fx.eve.id]);
      expect(direct.rows[0]).toEqual({ created_by: fx.ann.id, app_release: 'test' });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('sealing identical bytes reuses the latest version instead of making a new one', async () => {
    const again = await runAudited(db.app, fx.ctx(fx.bob, 'Reviewer'), { kind: 'lab', labId: fx.labA }, async (tx) => ({
      commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W', note: 'second' }), 'widget@1'),
    }));
    expect(committed(again)).toMatchObject({ versionNo: 2, reused: true });
  });

  it('LS003: a meaning the record kind does not carry is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.cid, 'QA'), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await reauth(tx, fx.cid.id);
        return { commit: await sign(tx, { signer: fx.cid.id, target: v1, meaning: 'Acknowledged', authenticator: 'totp', group: randomUUID() }) };
      }),
      'LS003',
    );
  });
});

// Part 11 §11.200(a)(1): the database itself holds the proof that a signing re-authenticated.
describe('a signing re-authenticates in its own commit (LS005)', () => {
  const reviewed = (tx: Parameters<typeof sign>[0]) =>
    sign(tx, { signer: fx.bob.id, target: v1, meaning: 'Reviewed', authenticator: 'totp', group: randomUUID() });
  const bobCommit = <T>(commitKey: string, fn: (tx: Parameters<typeof sign>[0]) => Promise<T>) =>
    runAudited(db.app, fx.ctx(fx.bob, 'Reviewer', { commitKey: commitKey as never }), { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await fn(tx) }));
  const noReviewedSignature = async () =>
    expect(await db.app.selectFrom('signature').select('id').where('meaning', '=', 'Reviewed').execute()).toEqual([]);

  it('with no TOTP step consumed for the signer, the signature is refused', async () => {
    await expectSqlState(bobCommit(randomUUID(), reviewed), 'LS005');
    await noReviewedSignature();
  });

  it('a step consumed by an earlier attempt under the same commit key does not count', async () => {
    const key = randomUUID();
    committed(await bobCommit(key, (tx) => reauth(tx, fx.bob.id)));
    await expectSqlState(bobCommit(key, reviewed), 'LS005');
    await noReviewedSignature();
  });

  it("another commit's step, consumed after this transaction began, does not count", async () => {
    // The other attempt lands between this transaction's start and its chain locks, the one
    // window in which its row is newer than this transaction and visible to it.
    const trx = await db.app.startTransaction().setIsolationLevel('read committed').execute();
    try {
      await sql`select set_config('lims.ctx', ${JSON.stringify(contextRow(fx.ctx(fx.bob, 'Reviewer')))}, true)`.execute(trx);
      committed(await bobCommit(randomUUID(), (other) => reauth(other, fx.bob.id)));
      await sql`select lims.lock_chains()`.execute(trx);
      await expectSqlState(
        sql`select * from lims.sign(${fx.bob.id}, ${v1.versionId}, decode(${v1.hash}, 'hex'), 'Reviewed', 'totp', ${randomUUID()})`.execute(trx),
        'LS005',
      );
    } finally {
      await trx.rollback().execute();
    }
    await noReviewedSignature();
  });

  it('a step consumed for a login or an unlock does not count', async () => {
    await expectSqlState(bobCommit(randomUUID(), async (tx) => { await reauth(tx, fx.bob.id, 'login'); return reviewed(tx); }), 'LS005');
    await expectSqlState(bobCommit(randomUUID(), async (tx) => { await reauth(tx, fx.bob.id, 'unlock'); return reviewed(tx); }), 'LS005');
    await noReviewedSignature();
  });

  it("the step consumed in the signing's own commit is accepted, and names that commit", async () => {
    const key = randomUUID();
    const s = committed(await bobCommit(key, async (tx) => { await reauth(tx, fx.bob.id); return reviewed(tx); }));
    const sig = await db.app.selectFrom('signature').select('commit_key').where('id', '=', s.signatureId).executeTakeFirstOrThrow();
    const steps = await db.app.selectFrom('totp_step_used').select(['purpose', 'commit_key']).where('person_id', '=', fx.bob.id).where('commit_key', '=', key).execute();
    expect(sig.commit_key).toBe(key);
    expect(steps).toEqual([{ purpose: 'signing', commit_key: key }]);
  });
});
