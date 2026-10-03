import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited } from '@lims/db';
import {
  type AuditExport,
  type AuditExportFormat,
  auditExportData,
  type ChainReading,
  REDACTED,
  routes,
  type StepInput,
  type StepName,
  stepRoute,
} from '@lims/domain';
import { sql } from 'kysely';
import { Value } from 'typebox/value';
import { type Account, type Client, labZoneMoveReason, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_audit_export_test');
const write = <T>(reason: string, fn: Parameters<typeof audited<T>>[2]) =>
  audited(api.db, { actor: 'svc:test', role: 'system', reason }, fn);
const newCustomer = (name: string) =>
  write('Add a test Customer', (tx) =>
    tx.insertInto('customer').values({ name }).returning(['id', 'name']).executeTakeFirstOrThrow(),
  );

const [cora, samir, lena, ana, rui, quinn, ada] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('rui'),
  api.person('quinn'),
  api.person('ada'),
];
const { customerId: northwindId } = await api.db
  .selectFrom('person')
  .select('customerId')
  .where('id', '=', cora.id)
  .executeTakeFirstOrThrow();
assert.ok(northwindId, 'the seeded Customer User has a Customer');
const contoso = await newCustomer('Contoso Labs (fictional)');
const carl = await api.addPerson('carl.contoso', ['Customer'], { customerId: contoso.id });
const as = {
  cora: await api.login(cora),
  carl: await api.login(carl),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  ada: await api.login(ada),
};

const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName> = {}, signer?: Account) {
  const signature = signer && (await signatureOf(client, testId, signer));
  ok(await client.call(stepRoute(name), { commitKey: randomUUID(), testId, input, ...(signature && { signature }) }));
}

async function submitted(
  customer: Client,
  { methodId = api.methodId, released = false, description = 'Metformin HCl tablets (fictional)' } = {},
) {
  const { testId } = ok(
    await customer.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId, description },
    }),
  );
  await take(as.samir, 'receive', testId);
  await take(as.lena, 'assign', testId, { assigneeId: ana.id });
  await take(as.ana, 'enterResult', testId, result, ana);
  if (released) {
    await take(as.rui, 'review', testId, {}, rui);
    await take(as.quinn, 'release', testId, {}, quinn);
  }
  const { test } = ok(await as.rui.call(routes.test, { id: testId }));
  return { testId, sampleNumber: test.sampleNumber };
}

const generate = async (customerId: string, format: AuditExportFormat = 'JSON', client = as.quinn) =>
  ok(await client.call(routes.auditExport, { customerId, format }));
const fileText = (file: AuditExport['files'][number]) => Buffer.from(file.base64, 'base64').toString('utf8');
const dataOf = (answer: AuditExport) => {
  const json: unknown = JSON.parse(fileText(answer.files[0]));
  return Value.Check(auditExportData, json) ? json : assert.fail('the JSON data file is not an Audit Export');
};

it("QA's export for one Customer holds the entries of its Submissions, Samples, Tests and their records, and none of another Customer's Samples", async () => {
  const mine = await submitted(as.cora, { released: true });
  const theirs = await submitted(as.carl);
  const answer = await generate(northwindId);
  const data = dataOf(answer);

  assert.deepEqual(data.customer, { id: northwindId, name: answer.customer.name });
  assert.equal(answer.entryCount, data.entries.length);
  const kinds = new Set(data.entries.map((e) => e.record.kind));
  for (const kind of [
    'Customer',
    'Person',
    'Submission',
    'Sample',
    'Test',
    'Result',
    'Test Report',
    'Record Version',
    'Signature',
    'Re-authentication',
  ])
    assert.ok(kinds.has(kind), `the export holds ${kind} entries`);
  assert.ok(data.entries.some((e) => e.record.table === 'test' && e.record.id === mine.testId));
  const theirIds = new Set(
    (
      await api.superuser
        .selectFrom('auditEntry')
        .select(sql<string>`coalesce(new_row, old_row)->>'id'`.as('id'))
        .where(sql<string>`coalesce(new_row, old_row)::text`, 'like', `%${theirs.testId}%`)
        .execute()
    ).map((r) => r.id),
  );
  assert.ok(theirIds.size > 0, "the other Customer's Test has entries");
  assert.ok(!data.entries.some((e) => theirIds.has(e.record.id)), "no entry on the other Customer's records");
  for (const file of answer.files) {
    const text = Buffer.from(file.base64, 'base64').toString('latin1');
    for (const other of [theirs.sampleNumber, theirs.testId, contoso.name, carl.username]) {
      const printed = other.replaceAll('(', '\\(').replaceAll(')', '\\)');
      assert.ok(!text.includes(other) && !text.includes(printed), `${file.name} does not hold ${other}`);
    }
  }
  assert.ok(
    data.entries.every((e) => !e.redacted),
    'nothing of the requesting Customer is redacted',
  );
});

it("an entry on a shared record that names another Customer's Sample shows it redacted, and the requesting Customer's own Sample as written", async () => {
  const method = await write('Add a test Method', async (tx) => {
    const added = await tx
      .insertInto('method')
      .values({ code: 'RD-MTH-0901', version: '1', title: 'NDMA method transfer (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx.insertInto('trainingRecord').values({ labId: api.labId, personId: ana.id, methodId: added.id }).execute();
    return added;
  });
  const mine = await submitted(as.cora, { methodId: method.id });
  const theirDescription = 'Contoso capsules, lot CX-9 (fictional)';
  const theirs = await submitted(as.carl, { methodId: method.id, description: theirDescription });
  const title = `Transfer checked on ${mine.sampleNumber} and ${theirs.sampleNumber} (${theirDescription})`;
  await write('Record the transfer Samples', (tx) =>
    tx.updateTable('method').set({ title }).where('id', '=', method.id).execute(),
  );

  for (const [customerId, own, others] of [
    [northwindId, [mine.sampleNumber], [theirs.sampleNumber, theirDescription]],
    [contoso.id, [theirs.sampleNumber, theirDescription], [mine.sampleNumber]],
  ] as const) {
    const data = dataOf(await generate(customerId));
    const update = data.entries.find((e) => e.record.id === method.id && e.op === 'UPDATE');
    assert.ok(update, 'the shared Method update is in the export');
    const shown = others.reduce((t: string, other) => t.replace(other, REDACTED), title);
    for (const kept of own) assert.ok(shown.includes(kept));
    assert.deepEqual(update.changes.find((c) => c.field === 'title')?.new, { text: shown, ref: null, instant: null });
    assert.equal(update.raw.newRow?.title, shown);
    assert.equal(update.redacted, true);
    for (const other of others)
      assert.ok(!JSON.stringify(data).includes(other), `the other Customer's ${other} appears nowhere`);
  }
});

it("a stored instant such as a Sample's receipt shows in UTC and on the Lab's clock, as the database renders it, in the JSON and the CSV", async () => {
  await submitted(as.cora);
  const json = await generate(northwindId, 'JSON');
  const csv = await generate(northwindId, 'CSV');
  const entry = dataOf(json).entries.find(
    (e) => e.record.table === 'sample' && e.changes.some((c) => c.field === 'received_at' && c.new !== null),
  );
  assert.ok(entry, 'a Sample receipt is in the export');
  const stored = String(entry.raw.newRow?.received_at);
  const shown = entry.changes.find((c) => c.field === 'received_at')?.new?.instant;
  assert.ok(shown?.atLab, 'the receipt carries its Lab time');
  assert.match(shown.at, /Z$/);
  assert.match(shown.atLab, /[+-]\d{2}:\d{2}$/);
  const { rows: compared } = await sql<{ same: boolean }>`
    select ${shown.at}::timestamptz = ${stored}::timestamptz
       and ${shown.atLab}::timestamptz = ${stored}::timestamptz as same`.execute(api.db);
  assert.deepEqual(compared, [{ same: true }], 'both renderings are the stored instant');

  const [header, ...rows] = fileText(csv.files[0])
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(','));
  assert.ok(header);
  const row = rows.find(
    (r) => r[header.indexOf('Record ID')] === entry.record.id && r[header.indexOf('Field')] === 'received_at',
  );
  assert.equal(row?.[header.indexOf('New value')], `${shown.at} (Lab: ${shown.atLab})`);
  assert.equal(row?.[header.indexOf('New raw value')], stored);
});

it('the export comes as JSON or CSV with a PDF, each entry carrying its chain, entry number, actor and role, field, old and new value, reason and time', async () => {
  const mine = await submitted(as.cora);
  const json = await generate(northwindId, 'JSON');
  const csv = await generate(northwindId, 'CSV');
  for (const [answer, ext, mediaType] of [
    [json, 'json', 'application/json'],
    [csv, 'csv', 'text/csv'],
  ] as const) {
    assert.deepEqual(
      answer.files.map((f) => [f.name.split('.').at(-1), f.mediaType]),
      [
        [ext, mediaType],
        ['pdf', 'application/pdf'],
      ],
    );
    for (const f of answer.files)
      assert.equal(f.sha256, createHash('sha256').update(Buffer.from(f.base64, 'base64')).digest('hex'));
  }

  const entered = dataOf(json).entries.find((e) => e.record.id === mine.testId && e.reason === 'enterResult');
  assert.ok(entered, 'the enterResult entry of the Test');
  assert.deepEqual(
    {
      chain: entered.chain,
      actor: entered.actor,
      changes: entered.changes,
      hasTimes: Boolean(entered.at && entered.atLab),
      seq: /^\d+$/.test(entered.seq),
    },
    {
      chain: 'lab',
      actor: { label: 'Ana Ferreira', role: 'Analyst' },
      changes: [
        {
          field: 'state',
          label: 'State',
          old: { text: 'Assigned', ref: null, instant: null },
          new: { text: 'SubmittedForReview', ref: null, instant: null },
        },
      ],
      hasTimes: true,
      seq: true,
    },
  );

  const [header, ...rows] = fileText(csv.files[0])
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(','));
  assert.ok(header);
  const column = (name: string) => header.indexOf(name);
  for (const name of [
    'Chain',
    'Entry',
    'Time (UTC)',
    'Actor',
    'Role',
    'Field name',
    'Old value',
    'New value',
    'Reason',
  ])
    assert.ok(column(name) >= 0, `the CSV has a ${name} column`);
  const row = rows.find(
    (r) =>
      r[column('Record ID')] === mine.testId && r[column('Reason')] === 'enterResult' && r[column('Field')] === 'state',
  );
  assert.ok(row, 'the CSV has a row for the state change');
  assert.deepEqual(
    ['Chain', 'Entry', 'Actor', 'Role', 'Field name', 'Old value', 'New value', 'Old raw value', 'New raw value'].map(
      (name) => row[column(name)],
    ),
    [
      'Lab chain',
      entered.seq,
      'Ana Ferreira',
      'Analyst',
      'State',
      'Assigned',
      'SubmittedForReview',
      'Assigned',
      'SubmittedForReview',
    ],
  );
  assert.equal(row[column('Time (UTC)')], entered.at);

  const pdf = Buffer.from(json.files[1].base64, 'base64').toString('latin1');
  assert.match(pdf, /^%PDF-1\.4\n/);
  assert.match(pdf, /%%EOF\n$/);
  assert.ok(pdf.includes(`(Lab chain entry ${entered.seq}  ${entered.at}`), 'the PDF prints each entry as text');
  assert.ok(pdf.includes('(    State: Assigned -> SubmittedForReview) Tj'), 'the PDF prints old and new values');
  assert.ok(pdf.includes(json.files[0].sha256), "the PDF names the data file's hash");
});

it('generating an export writes an audited event naming the Customer and the requesting QA, with the hash of each file', async () => {
  const answer = await generate(northwindId, 'CSV');
  const row = await api.superuser
    .selectFrom('auditExport')
    .selectAll()
    .where('id', '=', answer.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    [row.customerId, row.requestedBy, row.requestedRole, row.format, row.entryCount],
    [northwindId, quinn.id, 'QA', 'CSV', answer.entryCount],
  );
  assert.deepEqual(
    [row.dataSha256.toString('hex'), row.pdfSha256.toString('hex')],
    answer.files.map((f) => f.sha256),
  );
  const entry = await api.superuser
    .selectFrom('auditEntry')
    .select(['chain', 'actor', 'role', 'op', sql<string>`new_row->>'customer_id'`.as('customer')])
    .where('tableName', '=', 'audit_export')
    .where(sql<string>`new_row->>'id'`, '=', answer.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(entry, {
    chain: api.labId,
    actor: 'person:quinn.qa',
    role: 'QA',
    op: 'INSERT',
    customer: northwindId,
  });

  const next = dataOf(await generate(northwindId));
  const listed = next.entries.find((e) => e.record.table === 'audit_export' && e.record.id === answer.id);
  assert.ok(listed, "the Customer's next export lists the earlier one");
  assert.equal(listed.actor.label, 'Quinn Adeyemi');
  assert.equal(listed.changes.find((c) => c.field === 'customer_id')?.new?.text, answer.customer.name);
});

it('an export request from any role other than QA, a Customer User included, is refused with the role kind and writes nothing', async () => {
  const before = await api.superuser
    .selectFrom('auditExport')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const format: AuditExportFormat = 'JSON';
  for (const [who, client] of [
    ['a Customer User', as.cora],
    ['a Sample Custodian', as.samir],
    ['a Lab Manager', as.lena],
    ['an Analyst', as.ana],
    ['a Reviewer', as.rui],
    ['an Admin', as.ada],
  ] as const) {
    assert.equal(
      refusedWith(await client.call(routes.auditExport, { customerId: northwindId, format }), 'role'),
      'An Audit Export is generated by QA.',
      who,
    );
    refusedWith(await client.call(routes.auditExportCustomers), 'role');
  }
  const after = await api.superuser
    .selectFrom('auditExport')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  assert.equal(after.n, before.n);
});

it('QA picks from the Customers with a Sample in this Lab, and a Customer with none is not found', async () => {
  await submitted(as.carl);
  const listed = ok(await as.quinn.call(routes.auditExportCustomers));
  assert.deepEqual(listed.map((c) => c.id).sort(), [northwindId, contoso.id].sort());
  const empty = await newCustomer('Fabrikam (fictional)');
  refusedWith(await as.quinn.call(routes.auditExport, { customerId: empty.id, format: 'JSON' }), 'notFound');
});

it("the PDF prints Windows-1252's curly quotes and dashes, and a character outside it as its code point", async () => {
  await submitted(as.cora, { description: 'Customer’s tablets – lot 7 二' });
  const pdf = Buffer.from((await generate(northwindId)).files[1].base64, 'base64').toString('latin1');
  assert.ok(pdf.includes('Customer\\222s tablets \\226 lot 7 <U+4E8C>'), 'printed as WinAnsi bytes');
});

it("nothing of another Lab's Customer or Sample appears in the CSV or the PDF, even where a shared record names it", async () => {
  const submission = await write('Add a Customer of a second Lab', async (tx) => {
    const customer = await tx
      .insertInto('customer')
      .values({ name: 'Fabrikam Tokyo (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return tx
      .insertInto('submission')
      .values({ customerId: customer.id, submittedBy: quinn.id, number: 'SUB-2026-900001' })
      .returning(['id', 'number'])
      .executeTakeFirstOrThrow();
  });
  const { lab, sample } = await write('Add a second test Lab', async (tx) => {
    const added = await tx
      .insertInto('lab')
      .values({ code: 'TK', name: 'Tokyo Lab (fictional)', timeZone: 'Asia/Tokyo' })
      .returning('labId')
      .executeTakeFirstOrThrow();

    const tokyoSample = await tx
      .insertInto('sample')
      .values({
        labId: added.labId,
        submissionId: submission.id,
        number: 'TK-S-2026-000001',
        description: 'Granules (fictional)',
      })
      .returning(['id', 'number'])
      .executeTakeFirstOrThrow();
    return { lab: added, sample: tokyoSample };
  });
  const method = await write('Add a test Method', async (tx) => {
    const added = await tx
      .insertInto('method')
      .values({ code: 'RD-MTH-0902', version: '1', title: 'NDEA method transfer (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx.insertInto('trainingRecord').values({ labId: api.labId, personId: ana.id, methodId: added.id }).execute();
    return added;
  });
  const mine = await submitted(as.cora, { methodId: method.id });
  const named = [sample.number, sample.id, submission.number, 'Fabrikam Tokyo (fictional)', lab.labId];
  const title = `Transferred from ${named.join(', ')} to ${mine.sampleNumber}`;
  await write('Record the transfer Samples', (tx) =>
    tx.updateTable('method').set({ title }).where('id', '=', method.id).execute(),
  );

  const update = dataOf(await generate(northwindId)).entries.find(
    (e) => e.record.id === method.id && e.op === 'UPDATE',
  );
  assert.ok(update?.redacted, 'the shared Method entry is in the export, redacted');
  for (const file of (await generate(northwindId, 'CSV')).files) {
    const text = Buffer.from(file.base64, 'base64').toString('latin1');
    for (const other of named) {
      const printed = other.replaceAll('(', '\\(').replaceAll(')', '\\)');
      assert.ok(!text.includes(other) && !text.includes(printed), `${file.name} does not hold ${other}`);
    }
    assert.ok(text.includes(mine.sampleNumber), `${file.name} keeps the requesting Customer's Sample number`);
  }
});

it('a CSV cell a spreadsheet would run as a formula starts with an apostrophe', async () => {
  await submitted(as.cora, { description: '=HYPERLINK("https://example.invalid","open")' });
  const csv = fileText((await generate(northwindId, 'CSV')).files[0]);
  assert.ok(csv.includes(`"'=HYPERLINK(""https://example.invalid"",""open"")"`), 'the formula is quoted and inert');
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv), 'no cell starts with the formula');
});

it("each change to the Lab's time zone is in the export with its actor, reason and time, and both chains still verify intact", async () => {
  await submitted(as.cora);
  const { timeZone: before } = await api.db
    .selectFrom('lab')
    .select('timeZone')
    .where('labId', '=', api.labId)
    .executeTakeFirstOrThrow();
  await api.moveLabZone('Asia/Tokyo');
  await api.moveLabZone(before);
  const answer = await generate(northwindId);
  const data = dataOf(answer);
  const labEntries = data.entries.filter((e) => e.record.table === 'lab');
  assert.ok(
    labEntries.every((e) => e.chain === 'lab' && e.record.id === api.labId),
    "only this Lab's own record, never the Tokyo Lab's",
  );
  const zoneChanges = labEntries.flatMap((e) =>
    e.changes
      .filter((c) => c.field === 'time_zone')
      .map((c) => ({
        old: c.old?.text ?? null,
        new: c.new?.text ?? null,
        actor: e.actor.label,
        role: e.actor.role,
        reason: e.reason,
      })),
  );
  const moved = { actor: 'svc:migrate', role: 'system', reason: labZoneMoveReason };
  assert.deepEqual(zoneChanges.slice(-2), [
    { old: before, new: 'Asia/Tokyo', ...moved },
    { old: 'Asia/Tokyo', new: before, ...moved },
  ]);
  assert.equal(zoneChanges[0]?.old, null, "the Lab's insert sets its first zone");
  for (const e of labEntries.slice(-2)) {
    assert.match(e.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, 'the change in UTC to the microsecond');
    assert.match(e.atLab ?? '', /[+-]\d{2}:\d{2}$/, "the change on the Lab's clock");
  }
  assert.deepEqual(
    data.chains.map((c) => [c.chain, c.verdict]),
    [
      ['lab', 'Intact'],
      ['company', 'Intact'],
    ],
  );
  const pdf = fileText(answer.files[1]);
  assert.ok(pdf.includes(`Time zone: ${before} -> Asia/Tokyo`), 'the PDF shows the move');
  assert.ok(pdf.includes(`Reason: ${labZoneMoveReason}`), 'the PDF shows its reason');
  assert.ok(pdf.includes('the Lab entries show each change of zone'), 'the PDF header points to them');
});

it('an export that finds a chain break names, in its data file and its PDF, the one System Incident that Verify chain and a second export name, requested by the exporting QA', async () => {
  await submitted(as.cora);
  const { seq } = await api.db
    .selectFrom('auditEntry')
    .select(sql<string>`seq::text`.as('seq'))
    .where('chain', '=', api.labId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    await sql`update lims.audit_entry set reason = 'Routine update' where chain = ${api.labId} and seq = ${seq}`.execute(
      tx,
    );
  });

  const answer = await generate(northwindId);
  const lab = dataOf(answer).chains[0];
  const incident = lab?.breaks[0]?.incident ?? assert.fail('the break in the export names a System Incident');
  assert.equal(lab?.verdict, 'Broken');
  assert.deepEqual(
    lab?.breaks.map((b) => b.entry),
    [seq],
  );
  const pdf = Buffer.from(answer.files[1].base64, 'base64').toString('latin1');
  assert.ok(
    pdf.includes(`entry ${seq} fails to verify, recorded as System Incident ${incident} \\(Open\\)`),
    'the PDF names the break and its System Incident, in its state',
  );

  const incidentOf = (chains: ChainReading[]) => chains[0]?.breaks[0]?.incident;
  assert.equal(incidentOf(dataOf(await generate(northwindId)).chains), incident, 'a second export');
  assert.equal(incidentOf(ok(await as.quinn.call(routes.verifyAuditTrail)).chains), incident, 'Verify chain');
  const opened = await api.db
    .selectFrom('systemIncident')
    .select(['reference', 'firstFailure', 'requestedBy'])
    .where('kind', '=', 'ChainVerifyFailure')
    .where('chain', '=', api.labId)
    .execute();
  assert.deepEqual(opened, [{ reference: incident, firstFailure: seq, requestedBy: quinn.id }]);
});
