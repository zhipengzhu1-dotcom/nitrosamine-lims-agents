// The tables the API core adds in migration 0040: commit outcomes keyed per attempt, accounts
// that are enrolled or not, one-time enrolment links, alerts.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const hashOf = (s: string) => createHash('sha256').update(s).digest();

describe('commit_outcome', () => {
  it('one key may settle several refusals (one per input) but only ever one receipt', async () => {
    const key = randomUUID();
    const row = (outcome: 'receipt' | 'refusal', input: string) =>
      db.app.insertInto('commit_outcome').values({ commit_key: key, session_id: null, command: 'x', input_hash: hashOf(input), outcome, body: {} }).execute();
    await row('refusal', 'a');
    await row('refusal', 'b');
    await expectSqlState(row('refusal', 'b'), '23505');
    await row('receipt', 'c');
    await expectSqlState(row('receipt', 'd'), '23505');
  });
});

describe('account', () => {
  it('is enrolled with both a password and a TOTP secret, or with neither (LI002 as a CHECK)', async () => {
    const person = randomUUID();
    await expectSqlState(
      runAudited(db.app, fx.seedCtx(), { kind: 'company' }, async (tx) => {
        await tx.db.insertInto('person').values({ id: person, printed_name: 'Half Enrolled' }).execute();
        await tx.db.insertInto('account').values({ person_id: person, username: 'half', password_hash: 'argon2id$x', totp_secret_enc: null }).execute();
        return { commit: null };
      }),
      '23514',
    );
  });
});

describe('enrolment_link', () => {
  it('a token hash is unique, so a link can be presented to at most one person row', async () => {
    const token = hashOf('t');
    const link = (person: string) =>
      runAudited(db.app, fx.seedCtx(), { kind: 'company' }, async (tx) => {
        await tx.db.insertInto('enrolment_link').values({
          id: randomUUID(), person_id: person, username: `u-${person.slice(0, 8)}`, token_hash: token, created_by: fx.adam.id,
          expires_at: new Date(tx.dbNow.getTime() + 3600_000),
        }).execute();
        return { commit: null };
      });
    await link(fx.ann.id);
    await expectSqlState(link(fx.bob.id), '23505');
  });
});

describe('alert', () => {
  it('is insert-only: lims_app cannot update or delete one', async () => {
    await runAudited(db.app, fx.authCtx(), { kind: 'company' }, async (tx) => {
      await tx.db.insertInto('alert').values({ kind: 'lockout', person_id: fx.ann.id, detail: {} }).execute();
      return { commit: null };
    });
    await expectSqlState(db.app.updateTable('alert').set({ kind: 'lockout' }).execute(), '42501');
    await expectSqlState(db.app.deleteFrom('alert').execute(), '42501');
  });
});
