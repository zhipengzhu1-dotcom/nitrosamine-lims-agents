import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ReleaseLogEntry, type ReleaseLogEntryDraft, routes, type SigningBody } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_release_log_test');
const ada = api.person('ada');
const quinn = api.person('quinn');
const operator = await api.login(ada);
const qa = await api.login(quinn);

/** A Release's validation evidence, fictional. */
const evidence = {
  imageDigests: [`lims-api@sha256:${'a'.repeat(64)}`, `lims-web@sha256:${'b'.repeat(64)}`],
  ciRun: 'https://ci.example.invalid/runs/2026-10-2',
  ciResult: 'Passed',
  zapBaselineResult: 'Warned',
} satisfies Partial<ReleaseLogEntryDraft>;

let recorded = 0;
function draft(overrides: Partial<ReleaseLogEntryDraft> = {}): ReleaseLogEntryDraft {
  recorded += 1;
  return {
    kind: 'ConfigurationChange',
    title: `Configuration change ${recorded}`,
    summary: 'The sweep interval moves from 60 s to 30 s.',
    reason: 'Record the change before it is made',
    ...overrides,
  };
}

const record = async (client: Client, overrides: Partial<ReleaseLogEntryDraft> = {}) =>
  ok(await client.call(routes.recordReleaseLogEntry, draft(overrides)));

async function signingOf(client: Client, entry: ReleaseLogEntry, account: Account): Promise<SigningBody> {
  const { statement } = ok(await client.call(routes.releaseLog));
  return {
    username: account.username,
    password: account.password,
    recordVersion: { version: entry.recordVersion.version, contentHash: entry.recordVersion.contentHash },
    statementVersion: statement.version,
  };
}

const approve = async (client: Client, entry: ReleaseLogEntry, account: Account, signing?: Partial<SigningBody>) =>
  client.call(routes.approveReleaseLogEntry, {
    entryId: entry.id,
    ...(await signingOf(client, entry, account)),
    ...signing,
  });

const versionsOf = (entryId: string) =>
  api.superuser
    .selectFrom('recordVersion')
    .select(['version', 'labId'])
    .where('recordTable', '=', 'release_log_entry')
    .where('recordId', '=', entryId)
    .orderBy('version')
    .execute();

const statementInForce = async () =>
  (
    await api.superuser
      .selectFrom('signatureStatement')
      .select('version')
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow()
  ).version;

describe('the deployment', () => {
  it('answers its data class to anyone, before sign-in, and the seeded deployment is fictional', async () => {
    assert.deepEqual(ok(await new Client(api.base).call(routes.deployment)), { dataClass: 'fictional' });
  });
});

describe('reading the Release Log', () => {
  it('lists the seeded entries, each approved by the seed, the first declaring the service identities with their scopes', async () => {
    const { entries, statement } = ok(await operator.call(routes.releaseLog));
    assert.ok(entries.length >= 6, `the seed records at least six entries; ${entries.length} listed`);
    const seeded = entries.filter((e) => e.approval?.authenticator === 'Seed');
    assert.equal(seeded.length, 6, 'the seed approves its six entries, and each Signature says Seed, as written');
    for (const e of seeded)
      assert.deepEqual(
        { ...e.approval, signedAt: undefined },
        {
          signer: 'Ada Novak',
          username: ada.username,
          role: 'PlatformOperator',
          meaning: 'Approved',
          signedAt: undefined,
          authenticator: 'Seed',
        },
      );
    const declaring = entries.find((e) => e.identities.length > 0) ?? assert.fail('an entry declares the identities');
    assert.ok(
      declaring.identities.some((i) => i.name === 'svc:sign-in' && i.scope.includes('access_event:INSERT')),
      `svc:sign-in writes Access Events: ${JSON.stringify(declaring.identities)}`,
    );
    assert.deepEqual(entries.flatMap((e) => e.recordsExceptions).toSorted(), [
      'Anchoring',
      'DemoLogin',
      'FileVault',
      'PlaintextAtCloudflare',
      'TwoRole',
    ]);
    assert.equal(statement.version, await statementInForce());
  });

  it('is withheld from a Customer', async () => {
    const customer = await api.login(api.person('cora'));
    assert.match(refusedWith(await customer.call(routes.releaseLog), 'role'), /staff/);
  });
});

describe('recording a Release Log entry', () => {
  it('an operator records an entry of each kind, unapproved, with one Record Version and no Lab', async () => {
    const entries = [
      await record(operator, { kind: 'Release', release: '2026.10.2', title: 'Release 2026.10.2', ...evidence }),
      await record(operator, { kind: 'ConfigurationChange' }),
      await record(operator, { kind: 'HostMove', title: 'Move to the VPS' }),
    ];
    for (const entry of entries) {
      assert.equal(entry.approval, null);
      assert.deepEqual(entry.recordVersion.version, 1);
      assert.deepEqual(await versionsOf(entry.id), [{ version: 1, labId: null }]);
    }
    assert.equal(entries[0]?.release, '2026.10.2');
    assert.deepEqual(
      [entries[0]?.imageDigests, entries[0]?.ciRun, entries[0]?.ciResult, entries[0]?.zapBaselineResult],
      [evidence.imageDigests, evidence.ciRun, evidence.ciResult, evidence.zapBaselineResult],
    );
    const { content } = await api.superuser
      .selectFrom('recordVersion')
      .select(sql<Record<string, unknown>>`convert_from(content, 'UTF8')::jsonb`.as('content'))
      .where('recordTable', '=', 'release_log_entry')
      .where('recordId', '=', entries[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    assert.deepEqual(
      [content.imageDigests, content.ciRun, content.ciResult, content.zapBaselineResult],
      [evidence.imageDigests, evidence.ciRun, evidence.ciResult, evidence.zapBaselineResult],
      'the Record Version the Approved Signature covers holds the evidence',
    );
    for (const entry of entries) assert.notEqual(ok(await approve(operator, entry, ada)).approval, null, entry.kind);
  });

  it('an entry declaring service identities is versioned again once they are inserted, and lists them', async () => {
    const identities = [{ name: 'svc:test-worker', scope: ['result:INSERT'] }];
    const entry = await record(operator, { identities });
    assert.deepEqual(entry.identities, identities);
    assert.equal(entry.recordVersion.version, 2);
    assert.deepEqual(
      (await versionsOf(entry.id)).map((v) => v.version),
      [1, 2],
    );
  });

  it('QA records an entry that brings a new signature statement version in, which is not in force until approved', async () => {
    const version = (await statementInForce()) + 1;
    const entry = await record(qa, { statementVersion: version, statement: 'I attest, under this new statement.' });
    assert.equal(entry.statementVersion, version);
    assert.equal(entry.statement, 'I attest, under this new statement.');
    assert.notEqual(await statementInForce(), version);
  });

  it('is refused from an Analyst and from a Customer', async () => {
    const analyst = await api.login(api.person('ana'));
    assert.match(
      refusedWith(await analyst.call(routes.recordReleaseLogEntry, draft()), 'role'),
      /Platform Operator or QA/,
    );
    const customer = await api.login(api.person('cora'));
    assert.match(refusedWith(await customer.call(routes.recordReleaseLogEntry, draft()), 'role'), /staff/);
  });

  it('refuses a Release without its release or its validation evidence, evidence on another kind, a data class without the FileVault fact, and a statement without its version', async () => {
    assert.match(
      refusedWith(await operator.call(routes.recordReleaseLogEntry, draft({ kind: 'Release', ...evidence })), 'guard'),
      /release/,
    );
    for (const missing of ['imageDigests', 'ciRun', 'ciResult', 'zapBaselineResult'] as const) {
      const { [missing]: _, ...partial } = evidence;
      assert.equal(
        refusedWith(
          await operator.call(
            routes.recordReleaseLogEntry,
            draft({ kind: 'Release', release: '2026.10.4', ...partial }),
          ),
          'guard',
        ),
        'A Release entry carries its image digests, its CI run and result, and its ZAP baseline result.',
        missing,
      );
    }
    assert.equal(
      refusedWith(await operator.call(routes.recordReleaseLogEntry, draft({ ciRun: evidence.ciRun })), 'guard'),
      'Only a Release entry carries image digests, a CI run or a ZAP baseline result.',
    );
    assert.match(
      refusedWith(await operator.call(routes.recordReleaseLogEntry, draft({ setsDataClass: 'fictional' })), 'guard'),
      /FileVault/,
    );
    assert.match(
      refusedWith(
        await operator.call(routes.recordReleaseLogEntry, draft({ statement: 'A statement alone.' })),
        'guard',
      ),
      /version/,
    );
    const skipped = (await statementInForce()) + 2;
    assert.match(
      refusedWith(
        await operator.call(
          routes.recordReleaseLogEntry,
          draft({ statementVersion: skipped, statement: 'Skips one.' }),
        ),
        'guard',
      ),
      /version after the one in force/,
    );
  });

  it('refuses an entry bringing a signature statement into force that carries any other change, since QA approves it alone', async () => {
    const statementVersion = (await statementInForce()) + 1;
    for (const other of [
      { recordsExceptions: ['TwoRole'] },
      { lapsesExceptions: ['TwoRole'] },
      { setsDataClass: 'fictional', fileVaultPersonalKey: true },
      { identities: [{ name: 'svc:smuggled', scope: ['customer:INSERT'] }] },
    ] satisfies Partial<ReleaseLogEntryDraft>[])
      assert.equal(
        refusedWith(
          await qa.call(
            routes.recordReleaseLogEntry,
            draft({ statementVersion, statement: 'A new statement.', ...other }),
          ),
          'guard',
        ),
        'An entry bringing a signature statement into force carries no other change, because QA approves it alone.',
      );
  });

  it('refuses an entry that records and lapses the same demo exception', async () => {
    assert.equal(
      refusedWith(
        await operator.call(
          routes.recordReleaseLogEntry,
          draft({ recordsExceptions: ['TwoRole', 'Anchoring'], lapsesExceptions: ['Anchoring'] }),
        ),
        'guard',
      ),
      'An entry records a demo exception or lapses it, not both.',
    );
  });

  it('refuses a service identity whose scope does not name a table and INSERT, UPDATE or DELETE', async () => {
    const answer = await operator.call(
      routes.recordReleaseLogEntry,
      draft({ identities: [{ name: 'svc:loose', scope: ['customer:insert'] }] }),
    );
    assert.match(refusedWith(answer, 'malformed'), /scope/);
  });

  it('refuses an entry setting real while the gate refuses, naming each unmet condition', async () => {
    const answer = await operator.call(
      routes.recordReleaseLogEntry,
      draft({ setsDataClass: 'real', fileVaultPersonalKey: false }),
    );
    const message = refusedWith(answer, 'realDataRefused');
    for (const condition of [
      /Every control on the list is built/,
      /Every demo exception is recorded as lapsed; .*TwoRole/,
      /Anchoring of the Audit Trail is live/,
      /The host holds a personal FileVault key/,
      /No record was created under fictional; .*customer/,
      /held for anyone but the approver; accounts, Memberships/,
      /No one holds Admin together with another role; ada\.admin does/,
    ])
      assert.match(message, condition);
    assert.doesNotMatch(message, /login runs/, 'the harness runs the decided login');
    assert.equal(ok(await new Client(api.base).call(routes.deployment)).dataClass, 'fictional');
  });

  it('names the demo login when the API runs it', async () => {
    const { base } = await api.startAnotherApi({ login: 'demo' });
    const demo = new Client(base);
    ok(await demo.call(routes.login, { username: ada.username, password: ada.password, labId: api.labId }));
    const message = refusedWith(
      await demo.call(routes.recordReleaseLogEntry, draft({ setsDataClass: 'real', fileVaultPersonalKey: true })),
      'realDataRefused',
    );
    assert.match(message, /it runs as demo/);
    assert.doesNotMatch(message, /The host holds a personal FileVault key/);
  });
});

describe('approving a Release Log entry', () => {
  it('the operator approves a system entry by re-entering their credentials; it is then signed once, and the Release Log shows who signed, as what and when', async () => {
    const entry = await record(operator);
    const before = Date.now();
    const approved = ok(await approve(operator, entry, ada));
    assert.equal(approved.id, entry.id);
    const { signedAt, ...approval } = approved.approval ?? assert.fail('the entry is approved');
    assert.deepEqual(approval, {
      signer: 'Ada Novak',
      username: ada.username,
      role: 'PlatformOperator',
      meaning: 'Approved',
      authenticator: 'Password',
    });
    assert.match(signedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, 'the time is ISO 8601 UTC');
    assert.ok(Date.parse(signedAt) >= before - 60_000, signedAt);
    const signatures = await api.superuser
      .selectFrom('signature')
      .innerJoin('recordVersion', 'recordVersion.id', 'signature.recordVersionId')
      .select(['signature.meaning', 'signature.role', 'signature.printedName', 'signature.appRelease'])
      .where('recordVersion.recordId', '=', entry.id)
      .execute();
    assert.deepEqual(signatures, [
      { meaning: 'Approved', role: 'PlatformOperator', printedName: 'Ada Novak', appRelease: 'test-release' },
    ]);
    assert.deepEqual(
      ok(await operator.call(routes.releaseLog)).entries.find((e) => e.id === entry.id)?.approval,
      approved.approval,
    );
  });

  it('a second approval is refused', async () => {
    const entry = await record(operator);
    ok(await approve(operator, entry, ada));
    assert.match(refusedWith(await approve(operator, entry, ada), 'state'), /already approved/);
  });

  it('a system entry is refused from QA, and a statement entry from the operator', async () => {
    const system = await record(operator);
    assert.match(refusedWith(await approve(qa, system, quinn), 'role'), /Platform Operator/);
    const statement = await record(qa, {
      statementVersion: (await statementInForce()) + 1,
      statement: 'A new statement.',
    });
    assert.match(refusedWith(await approve(operator, statement, ada), 'role'), /QA/);
  });

  it('a new signature statement is in force only once QA approves its entry', async () => {
    const version = (await statementInForce()) + 1;
    const entry = await record(qa, { statementVersion: version, statement: 'I attest that this record is true.' });
    assert.notEqual(await statementInForce(), version);
    const overtaken = await record(qa, { statementVersion: version, statement: 'Recorded before, approved after.' });
    ok(await approve(qa, entry, quinn));
    assert.equal(await statementInForce(), version);
    assert.equal(ok(await qa.call(routes.releaseLog)).statement.text, 'I attest that this record is true.');
    assert.match(refusedWith(await approve(qa, overtaken, quinn), 'state'), /came into force/);
  });

  it('a wrong password, a changed Record Version and a stale statement version are each refused, leaving the entry unapproved', async () => {
    const entry = await record(operator, { identities: [{ name: 'svc:other', scope: ['result:INSERT'] }] });
    assert.equal(
      refusedWith(await approve(operator, entry, ada, { password: 'wrong' }), 'badCredentials').length > 0,
      true,
    );
    const seenEarlier = { ...entry, recordVersion: { ...entry.recordVersion, version: 1 } };
    assert.match(refusedWith(await approve(operator, seenEarlier, ada), 'recordChanged'), /changed/);
    assert.match(
      refusedWith(await approve(operator, entry, ada, { statementVersion: 999 }), 'signingRefused'),
      /Statement/,
    );
    assert.equal(ok(await operator.call(routes.releaseLog)).entries.find((e) => e.id === entry.id)?.approval, null);
    const { count } = await api.superuser
      .selectFrom('signature')
      .innerJoin('recordVersion', 'recordVersion.id', 'signature.recordVersionId')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('recordVersion.recordId', '=', entry.id)
      .executeTakeFirstOrThrow();
    assert.equal(count, 0);
  });

  it('a demo exception recorded again after it lapsed stands again, and the gate names it', async () => {
    for (const change of [
      { lapsesExceptions: ['TwoRole'] },
      { recordsExceptions: ['TwoRole'] },
    ] satisfies Partial<ReleaseLogEntryDraft>[])
      ok(await approve(operator, await record(operator, change), ada));
    const message = refusedWith(
      await operator.call(routes.recordReleaseLogEntry, draft({ setsDataClass: 'real', fileVaultPersonalKey: true })),
      'realDataRefused',
    );
    assert.match(message, /Every demo exception is recorded as lapsed; .*TwoRole/);
  });

  it('an entry setting the data class is approved after a mistyped password, which leaves a failure count to clear', async () => {
    const entry = await record(operator, { setsDataClass: 'fictional', fileVaultPersonalKey: false });
    refusedWith(await approve(operator, entry, ada, { password: 'wrong' }), 'badCredentials');
    assert.notEqual(ok(await approve(operator, entry, ada)).approval, null);
    const { dataClass, setByEntryId } = await api.superuser
      .selectFrom('deployment')
      .select(['dataClass', 'setByEntryId'])
      .executeTakeFirstOrThrow();
    assert.deepEqual({ dataClass, setByEntryId }, { dataClass: 'fictional', setByEntryId: entry.id });
  });

  it('an entry setting the fictional data class is refused while the deployment holds real data', async () => {
    // No approval can make this seeded deployment real, so the owner sets the class with every trigger off, and back.
    const setClass = (to: 'real' | 'fictional') =>
      api.superuser.connection().execute(async (c) => {
        await sql`set session_replication_role = replica`.execute(c);
        await sql`update lims.deployment set data_class = ${to}::lims.data_class`.execute(c);
        await sql`reset session_replication_role`.execute(c);
      });
    await setClass('real');
    try {
      assert.match(
        refusedWith(
          await operator.call(
            routes.recordReleaseLogEntry,
            draft({ setsDataClass: 'fictional', fileVaultPersonalKey: true }),
          ),
          'state',
        ),
        /real data/,
      );
    } finally {
      await setClass('fictional');
    }
  });

  it('an unknown entry is not found', async () => {
    const entry = await record(operator);
    const missing = { ...entry, id: '00000000-0000-4000-8000-000000000000' };
    assert.match(refusedWith(await approve(operator, missing, ada), 'notFound'), /Release Log/);
  });
});
