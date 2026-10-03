import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { audited, type DB, postgresFault } from '@lims/db';
import { changeStepRoute, routes, stepRoute, unsignedMeanings } from '@lims/domain';
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import {
  type Account,
  type Client,
  ok,
  onLabClock,
  refusedWith as refusedOver,
  signatureOf,
  startApi,
  toMillis,
} from './harness.ts';

const api = await startApi('lims_api_critical_data_changes_test');
const [cora, samir, lena, ana, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('rui'),
  api.person('quinn'),
];
const dana = await api.addPerson('dana.analyst-reviewer', ['Analyst', 'Reviewer'], { trained: true });
const rhea = await api.addPerson('rhea.reviewer-qa', ['Reviewer', 'QA']);
const pat = await api.addPerson('pat.operator', ['PlatformOperator']);
const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  dana: await api.login(dana),
  rhea: await api.login(rhea),
  pat: await api.login(pat),
};

const saved = '0.0300';

/** Walks a fresh Test to SubmittedForReview: its Result saved and signed Performed by `analyst`. */
async function performedTest(analyst: Account = ana, client: Client = as.ana) {
  const commit = () => randomUUID();
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: commit(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { commitKey: commit(), testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { commitKey: commit(), testId, input: { assigneeId: analyst.id } }));
  const input = {
    analyte: 'NDMA',
    value: saved,
    unit: 'ppm',
    injectionSequenceRef: 'SEQ-2026-0042',
    notebookRef: 'NB-RD-0001-012',
    performedOn: '2026-09-30',
  };
  const signature = await signatureOf(client, testId, analyst);
  ok(await client.call(stepRoute('enterResult'), { commitKey: commit(), testId, input, signature }));
  const { id: resultId } = await api.db
    .selectFrom('result')
    .select('id')
    .where('testId', '=', testId)
    .executeTakeFirstOrThrow();
  return { testId, resultId };
}

const reasonOf = async (step: string, label: string) =>
  (
    await api.db
      .selectFrom('picklistReason')
      .select('id')
      .where('step', '=', step)
      .where('label', '=', label)
      .executeTakeFirstOrThrow()
  ).id;

const reason = {
  transcription: await reasonOf('proposeChange', 'Transcription error'),
  proposeOther: await reasonOf('proposeChange', 'Other'),
  rawData: await reasonOf('rejectChange', 'Not supported by the raw data'),
  inError: await reasonOf('withdrawChange', 'Proposed in error'),
};

const acting = <T>(db: Kysely<DB>, person: Account, role: string, fn: (tx: Transaction<DB>) => Promise<T>) =>
  audited(db, { actor: `person:${person.username}`, role, reason: 'Act on a Critical Data Change' }, fn);

type ChangeRow = Insertable<DB['criticalDataChange']>;
type DecisionRow = Insertable<DB['criticalDataChangeDecision']>;

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Proposes through a plain insert, as the app role may: the database stamps the proposer, time and Record Version. */
function propose(
  test: { testId: string; resultId: string },
  change: Partial<ChangeRow> = {},
  by = ana,
  db = api.db,
  role = 'Analyst',
) {
  const row = {
    labId: api.labId,
    testId: test.testId,
    resultId: test.resultId,
    field: 'value',
    oldValue: saved,
    newValue: '0.0310',
    reasonId: reason.transcription,
    ...change,
  };
  const columns = Object.keys(row).map((column) => sql.id(snake(column)));
  return acting(db, by, role, async (tx) => {
    const { rows } = await sql<{ id: string }>`insert into lims.critical_data_change (${sql.join(columns)})
      values (${sql.join(Object.values(row))}) returning id`.execute(tx);
    return rows[0]?.id ?? assert.fail('the proposal returns its id');
  });
}

function decide(
  changeId: string,
  testId: string,
  decision: Partial<DecisionRow> & Pick<DecisionRow, 'outcome'>,
  by: Account,
  role: string,
  db = api.db,
) {
  return acting(db, by, role, (tx) =>
    tx
      .insertInto('criticalDataChangeDecision')
      .values({ labId: api.labId, changeId, testId, ...decision })
      .execute(),
  );
}

type Meaning = Insertable<DB['reauthentication']>['meaning'];

/** The Signature `by` gives, through lims.sign, on the record's latest Record Version, inside `tx`. */
async function signThrough(
  tx: Transaction<DB>,
  by: Account,
  meaning: Meaning,
  recordTable: 'critical_data_change' | 'test' | 'test_report' | 'test_review',
  recordId: string,
): Promise<string> {
  const { id: sessionId } = await tx
    .selectFrom('session')
    .select('id')
    .where('personId', '=', by.id)
    .where('endedAt', 'is', null)
    .orderBy('createdAt', 'desc')
    .executeTakeFirstOrThrow();
  const { id: proof } = await tx
    .insertInto('reauthentication')
    .values({ labId: api.labId, sessionId, personId: by.id, meaning, authenticator: 'Password' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const seen = await tx
    .selectFrom('recordVersion')
    .select(['id', sql<string>`encode(content_hash, 'hex')`.as('hash')])
    .where('recordTable', '=', recordTable)
    .where('recordId', '=', recordId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
  const { version } = await tx
    .selectFrom('signatureStatement')
    .select('version')
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
  const { rows } = await sql<{ id: string }>`select lims.sign(${proof}, ${sessionId}, ${recordTable}, ${recordId},
    ${seen.id}, decode(${seen.hash}, 'hex'), ${version}, ${meaning}, 'test-release') as id`.execute(tx);
  return rows[0]?.id ?? assert.fail('lims.sign returns the Signature');
}

const approve = (changeId: string, testId: string, by = rui) =>
  acting(api.db, by, 'Reviewer', async (tx) => {
    const signatureId = await signThrough(tx, by, 'Approved', 'critical_data_change', changeId);
    await tx
      .insertInto('criticalDataChangeDecision')
      .values({ labId: api.labId, changeId, testId, outcome: 'Approved', signatureId })
      .execute();
  });

interface Refusal {
  code: string;
  constraint: string | null;
  column: string | null;
  message: string;
}

async function refusal(write: Promise<unknown>): Promise<Refusal> {
  try {
    await write;
  } catch (error) {
    const fault = postgresFault(error);
    let e: unknown = error;
    while (e instanceof Error && e.cause instanceof Error) e = e.cause;
    if (fault && e instanceof Error)
      return { code: fault.sqlstate, constraint: fault.constraint, column: fault.column, message: e.message };
    throw error;
  }
  return assert.fail('the database accepted the write');
}

async function refusedWith(write: Promise<unknown>, message: string, code = 'LA017'): Promise<void> {
  const error = await refusal(write);
  assert.deepEqual([error.code, error.message], [code, message]);
}

const resultValue = async (resultId: string) =>
  (await api.db.selectFrom('result').select('value').where('id', '=', resultId).executeTakeFirstOrThrow()).value;

describe('a Critical Data Change is proposed by the person acting, on the value as it stands, one at a time', () => {
  it('a proposal stamps its proposer, its time and the Test Record Version it was made on', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    const row = await api.db
      .selectFrom('criticalDataChange as c')
      .innerJoin('recordVersion as v', (j) =>
        j.onRef('v.labId', '=', 'c.labId').onRef('v.id', '=', 'c.proposedOnVersion'),
      )
      .select(['c.proposedBy', 'v.recordTable', 'v.recordId'])
      .where('c.id', '=', changeId)
      .executeTakeFirstOrThrow();
    assert.deepEqual([row.proposedBy, row.recordTable, row.recordId], [ana.id, 'test', test.testId]);
  });

  it('a proposal that names someone else as its proposer is refused', async () => {
    await refusedWith(
      propose(await performedTest(), { proposedBy: lena.id }, ana, api.superuser),
      'a Critical Data Change is proposed by the person acting',
    );
  });

  it("a proposal whose old value is not the Result's current value is refused", async () => {
    await refusedWith(
      propose(await performedTest(), { oldValue: '0.0299' }),
      "the old value is not the Result's current value",
      'LA019',
    );
  });

  it('a second proposal on a Result while one is pending is refused', async () => {
    const test = await performedTest();
    await propose(test);
    await refusedWith(
      propose(test, { newValue: '0.0320' }),
      'a Critical Data Change on this Result is already pending',
      'LA018',
    );
  });

  it("a reason from another step's picklist, Other without its text, and text on any other reason are refused", async () => {
    const test = await performedTest();
    await refusedWith(
      propose(test, { reasonId: reason.rawData }),
      'the reason is not one the proposeChange step offers',
    );
    await refusedWith(propose(test, { reasonId: reason.proposeOther }), 'the reason Other needs its text');
    await refusedWith(propose(test, { reasonText: 'Typed it wrong' }), 'only the reason Other takes text');
    await propose(test, { reasonId: reason.proposeOther, reasonText: 'Wrong dilution factor typed' });
  });
});

describe('only the assigned Analyst, acting as Analyst, proposes, on a Test in SubmittedForReview or Reviewed state', () => {
  it('a proposal from another Analyst, or from the assigned Analyst acting in another role, is refused', async () => {
    const test = await performedTest(dana, as.dana);
    const message = 'a Critical Data Change is proposed by the assigned Analyst, acting as Analyst';
    await refusedWith(propose(test, {}, ana), message);
    await refusedWith(propose(test, {}, dana, api.db, 'Reviewer'), message);
  });

  it('a proposal on a Reported Test is refused', async () => {
    const test = await performedTest();
    const sign = async (client: Client, step: 'review' | 'release', by: Account) =>
      ok(
        await client.call(stepRoute(step), {
          commitKey: randomUUID(),
          testId: test.testId,
          ...(await api.press(client, step, test.testId, {}, by)),
        }),
      );
    await sign(as.rui, 'review', rui);
    await sign(as.quinn, 'release', quinn);
    await refusedWith(
      propose(test),
      'a Critical Data Change is proposed on a Test in SubmittedForReview or Reviewed state, not Reported',
      'LA020',
    );
  });

  it('a withdrawal from the proposer acting in another role is refused', async () => {
    const test = await performedTest(dana, as.dana);
    const changeId = await propose(test, {}, dana);
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, dana, 'Reviewer'),
      'a Critical Data Change is withdrawn by its proposer, acting as Analyst',
    );
  });
});

describe('a Critical Data Change is decided once: withdrawn by its proposer, approved or rejected by a Reviewer', () => {
  it('a decision that names someone else as its decider is refused', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await refusedWith(
      decide(
        changeId,
        test.testId,
        { outcome: 'Withdrawn', reasonId: reason.inError, decidedBy: ana.id },
        rui,
        'Reviewer',
        api.superuser,
      ),
      'a Critical Data Change is decided by the person acting',
    );
  });

  it('only the proposer withdraws, and a withdrawn change takes no second decision', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, rui, 'Reviewer'),
      'only the proposer withdraws a Critical Data Change',
    );
    await decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, ana, 'Analyst');
    const error = await refusal(
      decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.rawData }, rui, 'Reviewer'),
    );
    assert.deepEqual([error.code, error.constraint], ['23505', 'critical_data_change_decision_lab_id_change_id_key']);
    assert.equal(await resultValue(test.resultId), saved, 'a withdrawn change leaves the value as it was');
  });

  it('the proposer neither approves nor rejects their own change', async () => {
    const test = await performedTest(dana, as.dana);
    const changeId = await propose(test, {}, dana);
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.rawData }, dana, 'Reviewer'),
      'the proposer cannot reject their own Critical Data Change',
    );
    await refusedWith(
      approve(changeId, test.testId, dana),
      'the proposer cannot approve their own Critical Data Change',
    );
  });

  it('the Analyst who signed Performed neither approves nor rejects a correction proposed by someone else', async () => {
    const test = await performedTest(dana, as.dana);
    await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Reassign a performed Test, which no step does' },
      (tx) => tx.updateTable('test').set({ assigneeId: ana.id }).where('id', '=', test.testId).execute(),
    );
    const changeId = await propose(test, {}, ana);
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.rawData }, dana, 'Reviewer'),
      'the Analyst who signed Performed cannot reject a correction to the Result',
    );
    await refusedWith(
      approve(changeId, test.testId, dana),
      'the Analyst who signed Performed cannot approve a correction to the Result',
    );
  });

  it('a rejection is refused from anyone not acting as a Reviewer, and takes a rejectChange reason', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.rawData }, lena, 'LabManager'),
      'a Critical Data Change is rejected by a Reviewer, who could approve it',
    );
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.inError }, rui, 'Reviewer'),
      'the reason is not one the rejectChange step offers',
    );
    await decide(changeId, test.testId, { outcome: 'Rejected', reasonId: reason.rawData }, rui, 'Reviewer');
    assert.equal(await resultValue(test.resultId), saved, 'a rejected change leaves the value as it was');
  });

  it('an approval that names a Signature other than its own Approved one on the change is refused', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    const { id: performed } = await api.db
      .selectFrom('signature')
      .select('id')
      .where('meaning', '=', 'Performed')
      .where('personId', '=', ana.id)
      .executeTakeFirstOrThrow();
    await refusedWith(
      decide(changeId, test.testId, { outcome: 'Approved', signatureId: performed }, rui, 'Reviewer'),
      'an approval names the Approved Signature its approver gave on the proposal in this transaction',
    );
  });

  it('an approval is refused once the Test changed after the proposal', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Change the Test after a proposal' },
      (tx) => tx.updateTable('result').set({ notebookRef: 'NB-RD-0001-013' }).where('id', '=', test.resultId).execute(),
    );
    await refusedWith(
      approve(changeId, test.testId),
      'the Test changed after the Critical Data Change was proposed, so the proposer withdraws it and proposes it again',
      'LA019',
    );
  });

  it('an approval makes the new value current, under a Record Version of the change that its Signature binds', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await approve(changeId, test.testId);
    assert.equal(await resultValue(test.resultId), '0.0310');
    const signed = await api.db
      .selectFrom('signature as s')
      .innerJoin('recordVersion as v', (j) =>
        j.onRef('v.labId', '=', 's.labId').onRef('v.id', '=', 's.recordVersionId'),
      )
      .select([
        's.personId',
        'v.recordTable',
        sql<string>`convert_from(v.content, 'UTF8')::jsonb ->> 'newValue'`.as('newValue'),
      ])
      .where('v.recordId', '=', changeId)
      .where('s.meaning', '=', 'Approved')
      .executeTakeFirstOrThrow();
    assert.deepEqual(signed, { personId: rui.id, recordTable: 'critical_data_change', newValue: '0.0310' });
  });
});

describe('a Critical Data Change is signed only Approved, by a Reviewer acting as Reviewer', () => {
  const notOnTests = 'a Test and the Test Report built on it are never signed Approved';

  it('an Approved Signature on a Test or its Test Report, and a Reviewed Signature on a change, are refused', async () => {
    const test = await performedTest();
    const onTest = await refusal(
      acting(api.db, rui, 'Reviewer', (tx) => signThrough(tx, rui, 'Approved', 'test', test.testId)),
    );
    assert.deepEqual([onTest.code, onTest.message], ['LA010', notOnTests]);
    const { id: reportId } = await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Issue a Test Report to sign Approved' },
      (tx) =>
        tx
          .insertInto('testReport')
          .values({ labId: api.labId, testId: test.testId, number: `CDC-A${test.testId.slice(0, 5)}` })
          .returning('id')
          .executeTakeFirstOrThrow(),
    );
    const onReport = await refusal(
      acting(api.db, rui, 'Reviewer', (tx) => signThrough(tx, rui, 'Approved', 'test_report', reportId)),
    );
    assert.deepEqual([onReport.code, onReport.message], ['LA010', notOnTests]);
    const changeId = await propose(test);
    const onChange = await refusal(
      acting(api.db, rui, 'Reviewer', (tx) => signThrough(tx, rui, 'Reviewed', 'critical_data_change', changeId)),
    );
    assert.deepEqual([onChange.code, onChange.message], ['LA010', 'a Critical Data Change is signed only Approved']);
  });

  for (const [role, person] of [
    ['QA', quinn],
    ['PlatformOperator', pat],
  ] as const)
    it(`an Approved Signature on a change given in the ${role} role is refused`, async () => {
      const test = await performedTest();
      const changeId = await propose(test);
      const error = await refusal(
        acting(api.db, person, role, (tx) => signThrough(tx, person, 'Approved', 'critical_data_change', changeId)),
      );
      assert.deepEqual(
        [error.code, error.message],
        ['LA010', `a Critical Data Change is signed Approved in the Reviewer role, not ${role}`],
      );
    });

  it('an approval written by its Reviewer acting in another role is refused', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await refusedWith(
      acting(api.db, rhea, 'Reviewer', async (tx) => {
        const signatureId = await signThrough(tx, rhea, 'Approved', 'critical_data_change', changeId);
        await sql`select set_config('lims.role', 'QA', true)`.execute(tx);
        await tx
          .insertInto('criticalDataChangeDecision')
          .values({ labId: api.labId, changeId, testId: test.testId, outcome: 'Approved', signatureId })
          .execute();
      }),
      'a Critical Data Change is approved by a Reviewer, acting as Reviewer',
    );
  });
});

describe('a decision takes the Lab chain before it is written, so two decisions at once take turns', () => {
  it('a withdrawal that starts while a rejection holds the chain waits, then meets the decision already made', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    let withdrawal: Promise<Refusal> | undefined;
    await acting(api.db, rui, 'Reviewer', async (tx) => {
      await sql`select lims.lock_chains(${api.labId}::text)`.execute(tx);
      withdrawal = refusal(
        decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, ana, 'Analyst'),
      );
      await api.untilWaitingOnLocks(1);
      await tx
        .insertInto('criticalDataChangeDecision')
        .values({ labId: api.labId, changeId, testId: test.testId, outcome: 'Rejected', reasonId: reason.rawData })
        .execute();
    });
    const error = (await withdrawal) ?? assert.fail('the withdrawal was started');
    assert.deepEqual([error.code, error.constraint], ['23505', 'critical_data_change_decision_lab_id_change_id_key']);
    const { outcome } = await api.db
      .selectFrom('criticalDataChangeDecision')
      .select('outcome')
      .where('changeId', '=', changeId)
      .executeTakeFirstOrThrow();
    assert.equal(outcome, 'Rejected');
  });
});

describe('no Test step signs while a Critical Data Change on one of its Results is pending, even past the registry', () => {
  it('a Reviewed Signature on the Test Review is refused while a change is pending, and given once it is decided', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    const { input } = await api.reviewPress(as.rui, test.testId, rui);
    const review = () =>
      acting(api.db, rui, 'Reviewer', (tx) => signThrough(tx, rui, 'Reviewed', 'test_review', input.review));
    const error = await refusal(review());
    assert.deepEqual(
      [error.code, error.message],
      ['LA010', 'a Test is not signed while a Critical Data Change on one of its Results is pending'],
    );
    await decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, ana, 'Analyst');
    assert.ok(await review(), 'the Reviewed Signature is given once the change is decided');
  });

  it('a Released Signature on the Test Report built on the Test is refused while a change is pending', async () => {
    // No step issues a Test Report while a change can be pending, so the owner issues one beside a pending change.
    const test = await performedTest();
    await propose(test);
    const { id: reportId } = await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Issue a Test Report beside a pending change' },
      (tx) =>
        tx
          .insertInto('testReport')
          .values({ labId: api.labId, testId: test.testId, number: `CDC-R${test.testId.slice(0, 5)}` })
          .returning('id')
          .executeTakeFirstOrThrow(),
    );
    const error = await refusal(
      acting(api.db, quinn, 'QA', (tx) => signThrough(tx, quinn, 'Released', 'test_report', reportId)),
    );
    assert.deepEqual(
      [error.code, error.message],
      ['LA010', 'a Test is not signed while a Critical Data Change on one of its Results is pending'],
    );
  });
});

describe('a corrected Result is reviewed and released only once it is signed Performed, even past the registry', () => {
  it('a Reviewed or Released Signature after an approval is refused until Performed is signed on the corrected Result', async () => {
    const test = await performedTest();
    await approve(await propose(test), test.testId);
    // No step issues a Test Report before review, so the owner issues one to show the Released refusal.
    const { id: reportId } = await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Issue a Test Report on a corrected Result' },
      (tx) =>
        tx
          .insertInto('testReport')
          .values({ labId: api.labId, testId: test.testId, number: `CDC-P${test.testId.slice(0, 5)}` })
          .returning('id')
          .executeTakeFirstOrThrow(),
    );
    const { input } = await api.reviewPress(as.dana, test.testId, dana);
    const review = () =>
      acting(api.db, dana, 'Reviewer', (tx) => signThrough(tx, dana, 'Reviewed', 'test_review', input.review));
    const release = () =>
      acting(api.db, quinn, 'QA', (tx) => signThrough(tx, quinn, 'Released', 'test_report', reportId));
    for (const [meaning, sign] of [
      ['Reviewed', review],
      ['Released', release],
    ] as const) {
      const error = await refusal(sign());
      assert.deepEqual(
        [error.code, error.message],
        [
          'LA010',
          `a Test and the Test Report built on it are signed ${meaning} only once Performed is signed on the corrected Result`,
        ],
      );
    }
    await acting(api.db, ana, 'Analyst', (tx) => signThrough(tx, ana, 'Performed', 'test', test.testId));
    assert.ok(await review(), 'the Reviewed Signature is given on the corrected Result once it is signed Performed');
    assert.ok(await release(), 'the Released Signature is given on the Test Report once Performed covers the Result');
  });
});

describe("a Result's value changes only through an approved Critical Data Change, even for the superuser", () => {
  it('a direct change of a saved value is refused', async () => {
    const test = await performedTest();
    await refusedWith(
      audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Change a value directly' }, (tx) =>
        tx.updateTable('result').set({ value: '0.0310' }).where('id', '=', test.resultId).execute(),
      ),
      "a Result's value changes only through an approved Critical Data Change",
    );
  });

  it('a Result removed and entered again with a new value, or truncated, is refused', async () => {
    const test = await performedTest();
    const svc = { actor: 'svc:test', role: 'system', reason: 'Replace a Result' };
    const replaced = await refusal(
      audited(api.superuser, svc, async (tx) => {
        const row = await tx.selectFrom('result').selectAll().where('id', '=', test.resultId).executeTakeFirstOrThrow();
        await tx.deleteFrom('result').where('id', '=', test.resultId).execute();
        await tx
          .insertInto('result')
          .values({ ...row, value: '0.0310' })
          .execute();
      }),
    );
    assert.deepEqual([replaced.code, replaced.message], ['LA002', 'result rows are never removed']);
    const truncated = await refusal(audited(api.superuser, svc, (tx) => sql`truncate lims.result cascade`.execute(tx)));
    assert.deepEqual([truncated.code, truncated.message], ['LA002', 'result rows are never removed']);
    assert.equal(await resultValue(test.resultId), saved);
  });

  it('an approval from an earlier transaction is not replayed to change the value again', async () => {
    const test = await performedTest();
    const first = await propose(test);
    await approve(first, test.testId);
    const back = await propose(test, { oldValue: '0.0310', newValue: saved });
    await approve(back, test.testId);
    await refusedWith(
      audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Replay an approval' }, async (tx) => {
        await sql`select lims.set_this_transaction('lims.critical_data_change', ${first})`.execute(tx);
        await tx.updateTable('result').set({ value: '0.0310' }).where('id', '=', test.resultId).execute();
      }),
      "a Result's value changes only through an approved Critical Data Change",
    );
  });

  it('a Result moved to another Test is refused', async () => {
    const test = await performedTest();
    const { testId: other } = ok(
      await as.cora.call(stepRoute('submit'), {
        commitKey: randomUUID(),
        input: { methodId: api.methodId, description: 'Sertraline HCl tablets (fictional)' },
      }),
    );
    await refusedWith(
      audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Move a Result' }, (tx) =>
        tx.updateTable('result').set({ testId: other }).where('id', '=', test.resultId).execute(),
      ),
      'a Result stays on the Test it was entered on',
    );
  });

  it('a proposal and its decision are never changed or removed', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    await decide(changeId, test.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, ana, 'Analyst');
    const svc = { actor: 'svc:test', role: 'system', reason: 'Rewrite a decided proposal' };
    for (const table of ['critical_data_change', 'critical_data_change_decision'] as const)
      for (const statement of [
        sql`update ${sql.table(`lims.${table}`)} set lab_id = lab_id`,
        sql`delete from ${sql.table(`lims.${table}`)}`,
        sql`truncate ${sql.table(`lims.${table}`)} cascade`,
      ]) {
        const error = await refusal(audited(api.superuser, svc, (tx) => statement.execute(tx)));
        assert.deepEqual([error.code, error.message], ['LA002', `${table} rows are never changed or removed`]);
      }
  });

  it('a picklist reason, a proposal and a decision written without an actor, a role and a reason are refused', async () => {
    const test = await performedTest();
    const changeId = await propose(test);
    // The proposal and decision triggers would refuse first, so they are off and the capture is what refuses.
    for (const statements of [
      [sql`insert into lims.picklist_reason (step, position, label) values ('proposeChange', 9, 'Weighing error')`],
      [
        sql`alter table lims.critical_data_change disable trigger propose`,
        sql`insert into lims.critical_data_change (lab_id, test_id, result_id, field, old_value, new_value, reason_id,
            proposed_by, proposed_on_version)
          select lab_id, test_id, result_id, field, old_value, '0.0320', reason_id, proposed_by, proposed_on_version
            from lims.critical_data_change where id = ${changeId}`,
      ],
      [
        sql`alter table lims.critical_data_change_decision disable trigger decide`,
        sql`insert into lims.critical_data_change_decision (lab_id, change_id, test_id, outcome, decided_by, reason_id)
          values (${api.labId}, ${changeId}, ${test.testId}, 'Withdrawn', ${ana.id}, ${reason.inError})`,
      ],
    ]) {
      const error = await refusal(
        api.superuser.transaction().execute(async (tx) => {
          for (const statement of statements) await statement.execute(tx);
        }),
      );
      assert.deepEqual([error.code, error.message], ['LA001', 'an audited write needs an actor, a role and a reason']);
    }
  });
});

describe('the database refuses a malformed picklist reason, proposal or decision, even with its triggers off', async () => {
  const pending = await performedTest();
  const pendingId = await propose(pending);
  const decided = await performedTest();
  const decidedId = await propose(decided);
  await decide(decidedId, decided.testId, { outcome: 'Withdrawn', reasonId: reason.inError }, ana, 'Analyst');
  const { id: decisionId } = await api.db
    .selectFrom('criticalDataChangeDecision')
    .select('id')
    .where('changeId', '=', decidedId)
    .executeTakeFirstOrThrow();
  const { proposedOnVersion } = await api.db
    .selectFrom('criticalDataChange')
    .select('proposedOnVersion')
    .where('id', '=', pendingId)
    .executeTakeFirstOrThrow();
  const approved = await performedTest();
  const approvedId = await propose(approved);
  await approve(approvedId, approved.testId);
  const { signatureId: approval } = await api.db
    .selectFrom('criticalDataChangeDecision')
    .select('signatureId')
    .where('changeId', '=', approvedId)
    .executeTakeFirstOrThrow();
  const nowhere = randomUUID();

  const base = {
    picklist_reason: { id: randomUUID(), step: 'proposeChange', position: 9, label: 'Weighing error' },
    critical_data_change: {
      labId: api.labId,
      id: randomUUID(),
      testId: decided.testId,
      resultId: decided.resultId,
      field: 'value',
      oldValue: saved,
      newValue: '0.0310',
      reasonId: reason.transcription,
      reasonText: null,
      proposedBy: ana.id,
      proposedAt: sql`clock_timestamp()`,
      proposedOnVersion,
    },
    critical_data_change_decision: {
      labId: api.labId,
      id: randomUUID(),
      changeId: pendingId,
      testId: pending.testId,
      outcome: 'Withdrawn',
      decidedBy: ana.id,
      decidedAt: sql`clock_timestamp()`,
      reasonId: reason.inError,
      reasonText: null,
      signatureId: null,
    },
  } as const;
  type Table = keyof typeof base;
  const tableNames: Table[] = ['picklist_reason', 'critical_data_change', 'critical_data_change_decision'];

  /** Inserts the table's base row with `change` applied, every user trigger off, and rolls the insert back. */
  const insertion = (table: Table, change: Record<string, unknown>) =>
    refusal(
      api.superuser.transaction().execute(async (tx) => {
        await sql`alter table ${sql.table(`lims.${table}`)} disable trigger user`.execute(tx);
        const row = { ...base[table], ...change };
        const columns = Object.keys(row).map((column) => sql.id(snake(column)));
        await sql`insert into ${sql.table(`lims.${table}`)} (${sql.join(columns)})
                  values (${sql.join(Object.values(row))})`.execute(tx);
        throw new Error(`the database accepted a ${table} row`);
      }),
    );

  it('the base rows are accepted with the triggers off, so each refusal below comes from its one change', async () => {
    for (const table of tableNames) {
      const error = await insertion(table, {}).catch((e: unknown) => e);
      assert.ok(error instanceof Error && error.message === `the database accepted a ${table} row`, String(error));
    }
  });

  const required: Record<Table, string[]> = {
    picklist_reason: ['id', 'step', 'position', 'label', 'dataClass'],
    critical_data_change: [
      'labId',
      'id',
      'testId',
      'resultId',
      'field',
      'oldValue',
      'newValue',
      'reasonId',
      'proposedBy',
      'proposedAt',
      'proposedOnVersion',
      'dataClass',
    ],
    critical_data_change_decision: [
      'labId',
      'id',
      'changeId',
      'testId',
      'outcome',
      'decidedBy',
      'decidedAt',
      'dataClass',
    ],
  };
  it('every required field refuses a null', async () => {
    for (const table of tableNames)
      for (const column of required[table]) {
        const error = await insertion(table, { [column]: null });
        assert.deepEqual([error.code, error.column], ['23502', snake(column)], `${table}.${column}: ${error.message}`);
      }
  });

  const cases: [Table, Record<string, unknown>, string, string][] = [
    ['picklist_reason', { step: 'Not a step' }, '23514', 'picklist_reason_step_check'],
    ['picklist_reason', { position: 0 }, '23514', 'picklist_reason_position_check'],
    ['picklist_reason', { label: ' ' }, '23514', 'picklist_reason_label_check'],
    ['picklist_reason', { id: reason.transcription }, '23505', 'picklist_reason_pkey'],
    ['picklist_reason', { position: 1 }, '23505', 'picklist_reason_step_position_key'],
    ['picklist_reason', { label: 'Other' }, '23505', 'picklist_reason_step_label_key'],
    ['critical_data_change', { field: 'unit' }, '23514', 'critical_data_change_field_check'],
    ['critical_data_change', { oldValue: 'about 0.03' }, '23514', 'critical_data_change_old_value_check'],
    ['critical_data_change', { newValue: '3e-2' }, '23514', 'critical_data_change_new_value_check'],
    ['critical_data_change', { reasonText: ' ' }, '23514', 'critical_data_change_reason_text_check'],
    ['critical_data_change', { newValue: saved }, '23514', 'critical_data_change_values_differ_check'],
    ['critical_data_change', { labId: nowhere }, '23503', 'critical_data_change_lab_id_fkey'],
    ['critical_data_change', { testId: nowhere }, '23503', 'critical_data_change_lab_id_test_id_fkey'],
    ['critical_data_change', { resultId: nowhere }, '23503', 'critical_data_change_lab_id_result_id_fkey'],
    ['critical_data_change', { proposedOnVersion: nowhere }, '23503', 'critical_data_change_proposed_on_version_fkey'],
    ['critical_data_change', { reasonId: nowhere }, '23503', 'critical_data_change_reason_id_fkey'],
    ['critical_data_change', { proposedBy: nowhere }, '23503', 'critical_data_change_proposed_by_fkey'],
    ['critical_data_change', { id: pendingId }, '23505', 'critical_data_change_pkey'],
    ['critical_data_change_decision', { reasonText: ' ' }, '23514', 'critical_data_change_decision_reason_text_check'],
    ['critical_data_change_decision', { signatureId: nowhere }, '23514', 'decision_signed_only_if_approved_check'],
    ['critical_data_change_decision', { reasonId: null }, '23514', 'decision_reason_unless_approved_check'],
    [
      'critical_data_change_decision',
      { outcome: 'Approved', reasonId: null, signatureId: approval, reasonText: 'Checked against the raw data' },
      '23514',
      'decision_text_unless_approved_check',
    ],
    [
      'critical_data_change_decision',
      { changeId: nowhere },
      '23503',
      'critical_data_change_decision_lab_id_change_id_test_id_fkey',
    ],
    ['critical_data_change_decision', { labId: nowhere }, '23503', 'critical_data_change_decision_lab_id_fkey'],
    ['critical_data_change_decision', { decidedBy: nowhere }, '23503', 'critical_data_change_decision_decided_by_fkey'],
    ['critical_data_change_decision', { reasonId: nowhere }, '23503', 'critical_data_change_decision_reason_id_fkey'],
    [
      'critical_data_change_decision',
      { outcome: 'Approved', reasonId: null, signatureId: nowhere },
      '23503',
      'critical_data_change_decision_lab_id_signature_id_fkey',
    ],
    ['critical_data_change_decision', { id: decisionId }, '23505', 'critical_data_change_decision_pkey'],
    [
      'critical_data_change_decision',
      { changeId: decidedId, testId: decided.testId },
      '23505',
      'critical_data_change_decision_lab_id_change_id_key',
    ],
  ];
  it('each check, key and reference refuses the row that breaks it', async () => {
    for (const [table, change, code, constraint] of cases) {
      const error = await insertion(table, change);
      assert.deepEqual([error.code, error.constraint], [code, constraint], `${constraint}: ${error.message}`);
    }
  });
});

/** The Approved signing body `by` sends from the Test page: the pending change's Record Version as the page shows it. */
async function approvalOf(client: Client, testId: string, by: Account) {
  const view = ok(await client.call(routes.test, { id: testId }));
  const change = view.changes.find((c) => c.state === 'Pending') ?? assert.fail('the Test shows its pending change');
  const { version, contentHash } = change.recordVersion;
  const statementVersion = view.statement?.version ?? assert.fail('a signer sees the signature statement');
  return {
    changeId: change.id,
    signature: {
      username: by.username,
      password: by.password,
      recordVersion: { version, contentHash },
      statementVersion,
    },
  };
}

const proposeOver = (testId: string, client: Client = as.ana, newValue = '0.0310') =>
  client.call(changeStepRoute('proposeChange'), { testId, newValue, reasonId: reason.transcription });

describe('the bench proposes, approves, rejects and withdraws a Critical Data Change over HTTP', () => {
  it('each step offers its own picklist of reasons, ending with Other, which takes text', async () => {
    const reasons = ok(await as.ana.call(routes.reasons, { step: 'proposeChange' }));
    assert.equal(reasons.length, 3);
    assert.deepEqual(reasons.map((r) => [r.label, r.needsText]).at(-1), ['Other', true]);
    assert.ok(reasons.slice(0, -1).every((r) => !r.needsText));
  });

  it('the assigned Analyst proposes; the Test then shows it Pending and every signing waits for its decision', async () => {
    const { testId } = await performedTest();
    const { changeId } = ok(await proposeOver(testId));
    const anaView = ok(await as.ana.call(routes.test, { id: testId }));
    assert.deepEqual(
      anaView.changes.map((c) => [c.id, c.state, c.oldValue, c.newValue, c.reason]),
      [[changeId, 'Pending', saved, '0.0310', 'Transcription error']],
    );
    assert.deepEqual(anaView.changeNext, ['withdrawChange']);
    const ruiView = ok(await as.rui.call(routes.test, { id: testId }));
    assert.deepEqual(ruiView.changeNext, ['approveChange', 'rejectChange']);
    assert.equal(ruiView.next, null);
    refusedOver(await signStep(as.rui, 'review', testId, rui), 'changePending');
    refusedOver(await proposeOver(testId, as.ana, '0.0320'), 'changePending');
  });

  it('a Reviewer approves with an Approved Signature, and the Result then holds the new value', async () => {
    const { testId, resultId } = await performedTest();
    ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    assert.equal(await resultValue(resultId), '0.0310');
    const view = ok(await as.rui.call(routes.test, { id: testId }));
    const approved =
      view.signatures.find((s) => s.meaning === 'Approved') ?? assert.fail('the Approved Signature shows');
    assert.deepEqual(
      view.changes.map((c) => [c.state, c.decidedBy]),
      [['Approved', approved.signer]],
    );
    assert.equal(approved.record, 'Critical Data Change');
    assert.equal(approved.unsigned, false);
    assert.equal(view.signatures.find((s) => s.meaning === 'Performed')?.unsigned, true);
    const trail = ok(await as.rui.call(routes.testTrail, { id: testId })).entries.map((e) => e.raw.table);
    assert.ok(trail.includes('critical_data_change') && trail.includes('critical_data_change_decision'));
    assert.ok(trail.filter((t) => t === 'signature').length >= 2, 'the Approved Signature is on the Test trail');
  });

  it('an approval signed on sight of another Record Version of the change is refused', async () => {
    const { testId } = await performedTest();
    ok(await proposeOver(testId));
    const approval = await approvalOf(as.rui, testId, rui);
    const stale = { ...approval.signature, recordVersion: { ...approval.signature.recordVersion, version: 2 } };
    refusedOver(
      await as.rui.call(changeStepRoute('approveChange'), { testId, changeId: approval.changeId, signature: stale }),
      'recordChanged',
    );
  });

  it('a Reviewer rejects with a reason, the proposer withdraws, and neither touches the saved value', async () => {
    const { testId, resultId } = await performedTest();
    const { changeId } = ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('rejectChange'), { testId, changeId, reasonId: reason.rawData }));
    const { changeId: second } = ok(await proposeOver(testId));
    ok(await as.ana.call(changeStepRoute('withdrawChange'), { testId, changeId: second, reasonId: reason.inError }));
    assert.equal(await resultValue(resultId), saved);
    const view = ok(await as.ana.call(routes.test, { id: testId }));
    assert.deepEqual(
      view.changes.map((c) => [c.state, c.decisionReason]),
      [
        ['Rejected', 'Not supported by the raw data'],
        ['Withdrawn', 'Proposed in error'],
      ],
    );
    assert.deepEqual(view.changeNext, ['proposeChange']);
  });

  it('the registry and the database refuse the wrong person, a decided change and a reason without its text', async () => {
    const { testId } = await performedTest();
    const withdraw = (client: Client, changeId: string) =>
      client.call(changeStepRoute('withdrawChange'), { testId, changeId, reasonId: reason.inError });
    refusedOver(await proposeOver(testId, as.rui), 'role');
    refusedOver(
      await as.ana.call(changeStepRoute('proposeChange'), {
        testId,
        newValue: '0.0310',
        reasonId: reason.proposeOther,
      }),
      'guard',
    );
    refusedOver(await proposeOver(testId, as.ana, saved), 'guard');
    const { changeId } = ok(await proposeOver(testId));
    refusedOver(await withdraw(as.rui, changeId), 'role');
    refusedOver(await withdraw(as.dana, changeId), 'guard');
    ok(await withdraw(as.ana, changeId));
    refusedOver(await withdraw(as.ana, changeId), 'state');
  });
});

/**
 * Sends `presses` while the Lab chain is held, so each passes the registry and then waits in the database; `meanwhile`
 * writes under the held chain before it is let go, so a press can meet what the registry did not see.
 */
async function pastTheRegistry<T>(
  presses: (() => Promise<T>)[],
  meanwhile: (tx: Transaction<DB>) => Promise<unknown> = async () => {},
): Promise<T[]> {
  let pressed: Promise<T[]> | undefined;
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Hold the Lab chain' }, async (tx) => {
    await sql`select lims.lock_chains(${api.labId}::text)`.execute(tx);
    pressed = Promise.all(presses.map((press) => press()));
    await api.untilWaitingOnLocks(presses.length);
    await meanwhile(tx);
  });
  return pressed ?? assert.fail('the presses were sent');
}

describe("a refusal only the database sees reaches the bench as the registry's own kind", () => {
  it('a second proposal sent at once is refused as changePending', async () => {
    const { testId } = await performedTest();
    const answers = await pastTheRegistry([() => proposeOver(testId), () => proposeOver(testId, as.ana, '0.0320')]);
    const [first, second] = answers.sort((a, b) => Number(b.kind === 'reply') - Number(a.kind === 'reply'));
    assert.ok(first && second);
    ok(first);
    refusedOver(second, 'changePending');
  });

  it('a proposal that meets a Test released meanwhile is refused as state', async () => {
    const { testId } = await performedTest();
    const [answer] = await pastTheRegistry([() => proposeOver(testId)], (tx) =>
      tx.updateTable('test').set({ state: 'Reported' }).where('id', '=', testId).execute(),
    );
    assert.ok(answer);
    refusedOver(answer, 'state');
  });

  it('an approval that meets a Test changed after the proposal is refused as recordChanged', async () => {
    const test = await performedTest();
    ok(await proposeOver(test.testId));
    await audited(
      api.superuser,
      { actor: 'svc:test', role: 'system', reason: 'Change the Test after a proposal' },
      (tx) => tx.updateTable('result').set({ notebookRef: 'NB-RD-0001-013' }).where('id', '=', test.resultId).execute(),
    );
    const approval = await approvalOf(as.rui, test.testId, rui);
    assert.equal(
      refusedOver(
        await as.rui.call(changeStepRoute('approveChange'), { testId: test.testId, ...approval }),
        'recordChanged',
      ),
      'The Critical Data Change was refused: the Test changed after the Critical Data Change was proposed, so the ' +
        'proposer withdraws it and proposes it again.',
    );
  });
});

/** Takes a signing step on the Test as `by`, signing the Record Version the page shows now; a review first saves a full Test Review. */
const signStep = async (
  client: Client,
  step: 'signPerformedAgain' | 'review' | 'release',
  testId: string,
  by: Account,
) =>
  client.call(stepRoute(step), { commitKey: randomUUID(), testId, ...(await api.press(client, step, testId, {}, by)) });

describe('an approval on a Reviewed Test sends it back for review before it is released', () => {
  it('the Test returns to SubmittedForReview, release waits for a new review, and someone else then releases', async () => {
    const { testId } = await performedTest();
    ok(await signStep(as.rui, 'review', testId, rui));
    ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    const view = ok(await as.quinn.call(routes.test, { id: testId }));
    assert.equal(view.test.state, 'SubmittedForReview');
    assert.ok(
      view.signatures.filter((s) => s.meaning === 'Reviewed').every((s) => s.unsigned),
      'the first Reviewed Signature no longer covers the Test',
    );
    refusedOver(await signStep(as.quinn, 'release', testId, quinn), 'state');
    ok(await signStep(as.ana, 'signPerformedAgain', testId, ana));
    assert.equal(ok(await as.dana.call(routes.test, { id: testId })).next, 'review');
    ok(await signStep(as.dana, 'review', testId, dana));
    ok(await signStep(as.quinn, 'release', testId, quinn));
    assert.equal(ok(await as.quinn.call(routes.test, { id: testId })).test.state, 'Reported');
  });

  it('neither the Reviewer who approved the change nor one who reviewed an earlier Record Version releases', async () => {
    const { testId } = await performedTest();
    ok(await signStep(as.rhea, 'review', testId, rhea));
    ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    ok(await signStep(as.ana, 'signPerformedAgain', testId, ana));
    ok(await signStep(as.dana, 'review', testId, dana));
    assert.equal(
      refusedOver(await signStep(as.rhea, 'release', testId, rhea), 'guard'),
      'QA cannot release a Test they performed or reviewed.',
    );

    const second = await performedTest();
    ok(await proposeOver(second.testId));
    const approval = await approvalOf(as.rhea, second.testId, rhea);
    ok(await as.rhea.call(changeStepRoute('approveChange'), { testId: second.testId, ...approval }));
    ok(await signStep(as.ana, 'signPerformedAgain', second.testId, ana));
    ok(await signStep(as.rui, 'review', second.testId, rui));
    assert.equal(
      refusedOver(await signStep(as.rhea, 'release', second.testId, rhea), 'guard'),
      'QA cannot release a Test after approving a Critical Data Change on it.',
    );
    ok(await signStep(as.quinn, 'release', second.testId, quinn));
  });
});

describe('after an approval the assigned Analyst signs the corrected Result Performed before review and release', () => {
  it('review waits for the Performed signing, and the released Test Report then names no meaning as unsigned', async () => {
    const { testId } = await performedTest();
    ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    assert.equal(ok(await as.dana.call(routes.test, { id: testId })).next, null, 'a Reviewer has no step yet');
    assert.equal(
      refusedOver(await signStep(as.dana, 'review', testId, dana), 'guard'),
      "The corrected Result needs the assigned Analyst's Performed Signature before review.",
    );
    assert.equal(ok(await as.ana.call(routes.test, { id: testId })).next, 'signPerformedAgain');
    ok(await signStep(as.ana, 'signPerformedAgain', testId, ana));
    const resigned = ok(await as.ana.call(routes.test, { id: testId }));
    assert.deepEqual([resigned.test.state, resigned.next], ['SubmittedForReview', null]);
    assert.deepEqual(
      resigned.signatures.filter((s) => s.meaning === 'Performed').map((s) => [s.recordVersion.version, s.unsigned]),
      [
        [3, true],
        [4, false],
      ],
      'the superseded Performed Signature stays listed as unsigned beside the one on the corrected Result',
    );
    assert.equal(ok(await as.dana.call(routes.test, { id: testId })).next, 'review');
    ok(await signStep(as.dana, 'review', testId, dana));
    ok(await signStep(as.quinn, 'release', testId, quinn));
    const report = ok(await as.cora.call(routes.report, { id: testId }));
    assert.deepEqual(
      report.signatures.map((s) => [s.meaning, s.unsigned]),
      [
        ['Performed', true],
        ['Approved', false],
        ['Performed', false],
        ['Reviewed', false],
        ['Released', false],
      ],
    );
    assert.deepEqual(unsignedMeanings(report.signatures), [], 'the Test Report names no Signature Meaning unsigned');
  });

  it('signing Performed again is refused with no approved change, to another Analyst, and once it is given', async () => {
    const { testId } = await performedTest();
    assert.equal(
      refusedOver(await signStep(as.ana, 'signPerformedAgain', testId, ana), 'guard'),
      'Performed is signed again only after an approved Critical Data Change.',
    );
    ok(await proposeOver(testId));
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    assert.equal(
      refusedOver(await signStep(as.dana, 'signPerformedAgain', testId, dana), 'guard'),
      'Only the assigned Analyst can sign the corrected Result Performed.',
    );
    ok(await signStep(as.ana, 'signPerformedAgain', testId, ana));
    assert.equal(
      refusedOver(await signStep(as.ana, 'signPerformedAgain', testId, ana), 'guard'),
      'The corrected Result is already signed Performed.',
    );
  });

  it('a Reviewed Test re-versioned by a Customer rename, with no change on it, is released as before', async () => {
    const { testId } = await performedTest();
    ok(await signStep(as.rui, 'review', testId, rui));
    const { customerId } = await api.db
      .selectFrom('person')
      .select('customerId')
      .where('id', '=', cora.id)
      .executeTakeFirstOrThrow();
    await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Rename the Customer' }, (tx) =>
      tx
        .updateTable('customer')
        .set({ name: `Northwind Generics renamed ${randomUUID()} (fictional)` })
        .where('id', '=', customerId ?? assert.fail('Cora is a Customer User'))
        .execute(),
    );
    const renamed = ok(await as.quinn.call(routes.test, { id: testId }));
    assert.ok(
      renamed.signatures.every((s) => s.unsigned),
      'the rename leaves Performed and Reviewed on the earlier Record Version',
    );
    assert.equal(renamed.next, 'release');
    ok(await signStep(as.quinn, 'release', testId, quinn));
    assert.equal(ok(await as.quinn.call(routes.test, { id: testId })).test.state, 'Reported');
  });
});

describe("a Critical Data Change's proposed and decided times keep the Lab wall clock of the zone in force then", () => {
  it('proposedAtLab and decidedAtLab carry the Lab offset, name the UTC instant, and stay put when the zone changes', async () => {
    const { timeZone } = await api.db
      .selectFrom('lab')
      .select('timeZone')
      .where('labId', '=', api.labId)
      .executeTakeFirstOrThrow();
    const { testId } = await performedTest();
    const { changeId } = ok(await proposeOver(testId));
    const shown = async () =>
      ok(await as.ana.call(routes.test, { id: testId })).changes.find((c) => c.id === changeId) ??
      assert.fail('the Test shows the change');
    assert.equal((await shown()).decidedAtLab, null, 'a pending change has no decided time');
    ok(await as.ana.call(changeStepRoute('withdrawChange'), { testId, changeId, reasonId: reason.inError }));
    const withdrawn = await shown();
    const decidedAt = withdrawn.decidedAt ?? assert.fail('the decided time');
    assert.deepEqual(
      [toMillis(withdrawn.proposedAtLab), toMillis(withdrawn.decidedAtLab)],
      [onLabClock(withdrawn.proposedAt, timeZone), onLabClock(decidedAt, timeZone)],
      'a Withdrawn decision, which no Signature carries, shows its time on the Lab wall clock',
    );
    await api.moveLabZone('Asia/Tokyo');
    try {
      assert.deepEqual(await shown(), withdrawn, 'the zone change moves neither time');
    } finally {
      await api.moveLabZone(timeZone);
    }
  });
});

describe('a Customer sees only the Approved Critical Data Changes of a released Test', () => {
  it('a Customer sees an approved change and its Approved Signature, and never a rejected, withdrawn or pending one', async () => {
    const { testId } = await performedTest();
    const { changeId: rejected } = ok(await proposeOver(testId, as.ana, '0.0320'));
    ok(await as.rui.call(changeStepRoute('rejectChange'), { testId, changeId: rejected, reasonId: reason.rawData }));
    const { changeId: withdrawn } = ok(await proposeOver(testId, as.ana, '0.0330'));
    ok(await as.ana.call(changeStepRoute('withdrawChange'), { testId, changeId: withdrawn, reasonId: reason.inError }));
    const { changeId: approved } = ok(await proposeOver(testId));
    const pendingView = ok(await as.cora.call(routes.test, { id: testId }));
    assert.deepEqual([pendingView.withheld, pendingView.changes], [true, []]);
    ok(await as.rui.call(changeStepRoute('approveChange'), { testId, ...(await approvalOf(as.rui, testId, rui)) }));
    ok(await signStep(as.ana, 'signPerformedAgain', testId, ana));
    ok(await signStep(as.rui, 'review', testId, rui));
    ok(await signStep(as.quinn, 'release', testId, quinn));
    const view = ok(await as.cora.call(routes.test, { id: testId }));
    assert.equal(view.withheld, false);
    assert.deepEqual(
      view.changes.map((c) => [c.id, c.state, c.oldValue, c.newValue]),
      [[approved, 'Approved', saved, '0.0310']],
    );
    assert.deepEqual(view.changeNext, []);
    const signed = view.signatures.map((s) => [s.meaning, s.record]);
    assert.deepEqual(signed, [
      ['Performed', 'Test'],
      ['Approved', 'Critical Data Change'],
      ['Performed', 'Test'],
      ['Reviewed', 'Test Review'],
      ['Released', 'Test Report'],
    ]);
  });
});
