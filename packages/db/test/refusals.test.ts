import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbConfig } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();

const DATABASE = checkoutDatabase('lims_refusals_test');
const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });

type Row = Record<string, unknown>;

const id = {
  customer: randomUUID(),
  person: randomUUID(),
  method: randomUUID(),
  submission: randomUUID(),
  lab: randomUUID(),
  otherLab: randomUUID(),
  sample: randomUUID(),
  test: randomUUID(),
  untested: randomUUID(),
  result: randomUUID(),
  testReport: randomUUID(),
  laterRecordVersion: randomUUID(),
  signature: randomUUID(),
  session: randomUUID(),
  systemIncident: randomUUID(),
  commitKey: randomUUID(),
  transaction: randomUUID(),
  accessEvent: randomUUID(),
  otherPerson: randomUUID(),
  auditExport: randomUUID(),
};
const missing = randomUUID();
const token = Buffer.alloc(32, 1);
const zeros = Buffer.alloc(32);

const fixture: [string, Row][] = [
  ['lims.customer', { id: id.customer, name: 'Refusal Customer (fictional)' }],
  [
    'lims.person',
    { id: id.person, username: 'refusal.person', display_name: 'Refusal Person', password_hash: 'not-a-real-hash' },
  ],
  [
    'lims.person',
    { id: id.otherPerson, username: 'refusal.other', display_name: 'Other Person', password_hash: 'not-a-real-hash' },
  ],
  ['lims.method', { id: id.method, code: 'RF-MTH-0001', version: '1', title: 'NDMA by LC-MS/MS (fictional)' }],
  [
    'lims.submission',
    { id: id.submission, customer_id: id.customer, submitted_by: id.person, number: 'SUB-2026-000001' },
  ],
  ['lims.lab', { lab_id: id.lab, code: 'RF', name: 'Refusal Lab', time_zone: 'America/New_York' }],
  ['lims.lab', { lab_id: id.otherLab, code: 'OT', name: 'Other Lab', time_zone: 'Asia/Tokyo' }],
  ['lims.counter', { lab_id: null, kind: 'Submission' }],
  ['lims.counter', { lab_id: id.lab, kind: 'Sample' }],
  ['lims.membership', { lab_id: id.lab, person_id: id.person, role: 'Analyst' }],
  ['lims.membership', { lab_id: id.lab, person_id: id.otherPerson, role: 'QA' }],
  ['lims.training_record', { lab_id: id.lab, person_id: id.person, method_id: id.method }],
  [
    'lims.sample',
    { lab_id: id.lab, id: id.sample, submission_id: id.submission, number: 'RF-S-2026-000001', description: 'Tablets' },
  ],
  ['lims.test', { lab_id: id.lab, id: id.test, sample_id: id.sample, method_id: id.method }],
  ['lims.test', { lab_id: id.lab, id: id.untested, sample_id: id.sample, method_id: id.method }],
  [
    'lims.result',
    {
      lab_id: id.lab,
      id: id.result,
      test_id: id.test,
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injection_sequence_ref: 'SEQ-2026-0001',
      notebook_ref: 'NB-RF-0001-001',
      performed_on: '2026-09-30',
      entered_by: id.person,
    },
  ],
  ['lims.test_report', { lab_id: id.lab, id: id.testReport, test_id: id.test, number: 'RF-R-2026-000001' }],
  [
    'lims.record_version',
    {
      lab_id: id.lab,
      id: id.laterRecordVersion,
      record_table: 'test',
      record_id: id.untested,
      version: 2,
      canonical_form: 0,
      content: Buffer.from('{"id":"fixture"}'),
    },
  ],
  [
    'lims.signature',
    {
      lab_id: id.lab,
      id: id.signature,
      person_id: id.person,
      meaning: 'Performed',
      record_version_id: id.laterRecordVersion,
    },
  ],
  ['lims.session', { lab_id: id.lab, id: id.session, person_id: id.person, token_hash: token }],
  [
    'lims.system_incident',
    {
      id: id.systemIncident,
      kind: 'UnexpectedFailure',
      reference: 'RF000001',
      requested_by: id.person,
      session_lab_id: id.lab,
      step: 'enterResult',
      record_id: id.test,
      error_class: 'DatabaseError',
      sqlstate: '23514',
      constraint_name: 'result_value_check',
    },
  ],
  [
    'lims.commit_key',
    {
      lab_id: id.lab,
      key: id.commitKey,
      session_id: id.session,
      request_hash: Buffer.alloc(32, 3),
      test_id: id.test,
      state: 'Ready',
    },
  ],
  [
    'lims.access_event',
    {
      id: id.accessEvent,
      kind: 'SignInSucceeded',
      subject_id: id.person,
      source_address: '192.0.2.1',
      session_lab_id: id.lab,
      session_id: id.session,
      roles: '{Analyst}',
    },
  ],
  [
    'lims.audit_export',
    {
      lab_id: id.lab,
      id: id.auditExport,
      customer_id: id.customer,
      requested_by: id.otherPerson,
      format: 'JSON',
      entry_count: 12,
      data_sha256: Buffer.alloc(32, 5),
      pdf_sha256: Buffer.alloc(32, 6),
    },
  ],
];
const unknownUserIdAttempt: Row = {
  kind: 'SignInFailed',
  failure_reason: 'UnknownUserId',
  subject_id: null,
  typed_user_id_hmac: Buffer.alloc(32, 3),
  typed_user_id_length: 12,
  roles: '{}',
};

const tables = {
  'lims.customer': {
    noun: 'Customer',
    row: { name: 'Second Refusal Customer (fictional)' },
    notNull: ['id', 'name'],
  },
  'lims.person': {
    noun: 'person',
    row: { username: 'refusal.second', display_name: 'Second Person', password_hash: 'not-a-real-hash' },
    notNull: ['id', 'username', 'display_name', 'password_hash', 'failed_logins'],
  },
  'lims.method': {
    noun: 'Method',
    row: { code: 'RF-MTH-0002', version: '1', title: 'NDEA by LC-MS/MS (fictional)' },
    notNull: ['id', 'code', 'version', 'title'],
  },
  'lims.submission': {
    noun: 'Submission',
    row: { customer_id: id.customer, submitted_by: id.person, number: 'SUB-2026-000002' },
    notNull: ['id', 'customer_id', 'submitted_by', 'number'],
  },
  'lims.lab': {
    noun: 'Lab',
    row: { code: 'RFB', name: 'Second Refusal Lab', time_zone: 'UTC' },
    notNull: ['lab_id', 'code', 'name', 'time_zone'],
  },
  'lims.membership': {
    noun: 'Lab membership',
    row: { lab_id: id.lab, person_id: id.person, role: 'QA' },
    notNull: ['lab_id', 'person_id', 'role'],
  },
  'lims.training_record': {
    noun: 'Training Record',
    row: { lab_id: id.otherLab, person_id: id.person, method_id: id.method },
    notNull: ['lab_id', 'person_id', 'method_id'],
  },
  'lims.sample': {
    noun: 'Sample',
    row: { lab_id: id.lab, submission_id: id.submission, number: 'RF-S-2026-000002', description: 'Capsules' },
    notNull: ['lab_id', 'id', 'submission_id', 'number', 'description'],
  },
  'lims.test': {
    noun: 'Test',
    row: { lab_id: id.lab, sample_id: id.sample, method_id: id.method },
    notNull: ['lab_id', 'id', 'sample_id', 'method_id', 'state', 'gxp_class'],
  },
  'lims.result': {
    noun: 'Result',
    row: {
      lab_id: id.lab,
      test_id: id.untested,
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injection_sequence_ref: 'SEQ-2026-0002',
      notebook_ref: 'NB-RF-0001-002',
      performed_on: '2026-09-30',
      entered_by: id.person,
    },
    notNull: [
      'lab_id',
      'id',
      'test_id',
      'analyte',
      'value',
      'unit',
      'injection_sequence_ref',
      'notebook_ref',
      'performed_on',
      'entered_by',
    ],
  },
  'lims.test_report': {
    noun: 'Test Report',
    row: { lab_id: id.lab, test_id: id.untested, number: 'RF-R-2026-000002' },
    notNull: ['lab_id', 'id', 'test_id', 'number'],
  },
  'lims.record_version': {
    noun: 'Record Version',
    row: {
      lab_id: id.lab,
      record_table: 'test',
      record_id: id.untested,
      version: 3,
      canonical_form: 1,
      content: Buffer.from('{"id":"third"}'),
    },
    notNull: ['lab_id', 'id', 'record_table', 'record_id', 'version', 'canonical_form', 'content', 'saved_at'],
  },
  'lims.signature': {
    noun: 'Signature',
    row: { lab_id: id.lab, person_id: id.person, meaning: 'Reviewed', record_version_id: id.laterRecordVersion },
    notNull: ['lab_id', 'id', 'person_id', 'meaning', 'record_version_id', 'signed_at'],
  },
  'lims.session': {
    noun: 'session',
    row: { lab_id: id.lab, person_id: id.person, token_hash: Buffer.alloc(32, 2) },
    notNull: ['lab_id', 'id', 'person_id', 'token_hash', 'created_at', 'last_seen_at'],
  },
  'lims.system_incident': {
    noun: 'System Incident',
    row: {
      kind: 'UnexpectedFailure',
      reference: 'RF000002',
      requested_by: id.person,
      session_lab_id: id.lab,
      step: 'enterResult',
      record_id: id.test,
      error_class: 'DatabaseError',
      sqlstate: '23514',
      constraint_name: 'result_value_check',
    },
    notNull: ['id', 'kind', 'reference', 'opened_at', 'state'],
  },
  'lims.commit_key': {
    noun: 'Commit Key',
    row: {
      lab_id: id.lab,
      key: randomUUID(),
      session_id: id.session,
      request_hash: Buffer.alloc(32, 4),
      test_id: id.test,
      state: 'Assigned',
    },
    notNull: ['lab_id', 'key', 'session_id', 'request_hash', 'test_id', 'state', 'committed_at'],
  },
  'lims.counter': {
    noun: 'counter',
    row: { lab_id: id.lab, kind: 'TestReport' },
    notNull: ['kind'],
  },
  'lims.access_event': {
    noun: 'Access Event',
    row: {
      kind: 'SignInFailed',
      failure_reason: 'WrongPassword',
      subject_id: id.person,
      source_address: '192.0.2.1',
      roles: '{Analyst}',
    },
    notNull: ['id', 'kind', 'roles', 'at'],
  },
  'lims.audit_export': {
    noun: 'Audit Export',
    row: {
      lab_id: id.lab,
      customer_id: id.customer,
      requested_by: id.otherPerson,
      format: 'CSV',
      entry_count: 0,
      data_sha256: Buffer.alloc(32, 7),
      pdf_sha256: Buffer.alloc(32, 8),
    },
    notNull: [
      'lab_id',
      'id',
      'customer_id',
      'requested_by',
      'requested_role',
      'format',
      'entry_count',
      'data_sha256',
      'pdf_sha256',
      'generated_at',
    ],
  },
  'lims.audit_chain': {
    noun: 'Audit Trail chain head',
    row: { chain: 'refusal-probe' },
    notNull: ['chain', 'seq', 'head'],
  },
  'lims.audit_entry': {
    noun: 'Audit Trail entry',
    row: {
      chain: 'company',
      seq: 1_000_000,
      at: '2026-09-30T00:00:00Z',
      actor: 'svc:test',
      role: 'system',
      reason: 'Probe a refusal',
      table_name: 'customer',
      op: 'INSERT',
      prev_hash: zeros,
      hash: zeros,
      transaction_id: id.transaction,
    },
    notNull: ['chain', 'seq', 'at', 'actor', 'role', 'reason', 'table_name', 'op', 'prev_hash', 'hash'],
  },
  'public.schema_migration': {
    noun: 'recorded migration',
    row: { name: '9999_probe.sql', sha256: zeros },
    notNull: ['name', 'applied_at', 'hashed_at'],
  },
} satisfies Record<string, { noun: string; row: Row; notNull: string[] }>;
type Table = keyof typeof tables;
const tableNames = Object.keys(tables).filter((key): key is Table => Object.hasOwn(tables, key));

const auditedTables: Table[] = [
  'lims.customer',
  'lims.person',
  'lims.method',
  'lims.submission',
  'lims.lab',
  'lims.membership',
  'lims.training_record',
  'lims.sample',
  'lims.test',
  'lims.result',
  'lims.test_report',
  'lims.record_version',
  'lims.signature',
  'lims.system_incident',
  'lims.access_event',
  'lims.audit_export',
];

const bare = (table: string) => table.slice(table.indexOf('.') + 1);

function insert(table: string, row: Row): [string, unknown[]] {
  const columns = Object.keys(row);
  const names = columns.map((column) => pg.escapeIdentifier(column)).join(', ');
  const params = columns.map((_, i) => `$${i + 1}`).join(', ');
  return [`insert into ${table} (${names}) values (${params})`, Object.values(row)];
}

const AUDIT_CONTEXT = `select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
                              set_config('lims.reason', 'Probe a refusal', true),
                              lims.set_this_transaction('lims.numbering', 'on')`;

async function refusalOf(statement: string, values: unknown[] = [], context = true): Promise<pg.DatabaseError> {
  await client.query('begin');
  try {
    if (context) await client.query(AUDIT_CONTEXT);
    await client.query(statement, values);
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  } finally {
    await client.query('rollback');
  }
  return assert.fail(`the database accepted ${statement}`);
}

const refusalOfRow = (table: Table, change: Row = {}, context = true) =>
  refusalOf(...insert(table, { ...tables[table].row, ...change }), context);

function assertConstraint(error: pg.DatabaseError, code: string, table: Table, constraint: string): void {
  assert.deepEqual([error.code, error.table, error.constraint], [code, bare(table), constraint], error.message);
}

const covered = new Set<string>();

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${DATABASE} with (force)`);
  } finally {
    await admin.end();
  }
  await migrate(server, DATABASE);
  await client.connect();
  for (const [table, row] of fixture) {
    await client.query('begin');
    await client.query(AUDIT_CONTEXT);
    await client.query(...insert(table, row));
    await client.query('commit');
  }
});

after(() => client.end());

it('the base row of every table is accepted, so each refusal below comes from the one change it makes', async () => {
  for (const table of tableNames) {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(...insert(table, tables[table].row));
    } finally {
      await client.query('rollback');
    }
  }
});

describe('the database refuses an empty required field', () => {
  for (const table of tableNames) {
    const { noun, notNull } = tables[table];
    for (const column of notNull) covered.add(`${table}.${bare(table)}_${column}_not_null`);
    it(`every required field of ${/^[AEIOU]/.test(noun) ? 'an' : 'a'} ${noun} refuses a null`, async () => {
      for (const column of notNull) {
        const error = await refusalOfRow(table, { [column]: null });
        assert.deepEqual([error.code, error.table, error.column], ['23502', bare(table), column], error.message);
      }
    });
  }
});

describe('the database refuses a second row with the key of an existing one', () => {
  const keys: Record<Exclude<Table, 'lims.counter'>, Row> = {
    'lims.customer': { id: id.customer },
    'lims.person': { id: id.person },
    'lims.method': { id: id.method },
    'lims.submission': { id: id.submission },
    'lims.lab': { lab_id: id.lab },
    'lims.membership': { lab_id: id.lab, role: 'Analyst' },
    'lims.training_record': { lab_id: id.lab },
    'lims.sample': { id: id.sample },
    'lims.test': { id: id.test },
    'lims.result': { id: id.result },
    'lims.test_report': { id: id.testReport },
    'lims.record_version': { id: id.laterRecordVersion },
    'lims.signature': { id: id.signature },
    'lims.session': { id: id.session },
    'lims.system_incident': { id: id.systemIncident },
    'lims.commit_key': { key: id.commitKey },
    'lims.access_event': { id: id.accessEvent },
    'lims.audit_export': { id: id.auditExport },
    'lims.audit_chain': { chain: 'company' },
    'lims.audit_entry': { seq: 1 },
    'public.schema_migration': { name: '0001_roles.sql' },
  };
  for (const table of tableNames) {
    if (table === 'lims.counter') continue;
    const constraint = `${bare(table)}_pkey`;
    covered.add(`${table}.${constraint}`);
    it(`a second ${tables[table].noun} with the key of an existing one is refused`, async () => {
      assertConstraint(await refusalOfRow(table, keys[table]), '23505', table, constraint);
    });
  }
});

interface Case {
  name: string;
  table: Table;
  change: Row;
  constraint: string;
}

function refusesEach(code: string, cases: Case[]): void {
  for (const c of cases) {
    covered.add(`${c.table}.${c.constraint}`);
    it(c.name, async () => assertConstraint(await refusalOfRow(c.table, c.change), code, c.table, c.constraint));
  }
}

describe('the database refuses a duplicate of a unique value', () => {
  refusesEach('23505', [
    {
      name: 'a second Customer with the same name is refused',
      table: 'lims.customer',
      change: { name: 'Refusal Customer (fictional)' },
      constraint: 'customer_name_key',
    },
    {
      name: 'a second person with the same username is refused',
      table: 'lims.person',
      change: { username: 'refusal.person' },
      constraint: 'person_username_key',
    },
    {
      name: 'a second Method with the same code and version is refused',
      table: 'lims.method',
      change: { code: 'RF-MTH-0001' },
      constraint: 'method_code_version_key',
    },
    {
      name: 'a second Lab with the same code is refused',
      table: 'lims.lab',
      change: { code: 'RF' },
      constraint: 'lab_code_key',
    },
    {
      name: 'a second Submission with the same number is refused',
      table: 'lims.submission',
      change: { number: 'SUB-2026-000001' },
      constraint: 'submission_number_key',
    },
    {
      name: 'a second Sample with the same number in one Lab is refused',
      table: 'lims.sample',
      change: { number: 'RF-S-2026-000001' },
      constraint: 'sample_lab_id_number_key',
    },
    {
      name: 'a second Result for one Test is refused',
      table: 'lims.result',
      change: { test_id: id.test },
      constraint: 'result_lab_id_test_id_key',
    },
    {
      name: 'a second Test Report with the same number in one Lab is refused',
      table: 'lims.test_report',
      change: { number: 'RF-R-2026-000001' },
      constraint: 'test_report_lab_id_number_key',
    },
    {
      name: 'a second Test Report for one Test is refused',
      table: 'lims.test_report',
      change: { test_id: id.test },
      constraint: 'test_report_lab_id_test_id_key',
    },
    {
      name: 'a second Record Version with the number of an existing one is refused',
      table: 'lims.record_version',
      change: { version: 2 },
      constraint: 'record_version_lab_id_record_table_record_id_version_key',
    },
    {
      name: 'a second counter for one kind in one Lab is refused',
      table: 'lims.counter',
      change: { kind: 'Sample' },
      constraint: 'counter_lab_id_kind_key',
    },
    {
      name: 'a second company-wide Submission counter is refused',
      table: 'lims.counter',
      change: { lab_id: null, kind: 'Submission' },
      constraint: 'counter_lab_id_kind_key',
    },
    {
      name: 'a second session with the same token is refused',
      table: 'lims.session',
      change: { token_hash: token },
      constraint: 'session_token_hash_key',
    },
    {
      name: 'a second System Incident with the same reference is refused',
      table: 'lims.system_incident',
      change: { reference: 'RF000001' },
      constraint: 'system_incident_reference_key',
    },
    {
      name: 'a second Commit Key with the same key in one Lab is refused, from the same session or another, so a press commits once',
      table: 'lims.commit_key',
      change: { key: id.commitKey, session_id: id.session },
      constraint: 'commit_key_pkey',
    },
  ]);
});

describe('the database refuses a reference to a row that does not exist', () => {
  const noLab = (table: Table, noun: string): Case => ({
    name: `a ${noun} in a Lab that does not exist is refused`,
    table,
    change: { lab_id: missing },
    constraint: `${bare(table)}_lab_id_fkey`,
  });
  refusesEach('23503', [
    {
      name: 'an Audit Trail entry on a chain that does not exist is refused',
      table: 'lims.audit_entry',
      change: { chain: 'no-such-chain' },
      constraint: 'audit_entry_chain_fkey',
    },
    {
      name: 'a person of a Customer that does not exist is refused',
      table: 'lims.person',
      change: { customer_id: missing },
      constraint: 'person_customer_id_fkey',
    },
    {
      name: 'a Submission for a Customer that does not exist is refused',
      table: 'lims.submission',
      change: { customer_id: missing },
      constraint: 'submission_customer_id_fkey',
    },
    {
      name: 'a Submission by a person who does not exist is refused',
      table: 'lims.submission',
      change: { submitted_by: missing },
      constraint: 'submission_submitted_by_fkey',
    },
    noLab('lims.membership', 'Lab membership'),
    noLab('lims.audit_export', 'Audit Export'),
    {
      name: 'an Audit Export for a Customer that does not exist is refused',
      table: 'lims.audit_export',
      change: { customer_id: missing },
      constraint: 'audit_export_customer_id_fkey',
    },
    {
      name: 'an Audit Export requested by a person who is not QA in its Lab is refused',
      table: 'lims.audit_export',
      change: { requested_by: id.person },
      constraint: 'audit_export_lab_id_requested_by_requested_role_fkey',
    },
    {
      name: 'a Lab membership of a person who does not exist is refused',
      table: 'lims.membership',
      change: { person_id: missing },
      constraint: 'membership_person_id_fkey',
    },
    noLab('lims.training_record', 'Training Record'),
    {
      name: 'a Training Record of a person who does not exist is refused',
      table: 'lims.training_record',
      change: { person_id: missing },
      constraint: 'training_record_person_id_fkey',
    },
    {
      name: 'a Training Record for a Method that does not exist is refused',
      table: 'lims.training_record',
      change: { method_id: missing },
      constraint: 'training_record_method_id_fkey',
    },
    noLab('lims.sample', 'Sample'),
    {
      name: 'a Sample of a Submission that does not exist is refused',
      table: 'lims.sample',
      change: { submission_id: missing },
      constraint: 'sample_submission_id_fkey',
    },
    noLab('lims.test', 'Test'),
    {
      name: 'a Test of a Sample in another Lab is refused',
      table: 'lims.test',
      change: { lab_id: id.otherLab },
      constraint: 'test_lab_id_sample_id_fkey',
    },
    {
      name: 'a Test by a Method that does not exist is refused',
      table: 'lims.test',
      change: { method_id: missing },
      constraint: 'test_method_id_fkey',
    },
    {
      name: 'a Test assigned to a person who does not exist is refused',
      table: 'lims.test',
      change: { assignee_id: missing },
      constraint: 'test_assignee_id_fkey',
    },
    noLab('lims.result', 'Result'),
    {
      name: 'a Result for a Test in another Lab is refused',
      table: 'lims.result',
      change: { lab_id: id.otherLab },
      constraint: 'result_lab_id_test_id_fkey',
    },
    {
      name: 'a Result entered by a person who does not exist is refused',
      table: 'lims.result',
      change: { entered_by: missing },
      constraint: 'result_entered_by_fkey',
    },
    noLab('lims.test_report', 'Test Report'),
    {
      name: 'a Test Report for a Test in another Lab is refused',
      table: 'lims.test_report',
      change: { lab_id: id.otherLab },
      constraint: 'test_report_lab_id_test_id_fkey',
    },
    noLab('lims.record_version', 'Record Version'),
    noLab('lims.signature', 'Signature'),
    {
      name: 'a Signature by a person who does not exist is refused',
      table: 'lims.signature',
      change: { person_id: missing },
      constraint: 'signature_person_id_fkey',
    },
    {
      name: 'a Signature on a Record Version that does not exist is refused',
      table: 'lims.signature',
      change: { record_version_id: missing },
      constraint: 'signature_lab_id_record_version_id_fkey',
    },
    {
      name: 'a Signature on a Record Version in another Lab is refused',
      table: 'lims.signature',
      change: { lab_id: id.otherLab },
      constraint: 'signature_lab_id_record_version_id_fkey',
    },
    noLab('lims.session', 'session'),
    noLab('lims.counter', 'counter'),
    {
      name: 'a session of a person who does not exist is refused',
      table: 'lims.session',
      change: { person_id: missing },
      constraint: 'session_person_id_fkey',
    },
    noLab('lims.commit_key', 'Commit Key'),
    {
      name: 'a Commit Key of a session that does not exist is refused',
      table: 'lims.commit_key',
      change: { session_id: missing },
      constraint: 'commit_key_lab_id_session_id_fkey',
    },
    {
      name: 'a System Incident requested by a person who does not exist is refused',
      table: 'lims.system_incident',
      change: { requested_by: missing },
      constraint: 'system_incident_requested_by_fkey',
    },
    {
      name: 'a lockout System Incident naming an account that does not exist is refused',
      table: 'lims.system_incident',
      change: { kind: 'Lockout', subject_id: missing, step: null, error_class: null },
      constraint: 'system_incident_subject_id_fkey',
    },
    {
      name: 'a System Incident in a Lab that does not exist is refused',
      table: 'lims.system_incident',
      change: { session_lab_id: missing },
      constraint: 'system_incident_session_lab_id_fkey',
    },
    {
      name: 'an Access Event about a person who does not exist is refused',
      table: 'lims.access_event',
      change: { subject_id: missing },
      constraint: 'access_event_subject_id_fkey',
    },
    {
      name: 'an Access Event of a session that does not exist is refused',
      table: 'lims.access_event',
      change: { kind: 'SignOut', failure_reason: null, session_lab_id: id.lab, session_id: missing },
      constraint: 'access_event_session_lab_id_session_id_subject_id_fkey',
    },
    {
      name: "an Access Event about one person in another person's session is refused",
      table: 'lims.access_event',
      change: {
        kind: 'SignOut',
        failure_reason: null,
        subject_id: id.otherPerson,
        session_lab_id: id.lab,
        session_id: id.session,
      },
      constraint: 'access_event_session_lab_id_session_id_subject_id_fkey',
    },
  ]);

  const testOfKey = 'commit_key_test_after_claim_fkey';
  covered.add(`lims.commit_key.${testOfKey}`);
  it('a Commit Key whose receipt names a Test that does not exist is refused when its transaction commits', async () => {
    await client.query('begin');
    await client.query(...insert('lims.commit_key', { ...tables['lims.commit_key'].row, test_id: missing }));
    const error = await client.query('commit').then(
      () => assert.fail('the database committed a Commit Key for a Test that does not exist'),
      (e: unknown) => (e instanceof pg.DatabaseError ? e : assert.fail(String(e))),
    );
    assertConstraint(error, '23503', 'lims.commit_key', testOfKey);
  });
});

describe('the database refuses a value outside its allowed set', () => {
  const incidentFacts = (what: string, change: Row): Case => ({
    name: `${what} is refused`,
    table: 'lims.system_incident',
    change,
    constraint: 'system_incident_facts_check',
  });
  const each = (name: string, table: Table, column: string, values: unknown[], constraint: string): Case[] =>
    values.map((value) => ({
      name: `${name}: ${JSON.stringify(value)}`,
      table,
      change: { [column]: value },
      constraint,
    }));
  refusesEach('23514', [
    {
      name: 'an Audit Export requested under any role but QA is refused',
      table: 'lims.audit_export',
      change: { requested_role: 'Analyst' },
      constraint: 'audit_export_requested_role_check',
    },
    {
      name: 'an Audit Export with fewer than no entries is refused',
      table: 'lims.audit_export',
      change: { entry_count: -1 },
      constraint: 'audit_export_entry_count_check',
    },
    ...each(
      'an Audit Export whose data file hash is not 32 bytes is refused',
      'lims.audit_export',
      'data_sha256',
      [Buffer.alloc(31), Buffer.alloc(33)],
      'audit_export_data_sha256_check',
    ),
    ...each(
      'an Audit Export whose PDF hash is not 32 bytes is refused',
      'lims.audit_export',
      'pdf_sha256',
      [Buffer.alloc(31), Buffer.alloc(33)],
      'audit_export_pdf_sha256_check',
    ),
    ...each(
      'a Lab code that is not two to four capital letters is refused',
      'lims.lab',
      'code',
      ['rf', 'R', 'RFLAB', 'R1'],
      'lab_code_check',
    ),
    ...each(
      'a Result value that is not a plain decimal as typed is refused',
      'lims.result',
      'value',
      ['', '.03', '0.', '+0.03', '0,03', '3e-2', ' 0.03', 'NaN', '< LOQ'],
      'result_value_check',
    ),
    ...each(
      'a Test GxP Class other than GMP or non-GMP is refused',
      'lims.test',
      'gxp_class',
      ['GxP', 'gmp'],
      'test_gxp_class_check',
    ),
    ...each(
      'a Record Version of a record other than a Test or a Test Report is refused',
      'lims.record_version',
      'record_table',
      ['result', 'sample'],
      'record_version_record_table_check',
    ),
    ...each(
      'a Record Version numbered below 1 is refused',
      'lims.record_version',
      'version',
      [0, -1],
      'record_version_version_check',
    ),
    ...each(
      'a Record Version in a canonical form the LIMS has never written is refused',
      'lims.record_version',
      'canonical_form',
      [2, -1],
      'record_version_canonical_form_check',
    ),
    ...each(
      'an Audit Trail entry for an operation other than insert, update or delete is refused',
      'lims.audit_entry',
      'op',
      ['TRUNCATE', 'insert'],
      'audit_entry_op_check',
    ),
    ...each(
      'a System Incident reference that is not eight read-aloud characters is refused',
      'lims.system_incident',
      'reference',
      ['RF00001', 'RF0000001', 'rf000001', 'RF00000I', 'RF00000O', 'RF00000U'],
      'system_incident_reference_check',
    ),
    ...each(
      'a System Incident SQLSTATE that is not five digits or capitals is refused',
      'lims.system_incident',
      'sqlstate',
      ['2351', '235140', '2351a'],
      'system_incident_sqlstate_check',
    ),
    incidentFacts('an unexpected-failure System Incident without its step', { step: null, error_class: null }),
    incidentFacts('an unexpected-failure System Incident without its error class', { error_class: null }),
    incidentFacts('an unraisable-log-line System Incident without its step', {
      kind: 'UnraisableLogLine',
      step: null,
      error_class: null,
    }),
    incidentFacts('an unexpected-failure System Incident that names an account', { subject_id: id.person }),
    incidentFacts('a lockout System Incident that names no account', {
      kind: 'Lockout',
      step: null,
      error_class: null,
    }),
    incidentFacts('a lockout System Incident with a failing step', { kind: 'Lockout', subject_id: id.person }),
    incidentFacts('a sign-in burst System Incident that names no address', {
      kind: 'SignInBurstFromAddress',
      step: null,
      error_class: null,
    }),
    incidentFacts('an unknown-ID burst System Incident that names no hash', {
      kind: 'SignInBurstOnUnknownUserId',
      step: null,
      error_class: null,
    }),
    incidentFacts('a locked-account System Incident that also names an address', {
      kind: 'RepeatedSignInOnLockedAccount',
      subject_id: id.person,
      source_address: '192.0.2.9',
      step: null,
      error_class: null,
    }),
    {
      name: 'an unknown-ID burst System Incident whose hash is not 32 bytes is refused',
      table: 'lims.system_incident',
      change: {
        kind: 'SignInBurstOnUnknownUserId',
        typed_user_id_hmac: Buffer.alloc(16, 3),
        step: null,
        error_class: null,
      },
      constraint: 'system_incident_typed_user_id_hmac_check',
    },
    {
      name: 'an Audit Trail entry without a transaction ID is refused',
      table: 'lims.audit_entry',
      change: { transaction_id: null },
      constraint: 'audit_entry_transaction_id_check',
    },
    ...each(
      'a Lab in a time zone that is not a named zone of the time zone database is refused',
      'lims.lab',
      'time_zone',
      ['Mars/Olympus_Mons', 'UTC+5', ''],
      'lab_time_zone_check',
    ),
    {
      name: 'a Submission counter that belongs to a Lab is refused',
      table: 'lims.counter',
      change: { kind: 'Submission' },
      constraint: 'counter_check',
    },
    {
      name: 'a Sample counter that belongs to no Lab is refused',
      table: 'lims.counter',
      change: { lab_id: null },
      constraint: 'counter_check',
    },
    {
      name: 'a failed sign-in Access Event that names a session is refused',
      table: 'lims.access_event',
      change: { session_lab_id: id.lab, session_id: id.session },
      constraint: 'access_event_session_kind_check',
    },
    {
      name: 'an Access Event with a session ID but no session Lab is refused',
      table: 'lims.access_event',
      change: { session_id: id.session },
      constraint: 'access_event_session_check',
    },
    ...(['SignInSucceeded', 'SignOut'] as const).map((kind) => ({
      name: `an Access Event of kind ${kind} without a session is refused`,
      table: 'lims.access_event' as const,
      change: { kind, failure_reason: null },
      constraint: 'access_event_session_kind_check',
    })),
    ...(['IdleExpiry', 'AbsoluteExpiry'] as const).flatMap((kind) => [
      {
        name: `an Access Event of kind ${kind} without a session is refused`,
        table: 'lims.access_event' as const,
        change: { kind, failure_reason: null, source_address: null },
        constraint: 'access_event_session_kind_check',
      },
      {
        name: `an Access Event of kind ${kind} with a source address is refused`,
        table: 'lims.access_event' as const,
        change: { kind, failure_reason: null, session_lab_id: id.lab, session_id: id.session },
        constraint: 'access_event_source_address_check',
      },
    ]),
    {
      name: 'an Access Event of a kind other than expiry without a source address is refused',
      table: 'lims.access_event',
      change: { source_address: null },
      constraint: 'access_event_source_address_check',
    },
    {
      name: 'a failed sign-in Access Event without a failure reason is refused',
      table: 'lims.access_event',
      change: { failure_reason: null },
      constraint: 'access_event_failure_check',
    },
    {
      name: 'a lockout Access Event with a failure reason is refused',
      table: 'lims.access_event',
      change: { kind: 'Lockout' },
      constraint: 'access_event_failure_check',
    },
    {
      name: 'an Access Event about a known person that also holds a typed user ID is refused',
      table: 'lims.access_event',
      change: { typed_user_id_hmac: Buffer.alloc(32, 3), typed_user_id_length: 12 },
      constraint: 'access_event_unknown_user_id_check',
    },
    {
      name: 'an unknown user ID attempt without the HMAC of what was typed is refused',
      table: 'lims.access_event',
      change: { ...unknownUserIdAttempt, typed_user_id_hmac: null },
      constraint: 'access_event_unknown_user_id_check',
    },
    {
      name: 'an unknown user ID attempt without the length of what was typed is refused',
      table: 'lims.access_event',
      change: { ...unknownUserIdAttempt, typed_user_id_length: null },
      constraint: 'access_event_unknown_user_id_check',
    },
    {
      name: 'an unknown user ID HMAC that is not 32 bytes is refused',
      table: 'lims.access_event',
      change: { ...unknownUserIdAttempt, typed_user_id_hmac: Buffer.alloc(16, 3) },
      constraint: 'access_event_typed_user_id_hmac_check',
    },
    {
      name: 'an unknown user ID of negative length is refused',
      table: 'lims.access_event',
      change: { ...unknownUserIdAttempt, typed_user_id_length: -1 },
      constraint: 'access_event_typed_user_id_length_check',
    },
    {
      name: 'an Access Event about an unknown user ID that records roles is refused',
      table: 'lims.access_event',
      change: { ...unknownUserIdAttempt, roles: '{Analyst}' },
      constraint: 'access_event_roles_check',
    },
  ]);
});

describe('a counter holds at most six digits and is never empty', () => {
  // The counter trigger lets a counter start only at zero, so these rows reach the constraints with triggers off.
  async function refusalOfCounter(last: number | null): Promise<pg.DatabaseError> {
    await client.query('begin');
    try {
      await client.query('set local session_replication_role = replica');
      await client.query(`insert into lims.counter (lab_id, kind, last) values ($1, 'Sample', $2)`, [
        id.otherLab,
        last,
      ]);
    } catch (error) {
      if (error instanceof pg.DatabaseError) return error;
      throw error;
    } finally {
      await client.query('rollback');
    }
    return assert.fail(`the database accepted a counter at ${last}`);
  }
  covered.add('lims.counter.counter_last_check');
  covered.add('lims.counter.counter_last_not_null');
  it('a counter past 999999 or below zero is refused', async () => {
    for (const last of [1_000_000, -1])
      assertConstraint(await refusalOfCounter(last), '23514', 'lims.counter', 'counter_last_check');
  });
  it('a counter with no value is refused', async () => {
    const error = await refusalOfCounter(null);
    assert.deepEqual([error.code, error.table, error.column], ['23502', 'counter', 'last']);
  });
});

describe('a counter changes only when lims.take_number takes a number, even for the superuser', () => {
  const cases: { name: string; trigger: string; statement: string; values?: unknown[]; numbering?: boolean }[] = [
    {
      name: 'adding a counter outside the numbering function is refused',
      trigger: 'refuse_change',
      statement: `insert into lims.counter (lab_id, kind) values ($1, 'Sample')`,
      values: [id.otherLab],
    },
    {
      name: 'moving a counter outside the numbering function is refused',
      trigger: 'refuse_change',
      statement: 'update lims.counter set last = last + 1',
    },
    {
      name: 'removing a counter is refused',
      trigger: 'refuse_change',
      statement: 'delete from lims.counter',
    },
    {
      name: 'truncating the counters is refused',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.counter',
    },
    {
      name: 'a counter that starts above zero is refused, even inside the numbering function',
      trigger: 'refuse_change',
      statement: `insert into lims.counter (lab_id, kind, last) values ($1, 'Sample', 5)`,
      values: [id.otherLab],
      numbering: true,
    },
    {
      name: 'a counter moved back or by more than one is refused, even inside the numbering function',
      trigger: 'refuse_change',
      statement: 'update lims.counter set last = last + 2',
      numbering: true,
    },
  ];
  for (const c of cases) {
    covered.add(`lims.counter.${c.trigger}`);
    it(c.name, async () => {
      const error = await refusalOf(c.statement, c.values, c.numbering ?? false);
      assert.deepEqual(
        [error.code, error.message],
        ['LA003', 'a counter changes only when lims.take_number takes a number'],
      );
      assert.match(error.where ?? '', /function refuse_counter_change\(\)/);
    });
  }
});

describe('a numbered record keeps its number, even for the superuser', () => {
  const cases: { noun: string; table: Table; id: string }[] = [
    { noun: 'Submission', table: 'lims.submission', id: id.submission },
    { noun: 'Sample', table: 'lims.sample', id: id.sample },
    { noun: 'Test Report', table: 'lims.test_report', id: id.testReport },
  ];
  for (const c of cases) {
    covered.add(`${c.table}.refuse_renumber`);
    it(`changing the number of a ${c.noun} is refused`, async () => {
      const error = await refusalOf(`update ${c.table} set number = number || '-X' where id = $1`, [c.id]);
      assert.deepEqual([error.code, error.message], ['LA006', `a ${bare(c.table)} keeps the number it was given`]);
    });
  }
});

describe('an audited write without an actor, a role and a reason is refused', () => {
  for (const table of auditedTables) {
    covered.add(`${table}.capture`);
    it(`a new ${tables[table].noun} without an actor, a role and a reason is refused`, async () => {
      const error = await refusalOfRow(table, {}, false);
      assert.deepEqual([error.code, error.message], ['LA001', 'an audited write needs an actor, a role and a reason']);
      assert.match(error.where ?? '', /^PL\/pgSQL function capture\(\)/);
    });
  }
});

describe('a Signature, a Record Version, an Access Event, an Audit Trail entry, a Commit Key, a System Incident or an Audit Export is never changed or removed, even by the superuser', () => {
  const cases: { name: string; table: Table; trigger: string; statement: string }[] = [
    {
      name: 'updating an Audit Export is refused',
      table: 'lims.audit_export',
      trigger: 'refuse_change',
      statement: 'update lims.audit_export set entry_count = entry_count + 1',
    },
    {
      name: 'deleting an Audit Export is refused',
      table: 'lims.audit_export',
      trigger: 'refuse_change',
      statement: 'delete from lims.audit_export',
    },
    {
      name: 'truncating the Audit Exports is refused',
      table: 'lims.audit_export',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.audit_export',
    },
    {
      name: 'updating a Record Version is refused',
      table: 'lims.record_version',
      trigger: 'refuse_change',
      statement: `update lims.record_version set version = version + 10`,
    },
    {
      name: 'deleting a Record Version is refused',
      table: 'lims.record_version',
      trigger: 'refuse_change',
      statement: 'delete from lims.record_version',
    },
    {
      // Postgres refuses to truncate a foreign-key target on its own, so the Signatures are named with it.
      name: 'truncating the Record Versions is refused',
      table: 'lims.record_version',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.record_version, lims.signature',
    },
    {
      name: 'updating a Signature is refused',
      table: 'lims.signature',
      trigger: 'refuse_change',
      statement: `update lims.signature set meaning = 'Released'`,
    },
    {
      name: 'deleting a Signature is refused',
      table: 'lims.signature',
      trigger: 'refuse_change',
      statement: 'delete from lims.signature',
    },
    {
      name: 'truncating the Signatures is refused',
      table: 'lims.signature',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.signature',
    },
    {
      name: "changing a Commit Key's receipt is refused",
      table: 'lims.commit_key',
      trigger: 'refuse_change',
      statement: `update lims.commit_key set state = 'Reported'`,
    },
    {
      name: 'deleting a Commit Key is refused, so a late retry cannot commit again',
      table: 'lims.commit_key',
      trigger: 'refuse_change',
      statement: 'delete from lims.commit_key',
    },
    {
      name: 'truncating the Commit Keys is refused',
      table: 'lims.commit_key',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.commit_key',
    },
    {
      name: 'updating an Access Event is refused',
      table: 'lims.access_event',
      trigger: 'refuse_change',
      statement: `update lims.access_event set failure_reason = null, kind = 'SignOut'`,
    },
    {
      name: 'deleting an Access Event is refused',
      table: 'lims.access_event',
      trigger: 'refuse_change',
      statement: 'delete from lims.access_event',
    },
    {
      name: 'truncating the Access Events is refused',
      table: 'lims.access_event',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.access_event',
    },
    {
      name: 'truncating the Audit Trail is refused',
      table: 'lims.audit_entry',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.audit_entry',
    },
    {
      name: 'deleting a System Incident is refused',
      table: 'lims.system_incident',
      trigger: 'refuse_change',
      statement: 'delete from lims.system_incident',
    },
    {
      name: 'truncating the System Incidents is refused',
      table: 'lims.system_incident',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.system_incident',
    },
  ];
  for (const c of cases) {
    covered.add(`${c.table}.${c.trigger}`);
    it(c.name, async () => {
      const error = await refusalOf(c.statement);
      assert.deepEqual([error.code, error.message], ['LA002', `${bare(c.table)} rows are never changed or removed`]);
      assert.match(error.where ?? '', /function lims\.refuse_change\(\)/);
    });
  }
  covered.add('lims.system_incident.keep_facts');
  it("changing any of a System Incident's recorded facts is refused", async () => {
    const changes: Row = {
      id: randomUUID(),
      reference: 'RF000009',
      opened_at: '2026-09-30T00:00:00Z',
      requested_by: null,
      session_lab_id: id.otherLab,
      step: 'release',
      record_id: null,
      error_class: 'TypeError',
      sqlstate: null,
      constraint_name: null,
      subject_id: id.person,
      source_address: '192.0.2.9',
      typed_user_id_hmac: Buffer.alloc(32, 9),
    };
    for (const [column, value] of Object.entries(changes)) {
      const error = await refusalOf(
        `update lims.system_incident set ${pg.escapeIdentifier(column)} = $1 where id = $2`,
        [value, id.systemIncident],
      );
      assert.deepEqual(
        [error.code, error.message],
        ['LA002', "a System Incident's recorded facts are never changed"],
        column,
      );
    }
  });
});

it('every lims table is captured in the Audit Trail except the sessions, the Commit Keys, the counters and the Audit Trail itself', async () => {
  const { rows } = await client.query<{ name: string }>(
    `select 'lims.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'lims' and c.relkind = 'r'
        and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'capture')
      order by 1`,
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ['lims.audit_chain', 'lims.audit_entry', 'lims.commit_key', 'lims.counter', 'lims.session'],
  );
});

it('every constraint and trigger of a freshly migrated database has a refusing test', async () => {
  const elsewhere = new Map([
    ['lims.audit_entry.refuse_change', 'audit-trail.test.ts'],
    ['lims.access_event.open_incident', 'sign-in-incidents.test.ts'],
    ['public.schema_migration.refuse_change', 'migrate.test.ts'],
    ['public.schema_migration.refuse_truncate', 'migrate.test.ts'],
    ['public.schema_migration.schema_migration_sha256_not_null', 'migrate.test.ts'],
    ['public.schema_migration.schema_migration_sha256_check', 'migrate.test.ts'],
    [
      'lims.record_version.record_version_content_hash_not_null',
      'unreachable: generated from content, which is not null',
    ],
    ['lims.session.session_lab_id_id_person_id_key', 'unreachable: (lab_id, id) is already the key'],
    ['lims.test.version_record', 'record-version.test.ts'],
    ['lims.result.version_record', 'record-version.test.ts'],
    ['lims.test_report.version_record', 'record-version.test.ts'],
    ['lims.sample.version_record', 'record-version.test.ts'],
    ['lims.submission.version_record', 'record-version.test.ts'],
    ['lims.method.version_record', 'record-version.test.ts'],
    ['lims.customer.version_record', 'record-version.test.ts'],
  ]);
  const { rows } = await client.query<{ rule: string }>(
    `select n.nspname || '.' || c.relname || '.' || k.conname as rule
       from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('lims', 'public')
     union all
     select n.nspname || '.' || c.relname || '.' || t.tgname
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('lims', 'public')`,
  );
  const rules = rows.map((row) => row.rule).sort();
  assert.deepEqual(rules, [...covered, ...elsewhere.keys()].sort());
});
