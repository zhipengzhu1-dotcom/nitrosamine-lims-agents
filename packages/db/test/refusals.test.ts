import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();

const DATABASE = checkoutDatabase('lims_refusals_test');
const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });

type Row = Record<string, unknown>;
type Literal = { literal: string };
/** A column value written as the SQL given, for a value the fixture can only read from the database. */
const literal = (text: string): Literal => ({ literal: text });
const isLiteral = (value: unknown): value is Literal =>
  typeof value === 'object' && value !== null && 'literal' in value;

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
  otherSession: randomUUID(),
  systemIncident: randomUUID(),
  commitKey: randomUUID(),
  transaction: randomUUID(),
  accessEvent: randomUUID(),
  otherPerson: randomUUID(),
  auditExport: randomUUID(),
  otherPersonSession: randomUUID(),
  reauthentication: randomUUID(),
  secondReauthentication: randomUUID(),
  probeReauthentication: randomUUID(),
  probeReport: randomUUID(),
  secondSession: randomUUID(),
  admin: randomUUID(),
  operator: randomUUID(),
  verified: randomUUID(),
  chainVerification: randomUUID(),
  identityVerification: randomUUID(),
  credentialLink: randomUUID(),
  secondAdmin: randomUUID(),
  enrolmentGrant: randomUUID(),
  room: randomUUID(),
  otherLabRoom: randomUUID(),
  workstation: randomUUID(),
  lockedOut: randomUUID(),
};
const missing = randomUUID();
const token = Buffer.alloc(32, 1);
const deviceToken = Buffer.alloc(32, 2);
/** What a chain-verify System Incident records of the one break at `entry`. */
const oneBreak = (entry: number) => ({
  first_failure: entry,
  last_failure: entry,
  break_count: 1,
  fingerprint: Buffer.alloc(32, 7),
});
const zeros = Buffer.alloc(32);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
const fixtureContent = Buffer.from('{"id":"fixture"}');
/** Signature statement 1's hash, read from the migrated database before the fixtures are written. */
let statementHash: Buffer = zeros;

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
  ['lims.person', { id: id.admin, username: 'refusal.admin', display_name: 'Refusal Admin' }],
  ['lims.person', { id: id.operator, username: 'refusal.operator', display_name: 'Refusal Operator' }],
  // A second Admin, who created no account and issued no one-time link, so an enrolment grant can come from them.
  ['lims.person', { id: id.secondAdmin, username: 'refusal.second', display_name: 'Second Admin' }],
  [
    'lims.person',
    {
      id: id.lockedOut,
      username: 'refusal.locked',
      display_name: 'Locked Person',
      password_hash: 'not-a-real-hash',
    },
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
  ['lims.membership', { lab_id: id.otherLab, person_id: id.admin, role: 'Admin' }],
  ['lims.membership', { lab_id: id.otherLab, person_id: id.secondAdmin, role: 'Admin' }],
  ['lims.membership', { lab_id: id.lab, person_id: id.operator, role: 'PlatformOperator' }],
  [
    'lims.identity_verification',
    {
      id: id.identityVerification,
      printed_name: 'Vera Checked',
      evidence: 'Passport seen in person (fictional)',
      checked_by: id.admin,
      checked_in_lab_id: id.otherLab,
    },
  ],
  [
    'lims.person',
    {
      id: id.verified,
      username: 'refusal.verified',
      display_name: 'Vera Checked',
      identity_verification_id: id.identityVerification,
    },
  ],
  ['lims.credential_link', { id: id.credentialLink, person_id: id.verified, token_hash: Buffer.alloc(32, 5) }],
  [
    'lims.enrolment_grant',
    { id: id.enrolmentGrant, person_id: id.verified, issued_by: id.secondAdmin, token_hash: Buffer.alloc(32, 11) },
  ],
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
      content: fixtureContent,
    },
  ],
  ['lims.room', { lab_id: id.lab, id: id.room, name: 'LC-MS/MS Room (fictional)' }],
  ['lims.room', { lab_id: id.otherLab, id: id.otherLabRoom, name: 'Other Lab Room (fictional)' }],
  [
    'lims.workstation',
    {
      lab_id: id.lab,
      id: id.workstation,
      name: 'RF-BENCH-01',
      room_id: id.room,
      browser_policy: 'Managed Chrome',
      device_token_hash: deviceToken,
    },
  ],
  ['lims.session', { lab_id: id.lab, id: id.session, person_id: id.person, token_hash: token }],
  ['lims.session', { lab_id: id.otherLab, id: id.otherSession, person_id: id.person, token_hash: Buffer.alloc(32, 4) }],
  [
    'lims.session',
    { lab_id: id.lab, id: id.otherPersonSession, person_id: id.otherPerson, token_hash: Buffer.alloc(32, 5) },
  ],
  ['lims.session', { lab_id: id.lab, id: id.secondSession, person_id: id.person, token_hash: Buffer.alloc(32, 6) }],
  [
    'lims.reauthentication',
    {
      lab_id: id.lab,
      id: id.reauthentication,
      session_id: id.session,
      person_id: id.person,
      meaning: 'Performed',
      authenticator: 'Password',
    },
  ],
  [
    'lims.reauthentication',
    {
      lab_id: id.lab,
      id: id.secondReauthentication,
      session_id: id.session,
      person_id: id.person,
      meaning: 'Performed',
      authenticator: 'Password',
    },
  ],
  [
    'lims.signature',
    {
      lab_id: id.lab,
      id: id.signature,
      person_id: id.person,
      printed_name: 'Refusal Person',
      username: 'refusal.person',
      role: 'Analyst',
      meaning: 'Performed',
      record_version_id: id.laterRecordVersion,
      content_hash: sha256(fixtureContent),
      canonical_form: 0,
      statement_version: 1,
      get statement_hash() {
        return statementHash;
      },
      authenticator: 'Password',
      session_id: id.session,
      app_release: 'test',
      reauthentication_id: id.reauthentication,
    },
  ],
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
    'lims.system_incident',
    {
      kind: 'ChainVerifyFailure',
      reference: 'RF000003',
      requested_by: id.person,
      session_lab_id: id.lab,
      chain: id.lab,
      first_failure: 7,
      last_failure: 7,
      break_count: 1,
      fingerprint: Buffer.alloc(32, 7),
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
    'lims.chain_verification',
    {
      id: id.chainVerification,
      chain: 'company',
      through: 1,
      head: literal("(select hash from lims.audit_entry where chain = 'company' and seq = 1)"),
      recomputed_from: 1,
      verified_by: id.otherPerson,
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
  [
    'lims.access_event',
    {
      kind: 'LabSwitch',
      subject_id: id.person,
      source_address: '192.0.2.1',
      session_lab_id: id.lab,
      session_id: id.session,
      previous_session_lab_id: id.otherLab,
      previous_session_id: id.otherSession,
      roles: '{Analyst}',
    },
  ],
];
const labSwitch: Row = {
  kind: 'LabSwitch',
  failure_reason: null,
  session_lab_id: id.lab,
  session_id: id.session,
  previous_session_lab_id: id.otherLab,
  previous_session_id: id.otherSession,
};
const unknownUserIdAttempt: Row = {
  kind: 'SignInFailed',
  failure_reason: 'UnknownUserId',
  subject_id: null,
  typed_user_id_hmac: Buffer.alloc(32, 3),
  typed_user_id_length: 12,
  roles: '{}',
};

const takeover: Row = {
  kind: 'Takeover',
  failure_reason: null,
  session_lab_id: id.lab,
  session_id: id.session,
  taken_by_id: id.otherPerson,
};

const tables = {
  'lims.customer': {
    noun: 'Customer',
    row: { name: 'Second Refusal Customer (fictional)' },
    notNull: ['id', 'name'],
  },
  'lims.person': {
    noun: 'person',
    row: { username: 'refusal.another', display_name: 'Another Person', password_hash: 'not-a-real-hash' },
    notNull: ['id', 'username', 'display_name', 'failed_logins', 'reduced_motion'],
  },
  'lims.identity_verification': {
    noun: 'Identity Verification',
    row: {
      printed_name: 'Second Checked',
      evidence: 'Driving licence seen in person (fictional)',
      checked_by: id.admin,
      checked_in_lab_id: id.otherLab,
    },
    notNull: ['id', 'printed_name', 'evidence', 'checked_by', 'checked_in_lab_id', 'checked_at'],
  },
  'lims.credential_link': {
    noun: 'one-time link',
    row: { person_id: id.verified, token_hash: Buffer.alloc(32, 6) },
    notNull: ['id', 'person_id', 'token_hash', 'issued_at', 'expires_at'],
  },
  'lims.enrolment_grant': {
    noun: 'enrolment grant',
    row: { person_id: id.verified, issued_by: id.secondAdmin, token_hash: Buffer.alloc(32, 12) },
    notNull: ['id', 'person_id', 'issued_by', 'token_hash', 'issued_at', 'expires_at'],
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
    row: {
      lab_id: id.lab,
      person_id: id.person,
      printed_name: 'Refusal Person',
      username: 'refusal.person',
      role: 'Analyst',
      meaning: 'Performed',
      record_version_id: id.laterRecordVersion,
      content_hash: sha256(fixtureContent),
      canonical_form: 0,
      statement_version: 1,
      get statement_hash() {
        return statementHash;
      },
      authenticator: 'Password',
      session_id: id.session,
      app_release: 'test',
      reauthentication_id: id.secondReauthentication,
    },
    notNull: [
      'lab_id',
      'id',
      'person_id',
      'role',
      'meaning',
      'record_version_id',
      'content_hash',
      'canonical_form',
      'signed_at',
    ],
  },
  'lims.signature_statement': {
    noun: 'signature statement',
    row: { version: 2, statement: Buffer.from('A second statement (fictional).') },
    notNull: ['version', 'statement', 'approved_at'],
  },
  'lims.signing_role': {
    noun: 'signing role',
    row: { role: 'Reviewer', meaning: 'Performed' },
    notNull: ['role', 'meaning'],
  },
  'lims.reauthentication': {
    noun: 're-authentication record',
    row: {
      lab_id: id.lab,
      session_id: id.session,
      person_id: id.person,
      meaning: 'Released',
      authenticator: 'Password',
    },
    notNull: ['lab_id', 'id', 'session_id', 'person_id', 'meaning', 'authenticator', 'at'],
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
  'lims.room': {
    noun: 'Room',
    row: { lab_id: id.lab, name: 'Sample Preparation Room (fictional)' },
    notNull: ['lab_id', 'id', 'name'],
  },
  'lims.workstation': {
    noun: 'Workstation',
    row: { lab_id: id.lab, name: 'RF-BENCH-02', room_id: id.room, browser_policy: 'Managed Chrome' },
    notNull: ['lab_id', 'id', 'name', 'room_id', 'browser_policy'],
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
  'lims.chain_verification': {
    noun: 'Chain Verification',
    row: {
      chain: 'company',
      through: 1,
      head: literal("(select hash from lims.audit_entry where chain = 'company' and seq = 1)"),
      recomputed_from: 1,
      verified_by: id.otherPerson,
    },
    notNull: ['id', 'chain', 'through', 'head', 'recomputed_from', 'verified_by', 'verified_at'],
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
  'lims.signature_statement',
  'lims.signing_role',
  'lims.reauthentication',
  'lims.system_incident',
  'lims.access_event',
  'lims.audit_export',
  'lims.chain_verification',
  'lims.identity_verification',
  'lims.credential_link',
  'lims.enrolment_grant',
  'lims.room',
  'lims.workstation',
];

const bare = (table: string) => table.slice(table.indexOf('.') + 1);

function insert(table: string, row: Row): [string, unknown[]] {
  const columns = Object.keys(row);
  const names = columns.map((column) => pg.escapeIdentifier(column)).join(', ');
  const values: unknown[] = [];
  const params = Object.values(row)
    .map((value) => (isLiteral(value) ? value.literal : `$${values.push(value)}`))
    .join(', ');
  return [`insert into ${table} (${names}) values (${params})`, values];
}

// The Admin acts, so that an Identity Verification's checker is the actor of its write.
const AUDIT_CONTEXT = `select set_config('lims.actor', 'person:refusal.admin', true), set_config('lims.role', 'system', true),
                              set_config('lims.reason', 'Probe a refusal', true),
                              lims.set_this_transaction('lims.numbering', 'on')`;

/** The role the transaction acts in, as the API sets it from the step registry. */
const asRole = (role: string) => `select set_config('lims.role', '${role}', true)`;

/** A person who holds `role` acting in it: Other Person holds QA, the Admin holds Admin. */
const actingAs = (role: 'QA' | 'Admin') =>
  `select set_config('lims.actor', 'person:${role === 'QA' ? 'refusal.other' : 'refusal.admin'}', true), set_config('lims.role', '${role}', true)`;

/** The stamp lims.sign leaves, so a probe row reaches the constraints behind the sign_only trigger. */
const signingStamp = (row: Row) =>
  typeof row.reauthentication_id === 'string'
    ? client.query('select lims.set_this_transaction($1, $2)', ['lims.signing', row.reauthentication_id])
    : Promise.resolve();

async function refusalOf(
  statement: string,
  values: unknown[] = [],
  context = true,
  row: Row = {},
): Promise<pg.DatabaseError> {
  await client.query('begin');
  try {
    if (context) await client.query(AUDIT_CONTEXT);
    await signingStamp(row);
    await client.query(statement, values);
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  } finally {
    await client.query('rollback');
  }
  return assert.fail(`the database accepted ${statement}`);
}

/** Like refusalOf, with triggers off, for a row a trigger would otherwise stamp over or refuse first. */
async function refusalWithTriggersOff(statement: string, values: unknown[]): Promise<pg.DatabaseError> {
  await client.query('begin');
  try {
    await client.query('set local session_replication_role = replica');
    await client.query(statement, values);
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  } finally {
    await client.query('rollback');
  }
  return assert.fail(`the database accepted ${statement}`);
}

function refusalOfRow(table: Table, change: Row = {}, context = true) {
  const row = { ...tables[table].row, ...change };
  return refusalOf(...insert(table, row), context, row);
}

function assertConstraint(error: pg.DatabaseError, code: string, table: Table, constraint: string): void {
  assert.deepEqual([error.code, error.table, error.constraint], [code, bare(table), constraint], error.message);
}

const covered = new Set<string>();

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(DATABASE)} with (force)`);
  } finally {
    await admin.end();
  }
  await migrate(server, DATABASE);
  await client.connect();
  ({ statementHash } =
    (
      await client.query<{ statementHash: Buffer }>(
        'select statement_hash as "statementHash" from lims.signature_statement where version = 1',
      )
    ).rows[0] ?? assert.fail('the migration seeds signature statement 1'));
  for (const [table, row] of fixture) {
    await client.query('begin');
    await client.query(AUDIT_CONTEXT);
    if (table === 'lims.chain_verification') await client.query(actingAs('QA'));
    await signingStamp(row);
    await client.query(...insert(table, row));
    await client.query('commit');
  }
  await client.query('begin');
  await client.query(AUDIT_CONTEXT);
  await client.query('update lims.person set locked_at = clock_timestamp() where id = $1', [id.lockedOut]);
  await client.query(
    ...insert('lims.access_event', {
      kind: 'Lockout',
      subject_id: id.lockedOut,
      source_address: '192.0.2.1',
      roles: '{}',
    }),
  );
  await client.query('commit');
});

after(() => client.end());

it('the base row of every table is accepted, so each refusal below comes from the one change it makes', async () => {
  for (const table of tableNames) {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      if (table === 'lims.chain_verification') await client.query(actingAs('QA'));
      await signingStamp(tables[table].row);
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
    'lims.identity_verification': { id: id.identityVerification },
    'lims.credential_link': { id: id.credentialLink },
    'lims.enrolment_grant': { id: id.enrolmentGrant },
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
    'lims.signature_statement': { version: 1 },
    'lims.signing_role': { role: 'Analyst', meaning: 'Performed' },
    'lims.reauthentication': { id: id.reauthentication },
    'lims.session': { id: id.session },
    'lims.system_incident': { id: id.systemIncident },
    'lims.commit_key': { key: id.commitKey },
    'lims.access_event': { id: id.accessEvent },
    'lims.audit_export': { id: id.auditExport },
    'lims.chain_verification': { id: id.chainVerification },
    'lims.room': { id: id.room },
    'lims.workstation': { id: id.workstation },
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
      name: 'a second account on one Identity Verification is refused',
      table: 'lims.person',
      change: { identity_verification_id: id.identityVerification },
      constraint: 'person_identity_verification_id_key',
    },
    {
      name: 'a second one-time link with the same token is refused',
      table: 'lims.credential_link',
      change: { token_hash: Buffer.alloc(32, 5) },
      constraint: 'credential_link_token_hash_key',
    },
    {
      name: 'a second enrolment grant with the same token is refused',
      table: 'lims.enrolment_grant',
      change: { token_hash: Buffer.alloc(32, 11) },
      constraint: 'enrolment_grant_token_hash_key',
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
      name: 'a second Lab switch out of the same session is refused',
      table: 'lims.access_event',
      change: labSwitch,
      constraint: 'access_event_previous_session_key',
    },
    {
      name: 'a second Lockout Access Event for the same person and instant, one lock, is refused',
      table: 'lims.access_event',
      change: { kind: 'Lockout', failure_reason: null, subject_id: id.lockedOut },
      constraint: 'access_event_one_lockout_per_lock',
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
      name: 'a second Signature against one re-authentication record is refused, so the record is single-use',
      table: 'lims.signature',
      change: { reauthentication_id: id.reauthentication },
      constraint: 'signature_reauthentication_id_key',
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
      name: 'a second Room of the same name in one Lab is refused',
      table: 'lims.room',
      change: { name: 'LC-MS/MS Room (fictional)' },
      constraint: 'room_lab_id_name_key',
    },
    {
      name: 'a second Workstation of the same name in one Lab is refused',
      table: 'lims.workstation',
      change: { name: 'RF-BENCH-01' },
      constraint: 'workstation_lab_id_name_key',
    },
    {
      name: 'a Workstation with the ID of one in another Lab is refused',
      table: 'lims.workstation',
      change: { lab_id: id.otherLab, id: id.workstation, room_id: id.otherLabRoom },
      constraint: 'workstation_id_key',
    },
    {
      name: 'a second Workstation enrolled with the same device token is refused',
      table: 'lims.workstation',
      change: { device_token_hash: deviceToken },
      constraint: 'workstation_device_token_hash_key',
    },
    {
      name: 'a second System Incident with the same reference is refused',
      table: 'lims.system_incident',
      change: { reference: 'RF000001' },
      constraint: 'system_incident_reference_key',
    },
    {
      name: 'a second chain-verify System Incident for the same break, at the same entry with the same fingerprint, is refused',
      table: 'lims.system_incident',
      change: { kind: 'ChainVerifyFailure', step: null, error_class: null, chain: id.lab, ...oneBreak(7) },
      constraint: 'system_incident_chain_break_key',
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
      name: 'a person on an Identity Verification that does not exist is refused',
      table: 'lims.person',
      change: { identity_verification_id: missing },
      constraint: 'person_identity_verification_id_fkey',
    },
    {
      name: 'an Identity Verification by a checker who does not exist is refused',
      table: 'lims.identity_verification',
      change: { checked_by: missing },
      constraint: 'identity_verification_checked_by_fkey',
    },
    {
      name: 'an Identity Verification checked in a Lab that does not exist is refused',
      table: 'lims.identity_verification',
      change: { checked_in_lab_id: missing },
      constraint: 'identity_verification_checked_in_lab_id_fkey',
    },
    {
      name: 'a one-time link for a person who does not exist is refused',
      table: 'lims.credential_link',
      change: { person_id: missing },
      constraint: 'credential_link_person_id_fkey',
    },
    {
      name: 'an enrolment grant for a person who does not exist is refused',
      table: 'lims.enrolment_grant',
      change: { person_id: missing },
      constraint: 'enrolment_grant_person_id_fkey',
    },
    {
      name: 'an enrolment grant issued by a person who does not exist is refused',
      table: 'lims.enrolment_grant',
      change: { issued_by: missing },
      constraint: 'enrolment_grant_issued_by_fkey',
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
      name: 'a Chain Verification by a person who does not exist is refused',
      table: 'lims.chain_verification',
      change: { verified_by: missing },
      constraint: 'chain_verification_verified_by_fkey',
    },
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
    {
      name: 'a Signature on a Record Version that does not exist is refused',
      table: 'lims.signature',
      change: { record_version_id: missing },
      constraint: 'signature_record_version_fkey',
    },
    {
      name: 'a Signature on a Record Version in another Lab is refused',
      table: 'lims.signature',
      change: { lab_id: id.otherLab },
      constraint: 'signature_record_version_fkey',
    },
    {
      name: "a Signature whose hash is not its Record Version's is refused",
      table: 'lims.signature',
      change: { content_hash: zeros },
      constraint: 'signature_record_version_fkey',
    },
    {
      name: "a Signature whose canonical form is not its Record Version's is refused",
      table: 'lims.signature',
      change: { canonical_form: 1 },
      constraint: 'signature_record_version_fkey',
    },
    {
      name: "a Signature whose statement hash is not its statement version's is refused",
      table: 'lims.signature',
      change: { statement_hash: zeros },
      constraint: 'signature_statement_version_statement_hash_fkey',
    },
    {
      name: 'a Signature against a re-authentication record that does not exist is refused',
      table: 'lims.signature',
      change: { reauthentication_id: missing },
      constraint: 'signature_reauthentication_fkey',
    },
    {
      name: "a Signature with a meaning other than its re-authentication record's is refused",
      table: 'lims.signature',
      change: { meaning: 'Released' },
      constraint: 'signature_reauthentication_fkey',
    },
    {
      name: "a Signature by an authenticator other than its re-authentication record's is refused",
      table: 'lims.signature',
      change: { authenticator: 'Totp' },
      constraint: 'signature_reauthentication_fkey',
    },
    {
      name: "a Signature on a live session of the signer other than its re-authentication record's is refused",
      table: 'lims.signature',
      change: { session_id: id.secondSession },
      constraint: 'signature_reauthentication_fkey',
    },
    noLab('lims.reauthentication', 're-authentication record'),
    {
      name: 'a re-authentication record of a person who does not exist is refused',
      table: 'lims.reauthentication',
      change: { person_id: missing },
      constraint: 'reauthentication_person_id_fkey',
    },
    {
      name: 'a re-authentication record on a session that does not exist is refused',
      table: 'lims.reauthentication',
      change: { session_id: missing },
      constraint: 'reauthentication_lab_id_session_id_person_id_fkey',
    },
    {
      name: "a re-authentication record on another person's session is refused",
      table: 'lims.reauthentication',
      change: { person_id: id.otherPerson },
      constraint: 'reauthentication_lab_id_session_id_person_id_fkey',
    },
    noLab('lims.session', 'session'),
    noLab('lims.room', 'Room'),
    {
      name: 'a Workstation in a Room of another Lab is refused',
      table: 'lims.workstation',
      change: { room_id: id.otherLabRoom },
      constraint: 'workstation_lab_id_room_id_fkey',
    },
    {
      name: 'a session on a Workstation of another Lab is refused',
      table: 'lims.session',
      change: { lab_id: id.otherLab, workstation_id: id.workstation },
      constraint: 'session_lab_id_workstation_id_fkey',
    },
    {
      name: 'an Access Event on a Workstation that does not exist is refused',
      table: 'lims.access_event',
      change: { workstation_id: missing },
      constraint: 'access_event_workstation_id_fkey',
    },
    {
      name: 'a takeover Access Event by a person who does not exist is refused',
      table: 'lims.access_event',
      change: { ...takeover, taken_by_id: missing },
      constraint: 'access_event_taken_by_id_fkey',
    },
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
      name: "a System Incident whose QA's answer names a person who does not exist is refused",
      table: 'lims.system_incident',
      change: { impact_answer: 'Yes', impact_answered_by: missing, impact_answered_at: '2026-09-30T00:00:00Z' },
      constraint: 'system_incident_impact_answered_by_fkey',
    },
    {
      name: 'a System Incident whose immediate action names a person who does not exist is refused',
      table: 'lims.system_incident',
      change: { immediate_action: 'Reran.', immediate_action_by: missing, immediate_action_at: '2026-09-30T00:00:00Z' },
      constraint: 'system_incident_immediate_action_by_fkey',
    },
    {
      name: 'a System Incident whose corrective action names a person who does not exist is refused',
      table: 'lims.system_incident',
      change: {
        corrective_action: 'Added a check.',
        corrective_action_by: missing,
        corrective_action_at: '2026-09-30T00:00:00Z',
      },
      constraint: 'system_incident_corrective_action_by_fkey',
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
    {
      name: 'a Lab switch Access Event from a session that does not exist is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, previous_session_id: missing },
      constraint: 'access_event_previous_session_fkey',
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
  const impactCases: [string, Row][] = [
    ['an answer with no answering person', { impact_answer: 'Yes', impact_answered_at: '2026-09-30T00:00:00Z' }],
    [
      'an answering person with no answer',
      { impact_answered_by: id.person, impact_answered_at: '2026-09-30T00:00:00Z' },
    ],
    [
      'a No answer on a chain-verify System Incident',
      {
        kind: 'ChainVerifyFailure',
        step: null,
        error_class: null,
        chain: 'company',
        ...oneBreak(3),
        impact_answer: 'No',
        impact_answered_by: id.person,
        impact_answered_at: '2026-09-30T00:00:00Z',
      },
    ],
  ];
  refusesEach('23514', [
    ...each(
      'a Chain Verification of a chain the Audit Trail does not name is refused',
      'lims.chain_verification',
      'chain',
      ['Company', 'lab', 'not-a-uuid'],
      'chain_verification_chain_check',
    ),
    {
      name: 'a Chain Verification through no entry is refused',
      table: 'lims.chain_verification',
      change: { through: 0 },
      constraint: 'chain_verification_through_check',
    },
    ...each(
      'a Chain Verification whose hash is not 32 bytes is refused',
      'lims.chain_verification',
      'head',
      [Buffer.alloc(31), Buffer.alloc(33)],
      'chain_verification_head_check',
    ),
    ...each(
      'a Chain Verification that recomputed from before its first entry or after the entry past the one it verified through is refused',
      'lims.chain_verification',
      'recomputed_from',
      [0, 3],
      'chain_verification_recomputed_from_check',
    ),
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
      'a signature statement version below 1 is refused',
      'lims.signature_statement',
      'version',
      [0, -1],
      'signature_statement_version_check',
    ),
    ...each(
      'a re-authentication by an authenticator the LIMS does not have is refused',
      'lims.reauthentication',
      'authenticator',
      ['Totp', 'Code', 'password', ''],
      'reauthentication_authenticator_check',
    ),
    {
      name: 'a Signature with an empty app release is refused',
      table: 'lims.signature',
      change: { app_release: '' },
      constraint: 'signature_app_release_check',
    },
    ...['statement_version', 'statement_hash', 'authenticator', 'session_id', 'app_release'].map((column) => ({
      name: `a Signature given now without its ${column} is refused`,
      table: 'lims.signature' as const,
      change: { [column]: null },
      constraint: 'signature_given_through_function_check',
    })),
    {
      name: 'a failed re-authentication Access Event without a session is refused',
      table: 'lims.access_event',
      change: {
        kind: 'ReauthenticationFailed',
        failure_reason: 'WrongPassword',
        session_lab_id: null,
        session_id: null,
      },
      constraint: 'access_event_session_kind_check',
    },
    {
      name: 'a failed re-authentication Access Event without a failure reason is refused',
      table: 'lims.access_event',
      change: { kind: 'ReauthenticationFailed', failure_reason: null, session_lab_id: id.lab, session_id: id.session },
      constraint: 'access_event_failure_check',
    },
    {
      name: 'a failed sign-in Access Event with the typed-user-ID failure of a signing is refused',
      table: 'lims.access_event',
      change: { kind: 'SignInFailed', failure_reason: 'WrongUserId' },
      constraint: 'access_event_failure_kind_check',
    },
    {
      name: 'a failed unlock Access Event without a failure reason is refused',
      table: 'lims.access_event',
      change: { kind: 'UnlockFailed', failure_reason: null, session_lab_id: id.lab, session_id: id.session },
      constraint: 'access_event_unlock_failure_check',
    },
    ...['NoCredential', 'NoLab', 'NoMembership', 'NotInWorkstationLab'].map((reason) => ({
      name: `a failed unlock Access Event with the ${reason} reason, which no password, code or Lockout gives, is refused`,
      table: 'lims.access_event' as const,
      change: { kind: 'UnlockFailed', failure_reason: reason, session_lab_id: id.lab, session_id: id.session },
      constraint: 'access_event_failure_kind_check',
    })),
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
      'a Record Version of a record other than a Test, a Test Report or a System Incident is refused',
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
    ...impactCases.map(
      ([what, change]): Case => ({
        name: `${what} is refused`,
        table: 'lims.system_incident',
        change,
        constraint: 'system_incident_impact_answer_check',
      }),
    ),
    ...(['immediate', 'corrective'] as const).flatMap((action): Case[] => {
      const partial: [string, Row][] = [
        [`a blank ${action} action`, { [`${action}_action`]: ' ', [`${action}_action_by`]: id.person }],
        [`a newline-only ${action} action`, { [`${action}_action`]: '\n\t\n', [`${action}_action_by`]: id.person }],
        [
          `an ${action} action longer than 2000 characters`,
          { [`${action}_action`]: 'x'.repeat(2001), [`${action}_action_by`]: id.person },
        ],
        [`an ${action} action with no recording person`, { [`${action}_action`]: 'Done.' }],
        [`a recording person with no ${action} action`, { [`${action}_action_by`]: id.person }],
      ];
      return partial.map(([what, change]) => ({
        name: `${what} is refused`,
        table: 'lims.system_incident',
        change: { [`${action}_action_at`]: '2026-09-30T00:00:00Z', ...change },
        constraint: `system_incident_${action}_action_check`,
      }));
    }),
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
    incidentFacts('an unexpected-failure System Incident that names a chain', { chain: id.lab, ...oneBreak(7) }),
    incidentFacts('a chain-verify System Incident that names no chain', {
      kind: 'ChainVerifyFailure',
      step: null,
      error_class: null,
    }),
    incidentFacts('a chain-verify System Incident with a failing step', {
      kind: 'ChainVerifyFailure',
      chain: 'company',
      ...oneBreak(3),
    }),
    incidentFacts('a chain-verify System Incident that names no first failing entry', {
      kind: 'ChainVerifyFailure',
      step: null,
      error_class: null,
      chain: 'company',
      ...oneBreak(3),
      first_failure: null,
    }),
    incidentFacts('a chain-verify System Incident with no requesting person', {
      kind: 'ChainVerifyFailure',
      step: null,
      error_class: null,
      requested_by: null,
      chain: 'company',
      ...oneBreak(3),
    }),
    ...[
      ...['Company', 'lab', 'A4D6A9D1-0000-4000-8000-000000000001', 'a4d6a9d1-0000-4000-8000-00000000000'].map(
        (chain) =>
          ['a System Incident chain that is neither the company chain nor a Lab ID', 'chain', chain, 1] as const,
      ),
      ...[0, -1].map(
        (entry) => ['a System Incident first failing entry below 1', 'first_failure', 'company', entry] as const,
      ),
    ].map(
      ([what, column, chain, entry]): Case => ({
        name: `${what} is refused: ${JSON.stringify(column === 'chain' ? chain : entry)}`,
        table: 'lims.system_incident',
        change: {
          kind: 'ChainVerifyFailure',
          step: null,
          error_class: null,
          chain,
          ...oneBreak(1),
          first_failure: entry,
        },
        constraint: `system_incident_${column}_check`,
      }),
    ),
    ...(
      [
        ['with no last entry', { last_failure: null }],
        ['with no count of breaks', { break_count: null }],
        ['whose last entry is before its first', { first_failure: 7, last_failure: 6 }],
      ] as const
    ).map(
      ([what, change]): Case => ({
        name: `a chain-verify System Incident ${what} is refused`,
        table: 'lims.system_incident',
        change: { kind: 'ChainVerifyFailure', step: null, error_class: null, chain: id.lab, ...oneBreak(7), ...change },
        constraint: 'system_incident_break_check',
      }),
    ),
    {
      name: 'an unexpected-failure System Incident with a last failing entry is refused',
      table: 'lims.system_incident',
      change: { last_failure: 7 },
      constraint: 'system_incident_break_check',
    },
    {
      name: 'an unexpected-failure System Incident with a break fingerprint is refused',
      table: 'lims.system_incident',
      change: { fingerprint: Buffer.alloc(32, 7) },
      constraint: 'system_incident_break_check',
    },
    {
      name: 'a chain-verify System Incident that records no breaks is refused',
      table: 'lims.system_incident',
      change: {
        kind: 'ChainVerifyFailure',
        step: null,
        error_class: null,
        chain: id.lab,
        ...oneBreak(7),
        break_count: 0,
      },
      constraint: 'system_incident_break_count_check',
    },
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
    ...(['SignInSucceeded', 'SignOut', 'Lock', 'Unlock', 'UnlockFailed', 'Takeover'] as const).map((kind) => ({
      name: `an Access Event of kind ${kind} without a session is refused`,
      table: 'lims.access_event' as const,
      change: {
        kind,
        failure_reason: kind === 'UnlockFailed' ? 'WrongPassword' : null,
        ...(kind === 'Takeover' && { taken_by_id: id.otherPerson }),
      },
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
      name: 'a takeover Access Event that names no person taking over is refused',
      table: 'lims.access_event',
      change: { ...takeover, taken_by_id: null },
      constraint: 'access_event_takeover_check',
    },
    {
      name: 'a lock Access Event that names a person taking over is refused',
      table: 'lims.access_event',
      change: { ...takeover, kind: 'Lock' },
      constraint: 'access_event_takeover_check',
    },
    {
      name: 'a Workstation device token hash that is not 32 bytes is refused',
      table: 'lims.workstation',
      change: { device_token_hash: Buffer.alloc(16, 2) },
      constraint: 'workstation_device_token_hash_check',
    },
    {
      name: 'a failed sign-in Access Event without a failure reason is refused',
      table: 'lims.access_event',
      change: { failure_reason: null },
      constraint: 'access_event_failure_check',
    },
    {
      name: 'a Lab switch Access Event without a session is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, session_lab_id: null, session_id: null },
      constraint: 'access_event_session_kind_check',
    },
    {
      name: 'a failed Lab switch Access Event without the session it stays in is refused',
      table: 'lims.access_event',
      change: { kind: 'LabSwitchFailed' },
      constraint: 'access_event_session_kind_check',
    },
    {
      name: 'a failed Lab switch Access Event without a failure reason is refused',
      table: 'lims.access_event',
      change: { kind: 'LabSwitchFailed', failure_reason: null, session_lab_id: id.lab, session_id: id.session },
      constraint: 'access_event_failure_check',
    },
    {
      name: 'a failed sign-in Access Event with a reason only a Lab switch has is refused',
      table: 'lims.access_event',
      change: { failure_reason: 'OtherUserId' },
      constraint: 'access_event_failure_kind_check',
    },
    ...['NoLabChosen', 'AlreadyEnrolled', 'OtherPersonSignedIn'].map((reason) => ({
      name: `a failed Lab switch Access Event with the ${reason} reason, which only a sign-in has, is refused`,
      table: 'lims.access_event' as const,
      change: {
        kind: 'LabSwitchFailed',
        failure_reason: reason,
        session_lab_id: id.lab,
        session_id: id.session,
      },
      constraint: 'access_event_failure_kind_check',
    })),
    {
      name: 'a Lab switch Access Event that names no previous session is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, previous_session_lab_id: null, previous_session_id: null },
      constraint: 'access_event_previous_session_check',
    },
    {
      name: 'an Access Event of another kind that names a previous session is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, kind: 'SignOut' },
      constraint: 'access_event_previous_session_check',
    },
    {
      name: 'a previous session ID without its Lab is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, previous_session_lab_id: null },
      constraint: 'access_event_previous_session_check',
    },
    {
      name: 'a Lab switch Access Event into the Lab it came from is refused',
      table: 'lims.access_event',
      change: { ...labSwitch, previous_session_lab_id: id.lab, previous_session_id: id.session },
      constraint: 'access_event_lab_switch_check',
    },
    {
      name: 'a sign-out Access Event with a failure reason is refused',
      table: 'lims.access_event',
      change: { kind: 'SignOut' },
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
    ...each(
      'an Identity Verification without a printed name is refused',
      'lims.identity_verification',
      'printed_name',
      ['', '   '],
      'identity_verification_printed_name_check',
    ),
    ...each(
      'an Identity Verification that does not say what was checked is refused',
      'lims.identity_verification',
      'evidence',
      ['', '   '],
      'identity_verification_evidence_check',
    ),
    ...each(
      'a one-time link whose token hash is not 32 bytes is refused',
      'lims.credential_link',
      'token_hash',
      [Buffer.alloc(31, 7), Buffer.alloc(33, 7)],
      'credential_link_token_hash_check',
    ),
    {
      name: 'a one-time link that expires before it is issued is refused',
      table: 'lims.credential_link',
      change: { expires_at: '2000-01-01T00:00:00Z' },
      constraint: 'credential_link_expiry_check',
    },
    {
      name: 'a one-time link used outside its life is refused',
      table: 'lims.credential_link',
      change: { used_at: '2000-01-01T00:00:00Z' },
      constraint: 'credential_link_use_check',
    },
    ...each(
      'an enrolment grant whose token hash is not 32 bytes is refused',
      'lims.enrolment_grant',
      'token_hash',
      [Buffer.alloc(31, 7), Buffer.alloc(33, 7)],
      'enrolment_grant_token_hash_check',
    ),
    {
      name: 'an enrolment grant that expires before it is issued is refused',
      table: 'lims.enrolment_grant',
      change: { expires_at: '2000-01-01T00:00:00Z' },
      constraint: 'enrolment_grant_expiry_check',
    },
    {
      name: 'an enrolment grant used outside its life is refused',
      table: 'lims.enrolment_grant',
      change: { used_at: '2000-01-01T00:00:00Z' },
      constraint: 'enrolment_grant_use_check',
    },
    {
      name: 'an enrolment grant a person issues for themselves is refused',
      table: 'lims.enrolment_grant',
      change: { issued_by: id.verified },
      constraint: 'enrolment_grant_second_person_check',
    },
    ...each(
      "a person's count of failed sign-ins below zero is refused",
      'lims.person',
      'failed_logins',
      [-1, -2147483648],
      'person_failed_logins_check',
    ),
  ]);
});

describe('a failed unlock records why, as a failed sign-in does', () => {
  it('a failed unlock Access Event with each reason a password, a code or a Lockout gives is accepted', async () => {
    const reasons = [
      'WrongPassword',
      'WrongPasswordOnLockedAccount',
      'AccountLocked',
      'WrongCode',
      'NoAuthenticator',
      'CodeAlreadyUsed',
    ];
    for (const reason of reasons) {
      const row = {
        ...tables['lims.access_event'].row,
        kind: 'UnlockFailed',
        failure_reason: reason,
        session_lab_id: id.lab,
        session_id: id.session,
      };
      await client.query('begin');
      try {
        await client.query(AUDIT_CONTEXT);
        await client.query(...insert('lims.access_event', row));
      } finally {
        await client.query('rollback');
      }
    }
  });

  it('every Access Event rule binds the rows written before it, except the reason that failed unlocks before #245 lack', async () => {
    const { rows } = await client.query<{ name: string }>(
      `select conname as name from pg_constraint
        where conrelid = 'lims.access_event'::regclass and not convalidated order by conname`,
    );
    assert.deepEqual(
      rows.map((row) => row.name),
      ['access_event_unlock_failure_check'],
    );
  });
});

describe('a counter holds at most six digits and is never empty', () => {
  // The counter trigger lets a counter start only at zero, so these rows reach the constraints with triggers off.
  const refusalOfCounter = (last: number | null) =>
    refusalWithTriggersOff(`insert into lims.counter (lab_id, kind, last) values ($1, 'Sample', $2)`, [
      id.otherLab,
      last,
    ]);
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

describe('a Signature, a Record Version, a signature statement, a re-authentication record, an Access Event, an Audit Trail entry, a Commit Key, a System Incident or an Audit Export is never changed or removed, even by the superuser', () => {
  const cases: { name: string; table: Table; trigger: string; statement: string }[] = [
    {
      name: 'updating a Chain Verification is refused',
      table: 'lims.chain_verification',
      trigger: 'refuse_change',
      statement: 'update lims.chain_verification set through = through + 1',
    },
    {
      name: 'deleting a Chain Verification is refused',
      table: 'lims.chain_verification',
      trigger: 'refuse_change',
      statement: 'delete from lims.chain_verification',
    },
    {
      name: 'truncating the Chain Verifications is refused',
      table: 'lims.chain_verification',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.chain_verification',
    },
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
      name: 'updating a signature statement is refused',
      table: 'lims.signature_statement',
      trigger: 'refuse_change',
      statement: `update lims.signature_statement set statement = 'changed'`,
    },
    {
      name: 'deleting a signature statement is refused',
      table: 'lims.signature_statement',
      trigger: 'refuse_change',
      statement: 'delete from lims.signature_statement',
    },
    {
      name: 'truncating the signature statements is refused',
      table: 'lims.signature_statement',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.signature_statement, lims.signature',
    },
    {
      name: 'updating a signing role is refused',
      table: 'lims.signing_role',
      trigger: 'refuse_change',
      statement: `update lims.signing_role set meaning = 'Released'`,
    },
    {
      name: 'deleting a signing role is refused',
      table: 'lims.signing_role',
      trigger: 'refuse_change',
      statement: 'delete from lims.signing_role',
    },
    {
      name: 'truncating the signing roles is refused',
      table: 'lims.signing_role',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.signing_role',
    },
    {
      name: 'updating a re-authentication record is refused',
      table: 'lims.reauthentication',
      trigger: 'refuse_change',
      statement: `update lims.reauthentication set meaning = 'Released'`,
    },
    {
      name: 'deleting a re-authentication record is refused',
      table: 'lims.reauthentication',
      trigger: 'refuse_change',
      statement: 'delete from lims.reauthentication',
    },
    {
      name: 'truncating the re-authentication records is refused',
      table: 'lims.reauthentication',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.reauthentication, lims.signature',
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
    {
      name: 'updating an Identity Verification is refused',
      table: 'lims.identity_verification',
      trigger: 'refuse_change',
      statement: `update lims.identity_verification set evidence = 'Nothing'`,
    },
    {
      name: 'deleting an Identity Verification is refused',
      table: 'lims.identity_verification',
      trigger: 'refuse_change',
      statement: 'delete from lims.identity_verification',
    },
    {
      name: 'truncating the Identity Verifications is refused',
      table: 'lims.identity_verification',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.identity_verification cascade',
    },
    {
      name: 'truncating the one-time links is refused',
      table: 'lims.credential_link',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.credential_link',
    },
    {
      name: 'truncating the enrolment grants is refused',
      table: 'lims.enrolment_grant',
      trigger: 'refuse_truncate',
      statement: 'truncate lims.enrolment_grant',
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
      chain: 'company',
      first_failure: 1,
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

  const unrecordedBreak = `insert into lims.system_incident (kind, reference, requested_by, chain, first_failure)
                           values ('ChainVerifyFailure', 'RF00000M', $1, $2, 4)`;
  covered.add('lims.system_incident.require_break');
  it("a new chain-verify System Incident without its break's fingerprint, last entry and count is refused", async () => {
    const error = await refusalOf(unrecordedBreak, [id.person, id.lab]);
    assert.deepEqual(
      [error.code, error.message],
      ['23514', "a chain-verify System Incident records its break's fingerprint, last entry and count"],
    );
  });

  it("a chain-verify System Incident opened before breaks carried a fingerprint still takes QA's answer", async () => {
    await client.query('begin');
    try {
      await client.query('set local session_replication_role = replica');
      await client.query(unrecordedBreak, [id.person, id.lab]);
      await client.query('set local session_replication_role = origin');
      await client.query(AUDIT_CONTEXT);
      await client.query(actingAs('QA'));
      const { rowCount } = await client.query(
        `update lims.system_incident set impact_answer = 'Yes' where reference = 'RF00000M'`,
      );
      assert.equal(rowCount, 1);
    } finally {
      await client.query('rollback');
    }
  });

  it("a chain-verify System Incident's content carries its break's fingerprint", async () => {
    const { rows } = await client.query<{ fingerprint: string | null }>(
      `select lims.incident_content(id) ->> 'fingerprint' as fingerprint from lims.system_incident
        where reference = 'RF000003'`,
    );
    assert.deepEqual(rows, [{ fingerprint: '07'.repeat(32) }]);
  });

  const stamped =
    'a System Incident records who recorded each of the three and when from the acting person and the database clock';
  for (const [what, role, change] of [
    ["QA's answer", 'QA', "impact_answer = 'Yes'"],
    ['an immediate action', 'Admin', "immediate_action = 'Reran the entry.'"],
    ['a corrective action', 'Admin', "corrective_action = 'Added a check.'"],
  ] as const) {
    it(`${what} recorded under any role but ${role} is refused`, async () => {
      for (const other of ['system', role === 'QA' ? 'Admin' : 'QA']) {
        const error = await refusalOf(
          `${asRole(other)}; update lims.system_incident set ${change} where id = '${id.systemIncident}'`,
        );
        assert.deepEqual(
          [error.code, error.message],
          ['LA015', `${what} on a System Incident is recorded by ${role}, not ${other}`],
          other,
        );
      }
    });
    it(`${what} recorded by a service identity is refused`, async () => {
      const error = await refusalOf(
        `${asRole(role)}; select set_config('lims.actor', 'svc:test', true);
         update lims.system_incident set ${change} where id = '${id.systemIncident}'`,
      );
      assert.deepEqual(
        [error.code, error.message],
        ['LA015', `${what} on a System Incident is recorded by a person, not svc:test`],
      );
    });
    it(`${what} recorded by a person who holds no ${role} membership is refused`, async () => {
      const error = await refusalOf(
        `${asRole(role)}; select set_config('lims.actor', 'person:refusal.person', true);
         update lims.system_incident set ${change} where id = '${id.systemIncident}'`,
      );
      assert.deepEqual(
        [error.code, error.message],
        ['LA015', `${what} on a System Incident is recorded by a person who holds ${role}, not person:refusal.person`],
      );
    });
  }

  it(stamped, async () => {
    for (const [fact, role] of [
      ['impact_answer', 'QA'],
      ['immediate_action', 'Admin'],
      ['corrective_action', 'Admin'],
    ] as const) {
      const by = fact === 'impact_answer' ? 'impact_answered_by' : `${fact}_by`;
      const at = fact === 'impact_answer' ? 'impact_answered_at' : `${fact}_at`;
      await client.query('begin');
      try {
        await client.query(AUDIT_CONTEXT);
        await client.query(actingAs(role));
        // A hand-written person and instant do not stick: the database writes the actor and its own clock over them.
        const { rows } = await client.query<Row>(
          `update lims.system_incident
              set ${fact} = 'Yes', ${by} = $1, ${at} = '2020-01-01T00:00:00Z'
            where id = $2
            returning ${by} as by, ${at} between now() and clock_timestamp() as now, ${at} > '2026-01-01T00:00:00Z' as recent`,
          [id.person, id.systemIncident],
        );
        assert.deepEqual(rows, [{ by: role === 'QA' ? id.otherPerson : id.admin, now: true, recent: true }], fact);
      } finally {
        await client.query('rollback');
      }
    }
  });

  it('the app role holds no update on who recorded each of the three or when', async () => {
    const { rows } = await client.query<{ privilege: string }>(
      `select privilege_type || ' ' || column_name as privilege from information_schema.column_privileges
        where grantee = 'lims_app' and table_schema = 'lims' and table_name = 'system_incident'
          and privilege_type = 'UPDATE'
        order by 1`,
    );
    assert.deepEqual(
      rows.map((row) => row.privilege),
      ['UPDATE corrective_action', 'UPDATE immediate_action', 'UPDATE impact_answer', 'UPDATE state'],
    );
    const error = await refusalOf(
      `set local role lims_app; update lims.system_incident set impact_answered_at = clock_timestamp() where id = '${id.systemIncident}'`,
    );
    assert.equal(error.code, '42501', error.message);
  });

  /** A System Incident inserted with the given recorded fields, past the triggers, as a past write would have left it. */
  const incidentIn = async (reference: string, columns: Row) => {
    const names = Object.keys(columns);
    await client.query('set local session_replication_role = replica');
    await client.query(
      `insert into lims.system_incident (kind, reference, requested_by, session_lab_id, step, error_class${names.map((n) => `, ${pg.escapeIdentifier(n)}`).join('')})
       values ('UnexpectedFailure', $1, $2, $3, 'enterResult', 'TypeError'${names.map((_, i) => `, $${i + 4}`).join('')})
       returning id`,
      [reference, id.person, id.lab, ...Object.values(columns)],
    );
    await client.query('set local session_replication_role = origin');
    await client.query(AUDIT_CONTEXT);
  };
  const recordedAll = {
    impact_answer: 'Yes',
    impact_answered_by: id.person,
    impact_answered_at: '2026-09-30T00:00:00Z',
    immediate_action: 'Reran the entry.',
    immediate_action_by: id.person,
    immediate_action_at: '2026-09-30T00:00:00Z',
    corrective_action: 'Added a check.',
    corrective_action_by: id.person,
    corrective_action_at: '2026-09-30T00:00:00Z',
  };
  const moveRefused = (name: string, columns: Row, change: string, message: string, values: unknown[] = []) => {
    it(name, async () => {
      await client.query('begin');
      try {
        await incidentIn('RF00000N', columns);
        const error = await client
          .query(`update lims.system_incident set ${change} where reference = 'RF00000N'`, values)
          .then(
            () => assert.fail('the database accepted the move'),
            (e: unknown) => e,
          );
        assert.ok(error instanceof pg.DatabaseError, String(error));
        assert.deepEqual([error.code, error.message], ['LA014', message]);
      } finally {
        await client.query('rollback');
      }
    });
  };
  const only = 'a System Incident moves only from Open to Acknowledged to Closed';
  moveRefused('an Open System Incident moving straight to Closed is refused', recordedAll, "state = 'Closed'", only);
  moveRefused(
    'an Acknowledged System Incident moving back to Open is refused',
    { ...recordedAll, state: 'Acknowledged' },
    "state = 'Open'",
    only,
  );
  for (const [what, change] of [
    ['its state', "state = 'Acknowledged'"],
    ["QA's answer", "impact_answer = 'No'"],
    ['its immediate action', "immediate_action = 'Changed.'"],
  ] as const)
    moveRefused(
      `a Closed System Incident changing ${what} is refused`,
      { ...recordedAll, state: 'Closed' },
      change,
      'a Closed System Incident never changes',
    );
  moveRefused(
    "a System Incident changing QA's answer once recorded is refused",
    recordedAll,
    "impact_answer = 'No'",
    "QA's answer on a System Incident is recorded once",
  );
  moveRefused(
    'a System Incident changing its immediate action once recorded is refused',
    recordedAll,
    "immediate_action = 'Changed.'",
    "a System Incident's immediate action is recorded once",
  );
  moveRefused(
    'a System Incident changing its corrective action once recorded is refused',
    recordedAll,
    "corrective_action = 'Changed.'",
    "a System Incident's corrective action is recorded once",
  );
  for (const [what, held] of [
    ["QA's answer", { ...recordedAll, impact_answer: null, impact_answered_by: null, impact_answered_at: null }],
    [
      'its immediate action',
      { ...recordedAll, immediate_action: null, immediate_action_by: null, immediate_action_at: null },
    ],
    [
      'its corrective action',
      { ...recordedAll, corrective_action: null, corrective_action_by: null, corrective_action_at: null },
    ],
  ] as const)
    moveRefused(
      `a System Incident Acknowledged without ${what} is refused`,
      held,
      "state = 'Acknowledged'",
      "a System Incident is Acknowledged only once QA's answer, its immediate action and its corrective action are recorded",
    );
  moveRefused(
    'a System Incident Acknowledged with no Acknowledged Signature on it is refused',
    recordedAll,
    "state = 'Acknowledged'",
    'a System Incident is Acknowledged only by an Acknowledged Signature on it',
  );

  /** An Acknowledged Signature over a Record Version of RF00000N holding `content`, written past the triggers. */
  const acknowledgedOver = async (content: string) => {
    await client.query('set local session_replication_role = replica');
    await client.query(
      `with incident as (select id from lims.system_incident where reference = 'RF00000N'),
            version as (
              insert into lims.record_version (lab_id, id, record_table, record_id, version, canonical_form, content)
              select $1, $2, 'system_incident', id, 1, 1, ${content} from incident
              returning id, content_hash, canonical_form)
       insert into lims.signature (lab_id, id, person_id, printed_name, username, role, meaning, record_version_id,
                                   content_hash, canonical_form, statement_version, statement_hash, authenticator,
                                   session_id, app_release, reauthentication_id, signed_time_zone)
       select $1, $3, $4, 'Refusal Person', 'refusal.person', 'Admin', 'Acknowledged', id, content_hash,
              canonical_form, 1, (select statement_hash from lims.signature_statement where version = 1),
              'Password', $5, 'test', $6, (select time_zone from lims.lab where lab_id = $1)
         from version`,
      [id.lab, randomUUID(), randomUUID(), id.person, id.session, randomUUID()],
    );
    await client.query('set local session_replication_role = origin');
  };

  it('a System Incident with all three records and an Acknowledged Signature over them moves to Acknowledged, then to Closed', async () => {
    await client.query('begin');
    try {
      await incidentIn('RF00000N', recordedAll);
      await acknowledgedOver("convert_to(lims.incident_content(id)::text, 'UTF8')");
      const acknowledged = await client.query(
        `update lims.system_incident set state = 'Acknowledged' where reference = 'RF00000N'`,
      );
      assert.equal(acknowledged.rowCount, 1);
      const closed = await client.query(
        `update lims.system_incident set state = 'Closed' where reference = 'RF00000N'`,
      );
      assert.equal(closed.rowCount, 1);
    } finally {
      await client.query('rollback');
    }
  });

  it('a System Incident Acknowledged on a Signature over content that is not its current content is refused', async () => {
    await client.query('begin');
    try {
      await incidentIn('RF00000N', {
        ...recordedAll,
        corrective_action: null,
        corrective_action_by: null,
        corrective_action_at: null,
      });
      // Signed before the corrective action was recorded: the Signature binds a version without it.
      await acknowledgedOver("convert_to(lims.incident_content(id)::text, 'UTF8')");
      await client.query(asRole('Admin'));
      await client.query(
        `update lims.system_incident set corrective_action = 'Added a check.' where reference = 'RF00000N'`,
      );
      await assert.rejects(
        client.query(`update lims.system_incident set state = 'Acknowledged' where reference = 'RF00000N'`),
        {
          code: 'LA014',
          message: 'a System Incident is Acknowledged only by an Acknowledged Signature over its current content',
        },
      );
    } finally {
      await client.query('rollback');
    }
  });
});

describe('staff accounts keep their identity, and Admin stays apart from the work', () => {
  const refusedAs = async (statement: string, values: unknown[], code: string, message: string) => {
    const error = await refusalOf(statement, values);
    assert.deepEqual([error.code, error.message], [code, message]);
  };
  const apart = 'a person who holds Admin or Platform Operator holds no business role, in any Lab';
  const grant = 'insert into lims.membership (lab_id, person_id, role) values ($1, $2, $3)';

  covered.add('lims.membership.keep_administration_apart');
  it('a business role for a holder of Admin, even in another Lab, is refused', async () => {
    for (const role of ['Customer', 'SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager'])
      await refusedAs(grant, [id.lab, id.admin, role], 'LA008', apart);
  });
  it('a business role for a holder of Platform Operator is refused', async () => {
    await refusedAs(grant, [id.otherLab, id.operator, 'QA'], 'LA008', apart);
  });
  it('Admin or Platform Operator for a holder of a business role, even in another Lab, is refused', async () => {
    for (const role of ['Admin', 'PlatformOperator'])
      await refusedAs(grant, [id.otherLab, id.person, role], 'LA008', apart);
  });
  it('turning an Admin membership into a business role is refused', async () => {
    await refusedAs(`update lims.membership set role = 'QA' where person_id = $1`, [id.admin], 'LA008', apart);
  });
  it('Admin and Platform Operator may be held together, as the owner does under the demo exception', async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(grant, [id.otherLab, id.operator, 'Admin']);
    } finally {
      await client.query('rollback');
    }
  });
  it('two Labs granting Admin and a business role to one person at once: the second waits and is refused', async () => {
    const other = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
    const watcher = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
    await other.connect();
    await watcher.connect();
    const fresh = randomUUID();
    try {
      await client.query('begin');
      await client.query(AUDIT_CONTEXT);
      await client.query(
        `insert into lims.person (id, username, display_name) values ($1, 'refusal.race', 'Race Person')`,
        [fresh],
      );
      await client.query('commit');
      await client.query('begin');
      await client.query(AUDIT_CONTEXT);
      await client.query(grant, [id.lab, fresh, 'Admin']);
      const { rows } = await other.query<{ pid: number }>('select pg_backend_pid() as pid');
      await other.query('begin');
      await other.query(AUDIT_CONTEXT);
      const answered = { yet: false };
      const second = other.query(grant, [id.otherLab, fresh, 'Analyst']).then(
        () => {
          answered.yet = true;
          return assert.fail('the database granted a business role to a person being made Admin');
        },
        (e: unknown) => {
          answered.yet = true;
          return e instanceof pg.DatabaseError ? e : assert.fail(String(e));
        },
      );
      const waiting = async () =>
        (
          await watcher.query(`select wait_event_type = 'Lock' as waits from pg_stat_activity where pid = $1`, [
            rows[0]?.pid,
          ])
        ).rows[0]?.waits === true;
      while (!answered.yet && !(await waiting()));
      assert.equal(answered.yet, false, 'the second grant answered before the first committed');
      await client.query('commit');
      const error = await second;
      assert.deepEqual([error.code, error.message], ['LA008', apart]);
    } finally {
      await other.query('rollback');
      await other.end();
      await watcher.end();
    }
  });

  covered.add('lims.person.keep_identity');
  it('changing a username is refused, even by the superuser', async () => {
    await refusedAs(
      `update lims.person set username = 'refusal.renamed' where id = $1`,
      [id.person],
      'LA002',
      'a username is never changed',
    );
  });
  it("changing a person's Identity Verification is refused", async () => {
    await refusedAs(
      'update lims.person set identity_verification_id = null where id = $1',
      [id.verified],
      'LA002',
      "a person's Identity Verification is never changed",
    );
  });

  covered.add('lims.identity_verification.checked_by_the_acting_admin');
  it('an Identity Verification recorded in the name of someone other than the acting Admin of its Lab is refused', async () => {
    const checkedBy = (person: string, lab: string) =>
      refusedAs(
        `insert into lims.identity_verification (printed_name, evidence, checked_by, checked_in_lab_id)
         values ('Forged Check', 'Nothing seen', $1, $2)`,
        [person, lab],
        'LA007',
        'an Identity Verification is recorded by the Admin who checked',
      );
    await checkedBy(id.person, id.lab);
    await checkedBy(id.operator, id.lab);
    await checkedBy(id.admin, id.lab);
  });

  covered.add('lims.credential_link.link_needs_identity_verification');
  it('a one-time link for an account with no Identity Verification is refused', async () => {
    await refusedAs(
      'insert into lims.credential_link (person_id, token_hash) values ($1, $2)',
      [id.person, Buffer.alloc(32, 8)],
      'LA007',
      'a one-time link goes only to an account with an Identity Verification',
    );
  });

  covered.add('lims.credential_link.use_link_once');
  it('a one-time link is only ever marked used, once, even by the superuser', async () => {
    const once = 'a one-time link is only ever marked used, once';
    await refusedAs('update lims.credential_link set token_hash = $1', [Buffer.alloc(32, 9)], 'LA002', once);
    await refusedAs('delete from lims.credential_link', [], 'LA002', once);
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query('update lims.credential_link set used_at = clock_timestamp() where id = $1', [
        id.credentialLink,
      ]);
      await client.query('savepoint used');
      await assert.rejects(
        client.query('update lims.credential_link set used_at = clock_timestamp() where id = $1', [id.credentialLink]),
        { code: 'LA002', message: once },
      );
    } finally {
      await client.query('rollback');
    }
  });

  covered.add('lims.enrolment_grant.granted_by_a_second_admin');
  it('an enrolment grant from the person, from someone who is not an Admin, from an Admin who created the account or issued its one-time link, or in another Admin’s name is refused', async () => {
    const issue = 'insert into lims.enrolment_grant (person_id, issued_by, token_hash) values ($1, $2, $3)';
    const token = Buffer.alloc(32, 13);
    await refusedAs(issue, [id.verified, id.person, token], 'LA016', 'an enrolment grant is issued by an Admin');
    // The fixture's Admin created refusal.verified and issued its one-time link, under their own name.
    await refusedAs(
      issue,
      [id.verified, id.admin, token],
      'LA016',
      'an enrolment grant comes from a second Admin: not the one who created the account or issued its one-time link',
    );
    // The app role, unlike the owner, issues only in the acting Admin's name.
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query('set local role lims_app');
      await assert.rejects(client.query(issue, [id.verified, id.secondAdmin, token]), {
        code: 'LA016',
        message: 'an enrolment grant is issued by the acting Admin',
      });
    } finally {
      await client.query('rollback');
    }
  });

  covered.add('lims.credential_link.link_not_from_the_grant_issuer');
  it('a one-time link in the name of the Admin who issued the person’s enrolment grant is refused', async () => {
    // The fixture's second Admin issued refusal.verified's enrolment grant.
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query("select set_config('lims.actor', 'person:refusal.second', true)");
      await assert.rejects(
        client.query('insert into lims.credential_link (person_id, token_hash) values ($1, $2)', [
          id.verified,
          Buffer.alloc(32, 14),
        ]),
        {
          code: 'LA016',
          message: 'a one-time link comes from an Admin who did not issue the person’s enrolment grant',
        },
      );
    } finally {
      await client.query('rollback');
    }
  });

  covered.add('lims.enrolment_grant.use_grant_once');
  it('an enrolment grant is only ever marked used, once, even by the superuser', async () => {
    const once = 'an enrolment grant is only ever marked used, once';
    await refusedAs('update lims.enrolment_grant set token_hash = $1', [Buffer.alloc(32, 9)], 'LA002', once);
    await refusedAs('delete from lims.enrolment_grant', [], 'LA002', once);
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query('update lims.enrolment_grant set used_at = clock_timestamp() where id = $1', [
        id.enrolmentGrant,
      ]);
      await client.query('savepoint used');
      await assert.rejects(
        client.query('update lims.enrolment_grant set used_at = clock_timestamp() where id = $1', [id.enrolmentGrant]),
        { code: 'LA002', message: once },
      );
    } finally {
      await client.query('rollback');
    }
  });

  covered.add('lims.signature.sign_as_the_person');
  covered.add('lims.signature.signature_printed_name_not_null');
  it('a Signature takes the printed name and username its signer has, whatever the insert says', async () => {
    const forged = { ...tables['lims.signature'].row, printed_name: 'Forged Name', username: 'forged.user' };
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await signingStamp(forged);
      const [statement, values] = insert('lims.signature', forged);
      const { rows } = await client.query<Row>(`${statement} returning printed_name, username`, values);
      assert.deepEqual(rows, [{ printed_name: 'Refusal Person', username: 'refusal.person' }]);
    } finally {
      await client.query('rollback');
    }
  });
  it('a Signature by a person who does not exist is refused', async () => {
    const error = await refusalOfRow('lims.signature', { person_id: missing });
    assert.deepEqual([error.code, error.table, error.column], ['23502', 'signature', 'printed_name'], error.message);
  });
  covered.add('lims.signature.signature_person_id_fkey');
  it('removing a person who has signed is refused', async () => {
    const signer = randomUUID();
    const [session, proof] = [randomUUID(), randomUUID()];
    const signed = {
      ...tables['lims.signature'].row,
      person_id: signer,
      session_id: session,
      reauthentication_id: proof,
    };
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(
        `insert into lims.person (id, username, display_name) values ($1, 'refusal.signer', 'Signer')`,
        [signer],
      );
      await client.query('insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, $4)', [
        id.lab,
        session,
        signer,
        Buffer.alloc(32, 7),
      ]);
      await client.query(
        `insert into lims.reauthentication (lab_id, id, session_id, person_id, meaning, authenticator)
         values ($1, $2, $3, $4, 'Performed', 'Password')`,
        [id.lab, proof, session, signer],
      );
      await signingStamp(signed);
      await client.query(...insert('lims.signature', signed));
      await assert.rejects(client.query('delete from lims.person where id = $1', [signer]), (error: unknown) => {
        assert.ok(error instanceof pg.DatabaseError);
        assertConstraint(error, '23503', 'lims.signature', 'signature_person_id_fkey');
        return true;
      });
    } finally {
      await client.query('rollback');
    }
  });
});

it('every lims table is captured in the Audit Trail except the sessions, the authenticators, the Commit Keys, the counters and the Audit Trail itself', async () => {
  const { rows } = await client.query<{ name: string }>(
    `select 'lims.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'lims' and c.relkind = 'r'
        and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'capture')
      order by 1`,
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ['lims.audit_chain', 'lims.audit_entry', 'lims.authenticator', 'lims.commit_key', 'lims.counter', 'lims.session'],
  );
});

describe('a Signature is written only by the signing function, which refuses every signing it cannot stand behind', () => {
  const asService = `select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
            set_config('lims.reason', 'Probe the signing function', true)`;
  const asPerson = (role = 'Analyst') =>
    `select set_config('lims.actor', 'person:refusal.person', true), set_config('lims.role', '${role}', true),
            set_config('lims.reason', 'Probe the signing function', true)`;
  const reauthenticate = (meaning = 'Performed', person = id.person, session = id.session) =>
    `insert into lims.reauthentication (lab_id, id, session_id, person_id, meaning, authenticator)
     values ('${id.lab}', '${id.probeReauthentication}', '${session}', '${person}', '${meaning}', 'Password')`;
  const versionOf = (recordId: string, version: number) =>
    `(select id from lims.record_version where lab_id = '${id.lab}' and record_id = '${recordId}' and version = ${version})`;
  const hashOf = (recordId: string, version: number) =>
    `(select content_hash from lims.record_version where lab_id = '${id.lab}' and record_id = '${recordId}' and version = ${version})`;
  const sign = ({
    reauthentication = id.probeReauthentication,
    session = id.session,
    table = 'test',
    recordId = id.test,
    seen = versionOf(id.test, 2),
    hash = hashOf(id.test, 2),
    statementVersion = 1,
    meaning = 'Performed',
    release = 'test',
  }: {
    reauthentication?: string;
    session?: string;
    table?: string;
    recordId?: string;
    seen?: string;
    hash?: string;
    statementVersion?: number;
    meaning?: string;
    release?: string;
  } = {}) =>
    `select lims.sign('${reauthentication}', '${session}', '${table}', '${recordId}', ${seen}, ${hash},
                      ${statementVersion}, '${meaning}', '${release}')`;

  async function attempt(...statements: string[]): Promise<pg.DatabaseError | null> {
    await client.query('begin');
    try {
      for (const statement of statements) await client.query(statement);
      return null;
    } catch (error) {
      if (error instanceof pg.DatabaseError) return error;
      throw error;
    } finally {
      await client.query('rollback');
    }
  }
  async function refused(...statements: string[]): Promise<string> {
    const error = await attempt(...statements);
    assert.ok(error, `the database accepted ${statements.at(-1)}`);
    assert.equal(error.code, 'LA010', error.message);
    return error.message;
  }

  covered.add('lims.signature.sign_only');
  it('a Signature inserted by a statement, not through the signing function, is refused even for the superuser', async () => {
    const error = await refusalOf(...insert('lims.signature', { ...tables['lims.signature'].row, id: randomUUID() }));
    assert.deepEqual([error.code, error.message], ['LA009', 'a Signature is written only by lims.sign']);
    assert.match(error.where ?? '', /function refuse_unsigned_insert\(\)/);
  });

  it('the app role holds no insert on Signatures, so only the function, which runs as the owner, writes one', async () => {
    const error = await attempt(
      AUDIT_CONTEXT,
      'set local role lims_app',
      `insert into lims.signature (lab_id, person_id) values ('${id.lab}', '${id.person}')`,
    );
    assert.equal(error?.code, '42501', error?.message);
  });

  it('a person who re-authenticated in this transaction signs the Record Version they saw, and the row copies the stored hash, form and statement', async () => {
    await client.query('begin');
    try {
      await client.query(asPerson());
      await client.query(reauthenticate());
      const { rows } = await client.query<{ sign: string }>(sign());
      const signature = (
        await client.query<Row>(
          `select s.lab_id, s.person_id, s.printed_name, s.username, s.role, s.meaning, s.canonical_form,
                  s.statement_version, s.statement_hash, s.authenticator, s.session_id, s.app_release,
                  s.reauthentication_id, v.version, v.content_hash = s.content_hash as hash_copied,
                  v.canonical_form = s.canonical_form as form_copied, t.statement_hash = s.statement_hash as statement_copied
             from lims.signature s
             join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
             join lims.signature_statement t on t.version = s.statement_version
            where s.id = $1`,
          [rows[0]?.sign],
        )
      ).rows[0];
      assert.deepEqual(signature, {
        lab_id: id.lab,
        person_id: id.person,
        printed_name: 'Refusal Person',
        username: 'refusal.person',
        role: 'Analyst',
        meaning: 'Performed',
        canonical_form: 1,
        statement_version: 1,
        statement_hash: statementHash,
        authenticator: 'Password',
        session_id: id.session,
        app_release: 'test',
        reauthentication_id: id.probeReauthentication,
        version: 2,
        hash_copied: true,
        form_copied: true,
        statement_copied: true,
      });
    } finally {
      await client.query('rollback');
    }
  });

  it('a Test Report this transaction created is signed on sight of its Test', async () => {
    const report = randomUUID();
    assert.equal(
      await attempt(
        asPerson('QA'),
        `insert into lims.membership (lab_id, person_id, role) values ('${id.lab}', '${id.person}', 'QA')`,
        reauthenticate('Released'),
        `insert into lims.test_report (lab_id, id, test_id, number) values ('${id.lab}', '${report}', '${id.untested}', 'RF-R-2026-000009')`,
        sign({
          table: 'test_report',
          recordId: report,
          meaning: 'Released',
          seen: versionOf(id.untested, 2),
          hash: hashOf(id.untested, 2),
        }),
      ),
      null,
    );
  });

  const cases: { name: string; statements: string[]; message: string | RegExp }[] = [
    {
      name: 'a service identity cannot sign',
      statements: [asService, reauthenticate(), sign()],
      message: 'only a person signs; svc:test is a service identity',
    },
    {
      name: 'an actor who is not a known person cannot sign',
      statements: [asPerson().replace('person:refusal.person', 'person:nobody'), reauthenticate(), sign()],
      message: 'the signer person:nobody is not a known person',
    },
    {
      name: 'a locked account cannot sign',
      statements: [
        asPerson(),
        `update lims.person set locked_at = clock_timestamp() where id = '${id.person}'`,
        reauthenticate(),
        sign(),
      ],
      message: "the signer's account is locked",
    },
    {
      name: 'signing with no re-authentication record is refused',
      statements: [asPerson(), sign({ reauthentication: missing })],
      message: 'no re-authentication record: the signer has not re-entered their credentials',
    },
    {
      name: 'signing with a re-authentication record from an earlier transaction is refused',
      statements: [asPerson('Analyst'), sign({ reauthentication: id.secondReauthentication, meaning: 'Performed' })],
      message: 'the re-authentication record was written by an earlier transaction',
    },
    {
      name: "signing with another person's re-authentication record is refused",
      statements: [asPerson(), reauthenticate('Performed', id.otherPerson, id.otherPersonSession), sign()],
      message: "the re-authentication record is another person's",
    },
    {
      name: "signing on another live session of the signer than the re-authentication record's is refused",
      statements: [asPerson(), reauthenticate(), sign({ session: id.secondSession })],
      message: 'the re-authentication record was given on another session',
    },
    {
      name: 'signing on sight of a signature statement that is no longer in force is refused',
      statements: [
        asPerson(),
        `insert into lims.signature_statement (version, statement) values (2, convert_to('A newer statement (fictional).', 'UTF8'))`,
        reauthenticate(),
        sign(),
      ],
      message:
        'the signature statement changed to version 2 after the signer saw version 1; it must be read again before signing',
    },
    {
      name: 'signing with a re-authentication record given for another meaning is refused',
      statements: [asPerson(), reauthenticate('Reviewed'), sign()],
      message: 'the re-authentication record was given to sign Reviewed, not Performed',
    },
    {
      name: 'signing twice with one re-authentication record is refused',
      statements: [asPerson(), reauthenticate(), sign(), sign()],
      message: 'the re-authentication record is already used by a Signature',
    },
    {
      name: 'signing on a session that has ended is refused',
      statements: [
        asPerson(),
        reauthenticate(),
        `update lims.session set ended_at = clock_timestamp() where id = '${id.session}'`,
        sign(),
      ],
      message: "the re-authentication record's session has ended",
    },
    {
      name: 'signing a Meaning the held role does not give is refused',
      statements: [asPerson('Analyst'), reauthenticate('Reviewed'), sign({ meaning: 'Reviewed' })],
      message: 'the role Analyst does not give the Signature Meaning Reviewed',
    },
    {
      name: 'signing in a role the person does not hold in the Lab is refused',
      statements: [asPerson('QA'), reauthenticate(), sign()],
      message: 'the signer does not hold the role QA in this Lab',
    },
    {
      name: 'signing on sight of a Record Version that is not one of this Lab is refused',
      statements: [asPerson(), reauthenticate(), sign({ seen: `'${missing}'` })],
      message: "the Record Version shown is not one of this Lab's",
    },
    {
      name: 'signing on sight of a hash that is not the Record Version stored hash is refused',
      statements: [asPerson(), reauthenticate(), sign({ hash: `'\\x${zeros.toString('hex')}'::bytea` })],
      message: 'the hash shown is not the hash of Record Version 2',
    },
    {
      name: 'signing a record that another transaction versioned after the signer saw it is refused',
      statements: [asPerson(), reauthenticate(), sign({ seen: versionOf(id.test, 1), hash: hashOf(id.test, 1) })],
      message: 'the record changed after the signer saw it; it must be read again before signing',
    },
    {
      name: 'signing a record other than the one shown, which this transaction did not create, is refused',
      statements: [asPerson(), reauthenticate(), sign({ recordId: id.untested })],
      message: 'the test signed is not the record shown, nor one this signing created',
    },
    {
      name: 'signing a Test Report that is not built on the Test shown is refused',
      statements: [
        asPerson('QA'),
        `insert into lims.membership (lab_id, person_id, role) values ('${id.lab}', '${id.person}', 'QA')`,
        reauthenticate('Released'),
        `insert into lims.test_report (lab_id, id, test_id, number) values ('${id.lab}', '${id.probeReport}', '${id.untested}', 'RF-R-2026-000008')`,
        sign({ table: 'test_report', recordId: id.probeReport, meaning: 'Released' }),
      ],
      message: 'the Test Report signed is not built on the Test shown',
    },
    {
      name: 'signing with a null argument is refused rather than skipping the check it feeds',
      statements: [asPerson(), reauthenticate(), sign({ hash: 'null' })],
      message: /^a signing names its re-authentication record/,
    },
    {
      name: 'signing a record with no Record Version is refused',
      statements: [asPerson(), reauthenticate(), sign({ recordId: missing })],
      message: /^there is no Record Version of test/,
    },
  ];
  for (const c of cases)
    it(c.name, async () => {
      const message = await refused(...c.statements);
      if (typeof c.message === 'string') assert.equal(message, c.message);
      else assert.match(message, c.message);
    });

  describe('Acknowledged is signed once, on an Open System Incident, over all three of its records as they are now', () => {
    const incident = randomUUID();
    const holds = (role: string) =>
      `insert into lims.membership (lab_id, person_id, role) values ('${id.lab}', '${id.person}', '${role}')`;
    // The Admin who signs is a person of their own: an Admin holds no business role, and refusal.person is an Analyst.
    const [signer, signerSession, secondProof] = [randomUUID(), randomUUID(), randomUUID()];
    const asAdmin = [
      asPerson('Admin').replace('person:refusal.person', 'person:refusal.acknowledger'),
      `insert into lims.person (id, username, display_name, password_hash)
       values ('${signer}', 'refusal.acknowledger', 'Acknowledging Admin', 'not-a-real-hash')`,
      `insert into lims.membership (lab_id, person_id, role) values ('${id.lab}', '${signer}', 'Admin')`,
      `insert into lims.session (lab_id, id, person_id, token_hash)
       values ('${id.lab}', '${signerSession}', '${signer}', decode(repeat('0a', 32), 'hex'))`,
    ];
    const adminProof = (proof = id.probeReauthentication) =>
      `insert into lims.reauthentication (lab_id, id, session_id, person_id, meaning, authenticator)
       values ('${id.lab}', '${proof}', '${signerSession}', '${signer}', 'Acknowledged', 'Password')`;
    const recorded = `impact_answer, impact_answered_by, impact_answered_at, immediate_action, immediate_action_by,
                      immediate_action_at, corrective_action, corrective_action_by, corrective_action_at`;
    const recordedValues = `'Yes', '${id.person}', '2026-09-30T00:00:00Z', 'Reran the entry.', '${id.person}',
                            '2026-09-30T00:00:00Z', 'Added a check.', '${id.person}', '2026-09-30T00:00:00Z'`;
    /** A System Incident with the three records, in the given state, written past the triggers as a past write left it. */
    const incidentIn = (state = 'Open') =>
      `set local session_replication_role = replica;
       insert into lims.system_incident (id, kind, reference, requested_by, session_lab_id, step, error_class, state, ${recorded})
       values ('${incident}', 'UnexpectedFailure', 'RF00000P', '${id.person}', '${id.lab}', 'enterResult', 'TypeError', '${state}', ${recordedValues});
       set local session_replication_role = origin`;
    /** A Record Version of a System Incident in this Lab holding `content`, as if written earlier. */
    const versionHolding = (content: string, recordId = incident) =>
      `insert into lims.record_version (lab_id, record_table, record_id, version, canonical_form, content)
       values ('${id.lab}', 'system_incident', '${recordId}', 1, 1, ${content})`;
    const current = (recordId = incident) => `convert_to(lims.incident_content('${recordId}'::uuid)::text, 'UTF8')`;
    const versioned = (proof = id.probeReauthentication) =>
      `select lims.version_system_incident('${proof}', '${incident}')`;
    const signAcknowledged = (recordId = incident, proof = id.probeReauthentication) =>
      sign({
        reauthentication: proof,
        session: signerSession,
        table: 'system_incident',
        recordId,
        seen: versionOf(recordId, 1),
        hash: hashOf(recordId, 1),
        meaning: 'Acknowledged',
      });
    const onlyIncidents =
      'Acknowledged is the Signature Meaning of a System Incident, and a System Incident is signed only Acknowledged';

    it("the Admin signs a System Incident Acknowledged over the version this signing wrote in the signing session's Lab", async () => {
      await client.query('begin');
      try {
        for (const statement of [incidentIn(), ...asAdmin, adminProof(), versioned(), signAcknowledged()])
          await client.query(statement);
        const { rows } = await client.query<Row>(
          `select v.lab_id, v.version, s.meaning, s.role, v.content_hash = lims.incident_content_hash(v.record_id) as current
             from lims.signature s join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
            where v.record_table = 'system_incident' and v.record_id = $1`,
          [incident],
        );
        assert.deepEqual(rows, [{ lab_id: id.lab, version: 1, meaning: 'Acknowledged', role: 'Admin', current: true }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('versioning a System Incident on a re-authentication record from an earlier transaction, for another Meaning, or that does not exist is refused', async () => {
      const versioning =
        'a System Incident is versioned only for the Acknowledged signing re-authenticated in this transaction';
      assert.equal(await refused(incidentIn(), ...asAdmin, versioned(id.reauthentication)), versioning);
      assert.equal(await refused(incidentIn(), ...asAdmin, reauthenticate('Performed'), versioned()), versioning);
      assert.equal(await refused(incidentIn(), ...asAdmin, versioned(missing)), versioning);
    });

    covered.add('lims.signature.incident_signing');
    const incidentCases: { name: string; statements: string[]; message: string }[] = [
      {
        name: 'signing a Test Acknowledged is refused',
        statements: [...asAdmin, adminProof(), sign({ session: signerSession, meaning: 'Acknowledged' })],
        message: onlyIncidents,
      },
      {
        name: 'signing a System Incident Released is refused',
        statements: [
          incidentIn(),
          asPerson('QA'),
          holds('QA'),
          versionHolding(current()),
          reauthenticate('Released'),
          sign({
            table: 'system_incident',
            recordId: incident,
            seen: versionOf(incident, 1),
            hash: hashOf(incident, 1),
            meaning: 'Released',
          }),
        ],
        message: onlyIncidents,
      },
      {
        name: 'signing Acknowledged on a System Incident that is not Open is refused',
        statements: [incidentIn('Acknowledged'), ...asAdmin, adminProof(), versioned(), signAcknowledged()],
        message: 'a System Incident is signed Acknowledged while Open, not Acknowledged',
      },
      {
        name: "signing Acknowledged on a System Incident without QA's answer and both actions is refused",
        statements: [
          ...asAdmin,
          adminProof(),
          versionHolding(current(id.systemIncident), id.systemIncident),
          signAcknowledged(id.systemIncident),
        ],
        message:
          "a System Incident is signed Acknowledged only once QA's answer, its immediate action and its corrective action are recorded",
      },
      {
        name: 'a second Acknowledged signing on a System Incident is refused',
        statements: [
          incidentIn(),
          ...asAdmin,
          adminProof(),
          versioned(),
          signAcknowledged(),
          adminProof(secondProof),
          signAcknowledged(incident, secondProof),
        ],
        message: 'a System Incident is signed Acknowledged once',
      },
      {
        name: 'signing Acknowledged over a version that is not the System Incident as it is now is refused',
        statements: [
          incidentIn(),
          ...asAdmin,
          versionHolding(`'{"stale":true}'::bytea`),
          adminProof(),
          signAcknowledged(),
        ],
        message:
          'the Acknowledged Signature binds the System Incident as it is now; it must be read again before signing',
      },
    ];
    for (const c of incidentCases) it(c.name, async () => assert.equal(await refused(...c.statements), c.message));
  });
});

describe('a session is locked and unlocked only by lims.lock_session and lims.unlock_session', () => {
  const asOwner = `select set_config('lims.actor', 'person:refusal.person', true)`;
  const args = `'${id.lab}', '${id.session}', interval '15 minutes', interval '12 hours', '192.0.2.1'`;
  const lock = `${asOwner}; select lims.lock_session(${args})`;
  const unlock = `select lims.unlock_session(${args})`;
  const reauthenticated = `select lims.set_this_transaction('lims.reauthenticated', '${id.person}')`;
  const message = 'a session is locked and unlocked only by lims.lock_session and lims.unlock_session';

  covered.add('lims.session.lock_through_function');
  covered.add('lims.session.open_unlocked');
  it('a session locked by a statement, not through the function, is refused even for the superuser', async () => {
    const error = await refusalOf('update lims.session set locked_at = clock_timestamp() where id = $1', [id.session]);
    assert.deepEqual([error.code, error.message], ['LA011', message]);
  });

  it('a locked session unlocked by a statement, not through the function, is refused even for the superuser', async () => {
    const error = await refusalOf(`${lock}; update lims.session set locked_at = null where id = '${id.session}'`);
    assert.deepEqual([error.code, error.message], ['LA011', message]);
  });

  it('a session opened already locked by a statement, not through the function, is refused even for the superuser', async () => {
    const error = await refusalOf(
      'insert into lims.session (lab_id, id, person_id, token_hash, locked_at) values ($1, $2, $3, $4, clock_timestamp())',
      [id.lab, randomUUID(), id.person, Buffer.alloc(32, 7)],
    );
    assert.deepEqual([error.code, error.message], ['LA011', message]);
  });

  it('a lock lands at one instant: the session is locked at the instant its Lock Access Event records', async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(asOwner);
      await client.query(`select pg_sleep(0.01)`);
      await client.query(`select lims.lock_session(${args})`);
      const { rows } = await client.query<{ same: boolean }>(
        `select s.locked_at = e.at as same from lims.session s
           join lims.access_event e on e.session_id = s.id and e.kind = 'Lock'
          where s.id = $1`,
        [id.session],
      );
      assert.deepEqual(rows, [{ same: true }]);
    } finally {
      await client.query('rollback');
    }
  });

  it('a lock on a session that lapsed ends it at its lapse with its expiry Access Event and writes no Lock', async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(asOwner);
      await client.query(
        `update lims.session set created_at = created_at - interval '1 hour', last_seen_at = last_seen_at - interval '1 hour'
          where id = $1`,
        [id.session],
      );
      const { rows: first } = await client.query<{ changed: boolean | null }>(
        `select lims.lock_session(${args}) as changed`,
      );
      const { rows: again } = await client.query<{ changed: boolean | null }>(
        `select lims.lock_session(${args}) as changed`,
      );
      const { rows: session } = await client.query<{ atLapse: boolean; unlocked: boolean }>(
        `select ended_at = last_seen_at + interval '15 minutes' as "atLapse", locked_at is null as unlocked
           from lims.session where id = $1`,
        [id.session],
      );
      const { rows: events } = await client.query<{ kind: string }>(
        `select kind from lims.access_event
          where session_id = $1 and kind in ('Lock', 'IdleExpiry', 'AbsoluteExpiry') order by at`,
        [id.session],
      );
      assert.deepEqual([first[0]?.changed, again[0]?.changed], [null, null], 'a session not live answers null');
      assert.deepEqual(session, [{ atLapse: true, unlocked: true }]);
      assert.deepEqual(
        events.map((event) => event.kind),
        ['IdleExpiry'],
      );
    } finally {
      await client.query('rollback');
    }
  });

  it("a lock or an unlock by anyone but the session's person is refused", async () => {
    const error = await refusalOf(`select lims.lock_session(${args})`);
    assert.deepEqual(
      [error.code, error.message],
      ['LA012', 'a session is locked and unlocked only by its own person, not person:refusal.admin'],
    );
    const unlocking = await refusalOf(
      `${lock}; ${reauthenticated}; select set_config('lims.actor', 'person:refusal.other', true); ${unlock}`,
    );
    assert.equal(unlocking.code, 'LA012', unlocking.message);
  });

  it("an unlock in a transaction not stamped with the re-authentication of the session's person is refused", async () => {
    const error = await refusalOf(`${lock}; ${unlock}`);
    assert.deepEqual(
      [error.code, error.message],
      ['LA013', "an unlock needs the session's person re-authenticated in this transaction"],
    );
    const other = await refusalOf(
      `${lock}; select lims.set_this_transaction('lims.reauthenticated', '${id.otherPerson}'); ${unlock}`,
    );
    assert.equal(other.code, 'LA013', other.message);
  });

  it("a lock and its unlock, each by the session's person with the unlock re-authenticated, write one Lock and one Unlock Access Event", async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(asOwner);
      const { rows: locked } = await client.query<{ changed: boolean }>(`select lims.lock_session(${args}) as changed`);
      const { rows: again } = await client.query<{ changed: boolean }>(`select lims.lock_session(${args}) as changed`);
      await client.query(reauthenticated);
      const { rows: unlocked } = await client.query<{ changed: boolean }>(`${unlock} as changed`);
      const { rows: events } = await client.query<{ kind: string; source: string; roles: string }>(
        `select kind, host(source_address) as source, roles::text as roles from lims.access_event
          where session_id = $1 and kind in ('Lock', 'Unlock') order by at`,
        [id.session],
      );
      assert.deepEqual(
        [locked[0]?.changed, again[0]?.changed, unlocked[0]?.changed],
        [true, false, true],
        'the second lock changed nothing',
      );
      assert.deepEqual(events, [
        { kind: 'Lock', source: '192.0.2.1', roles: '{Analyst}' },
        { kind: 'Unlock', source: '192.0.2.1', roles: '{Analyst}' },
      ]);
    } finally {
      await client.query('rollback');
    }
  });

  it('the app role holds no update on locked_at, so a lock or an unlock by a statement is refused before any trigger', async () => {
    for (const value of ['clock_timestamp()', 'null']) {
      const error = await refusalOf(
        `set local role lims_app; update lims.session set locked_at = ${value} where id = '${id.session}'`,
      );
      assert.equal(error.code, '42501', error.message);
    }
  });

  it('the app role writes a session only by opening it: it inserts the identity columns and changes nothing', async () => {
    const { rows } = await client.query<{ privilege: string }>(
      `select privilege_type || ' ' || column_name as privilege from information_schema.column_privileges
        where grantee = 'lims_app' and table_schema = 'lims' and table_name = 'session' and privilege_type <> 'SELECT'
        order by 1`,
    );
    assert.deepEqual(
      rows.map((row) => row.privilege),
      ['INSERT lab_id', 'INSERT person_id', 'INSERT token_hash', 'INSERT workstation_id'],
    );
  });
});

describe("a Chain Verification names an entry of its chain and that entry's hash", () => {
  covered.add('lims.chain_verification.head_matches_entry');
  it('a Chain Verification whose hash is not the hash of the entry it verified through is refused', async () => {
    const error = await refusalOfRow('lims.chain_verification', { head: Buffer.alloc(32, 9) });
    assert.deepEqual(
      [error.code, error.message],
      ['LA014', "a Chain Verification names an entry of its chain and that entry's hash"],
    );
  });
  it('a Chain Verification through an entry its chain does not have is refused', async () => {
    const error = await refusalOfRow('lims.chain_verification', { through: 1000000 });
    assert.equal(error.code, 'LA014', error.message);
  });
  it('a Chain Verification recorded in a role other than QA is refused', async () => {
    const error = await refusalOfRow('lims.chain_verification');
    assert.deepEqual([error.code, error.message], ['LA015', 'a Chain Verification is recorded by QA, not system']);
  });
  it('a Chain Verification whose Verified by is not the acting QA is refused', async () => {
    const error = await refusalOf(
      `${actingAs('QA')};
       insert into lims.chain_verification (chain, through, head, recomputed_from, verified_by)
       select 'company', 1, hash, 1, '${id.person}' from lims.audit_entry where chain = 'company' and seq = 1`,
    );
    assert.deepEqual(
      [error.code, error.message],
      ['LA015', 'a Chain Verification is verified by the acting QA person:refusal.other, not person:refusal.person'],
    );
  });
});

describe("a password is changed only by lims.change_password, after the session's person re-authenticated", () => {
  const change = `select lims.change_password('${id.lab}', '${id.session}', 'scrypt-hmac$changed', '192.0.2.1')`;

  it("a password change in a transaction not stamped with the re-authentication of the session's person is refused", async () => {
    const error = await refusalOf(change);
    assert.deepEqual(
      [error.code, error.message],
      ['LA015', "a password change needs the session's person re-authenticated in this transaction"],
    );
    const other = await refusalOf(
      `select lims.set_this_transaction('lims.reauthenticated', '${id.otherPerson}'); ${change}`,
    );
    assert.equal(other.code, 'LA015', other.message);
  });

  it("a password change after the session's person re-authenticated sets the hash and writes a PasswordChanged Access Event", async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await client.query(`select lims.set_this_transaction('lims.reauthenticated', '${id.person}')`);
      await client.query(`set local role lims_app; ${change}`);
      const { rows: person } = await client.query('select password_hash from lims.person where id = $1', [id.person]);
      const { rows: events } = await client.query(
        `select kind, session_lab_id, host(source_address) as source, roles::text as roles from lims.access_event
          where session_id = $1 and kind = 'PasswordChanged'`,
        [id.session],
      );
      assert.deepEqual(person, [{ password_hash: 'scrypt-hmac$changed' }]);
      assert.deepEqual(events, [
        { kind: 'PasswordChanged', session_lab_id: id.lab, source: '192.0.2.1', roles: '{Analyst}' },
      ]);
    } finally {
      await client.query('rollback');
    }
  });
});

describe("a Lab's time zone changes only through a migration, and a Signature and a Received keep the zone in force when written", () => {
  it("the app role holds no update on a Lab's time zone, so a statement that changes it is refused", async () => {
    const error = await refusalOf("set local role lims_app; update lims.lab set time_zone = 'Asia/Tokyo'");
    assert.equal(error.code, '42501', error.message);
    const { rows } = await client.query<{ privilege: string }>(
      `select privilege_type || ' ' || column_name as privilege from information_schema.column_privileges
        where grantee = 'lims_app' and table_schema = 'lims' and table_name = 'lab' and privilege_type = 'UPDATE'
        order by 1`,
    );
    assert.deepEqual(
      rows.map((row) => row.privilege),
      ['UPDATE code', 'UPDATE name'],
    );
  });

  covered.add('lims.signature.sign_in_lab_time_zone');
  it("a Signature takes its Lab's time zone, whatever the insert says", async () => {
    const forged = { ...tables['lims.signature'].row, signed_time_zone: 'Asia/Tokyo' };
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await signingStamp(forged);
      const [statement, values] = insert('lims.signature', forged);
      const { rows } = await client.query<Row>(`${statement} returning signed_time_zone`, values);
      assert.deepEqual(rows, [{ signed_time_zone: 'America/New_York' }]);
    } finally {
      await client.query('rollback');
    }
  });

  covered.add('lims.signature.signature_signed_time_zone_not_null');
  it('a Signature in a Lab that does not exist is refused', async () => {
    const error = await refusalOfRow('lims.signature', { lab_id: missing });
    assert.deepEqual(
      [error.code, error.table, error.column],
      ['23502', 'signature', 'signed_time_zone'],
      error.message,
    );
  });

  covered.add('lims.sample.receive_in_lab_time_zone');
  it("a Received takes its Lab's time zone when it is recorded and keeps it through any other change, whatever the statement says", async () => {
    const sample = randomUUID();
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      const [statement, values] = insert('lims.sample', {
        ...tables['lims.sample'].row,
        id: sample,
        received_time_zone: 'Asia/Tokyo',
      });
      const zone = async (update: string, ...rest: unknown[]) =>
        (await client.query<{ zone: string | null }>(update, [sample, ...rest])).rows[0]?.zone;
      const inserted = await client.query<{ zone: string | null }>(
        `${statement} returning received_time_zone as zone`,
        values,
      );
      assert.deepEqual(
        [
          inserted.rows[0]?.zone,
          await zone(
            'update lims.sample set received_time_zone = $2 where id = $1 returning received_time_zone as zone',
            'Asia/Tokyo',
          ),
          await zone(
            'update lims.sample set received_at = clock_timestamp() where id = $1 returning received_time_zone as zone',
          ),
          await zone(
            'update lims.sample set received_time_zone = $2, description = $3 where id = $1 returning received_time_zone as zone',
            'Asia/Tokyo',
            'Capsules, relabelled',
          ),
          await zone(
            'update lims.sample set received_time_zone = null where id = $1 returning received_time_zone as zone',
          ),
        ],
        [null, null, 'America/New_York', 'America/New_York', 'America/New_York'],
      );
    } finally {
      await client.query('rollback');
    }
  });
});

describe('a kept time zone is a named zone of the time zone database, and a Sample keeps one exactly when it has a Received, even with the stamping triggers bypassed', () => {
  // The stamping triggers overwrite any zone a statement gives, so these rows reach the constraints with triggers off.
  const refusalOfKeptZone = (table: Table, change: Row) =>
    refusalWithTriggersOff(...insert(table, { ...tables[table].row, ...change }));
  const received = '2026-09-30T00:00:00Z';
  const notZones = ['Mars/Olympus_Mons', 'UTC+5', ''];
  const cases: { name: string; table: Table; change: Row; constraint: string }[] = [
    ...notZones.map((zone) => ({
      name: `a Signature kept in ${JSON.stringify(zone)}, which is not a named zone, is refused`,
      table: 'lims.signature' as const,
      change: { signed_time_zone: zone },
      constraint: 'signature_signed_time_zone_check',
    })),
    ...notZones.map((zone) => ({
      name: `a Received kept in ${JSON.stringify(zone)}, which is not a named zone, is refused`,
      table: 'lims.sample' as const,
      change: { received_at: received, received_time_zone: zone },
      constraint: 'sample_received_time_zone_check',
    })),
    {
      name: 'a Received time zone on a Sample with no Received is refused',
      table: 'lims.sample',
      change: { received_time_zone: 'America/New_York' },
      constraint: 'sample_received_time_zone_received_at_check',
    },
    {
      name: 'a Received with no time zone is refused',
      table: 'lims.sample',
      change: { received_at: received },
      constraint: 'sample_received_time_zone_received_at_check',
    },
  ];
  for (const c of cases) {
    covered.add(`${c.table}.${c.constraint}`);
    it(c.name, async () =>
      assertConstraint(await refusalOfKeptZone(c.table, c.change), '23514', c.table, c.constraint),
    );
  }
});

describe('a person is inserted without a lockout, so the database stamps every lockout', () => {
  covered.add('lims.person.insert_unlocked');
  // A Customer User, the one person the app role may insert without an Identity Verification.
  const bornLockedOut = `insert into lims.person (username, display_name, customer_id, locked_at)
    select 'refusal.born-locked-out', 'Born Locked Out', id, clock_timestamp() from lims.customer
     where name = 'Refusal Customer (fictional)'`;
  it('a person inserted already locked out is refused, for the app role and for the superuser', async () => {
    for (const asRole of ['set local role lims_app; ', '']) {
      const error = await refusalOf(`${asRole}${bornLockedOut}`);
      assert.deepEqual(
        [error.code, error.message],
        ['23514', 'a person is inserted without a lockout; a lockout lands only on a person already recorded'],
        asRole || 'as the superuser',
      );
    }
  });
});

it('every constraint, unique index and trigger of a freshly migrated database has a refusing test', async () => {
  const elsewhere = new Map([
    ['lims.authenticator.authenticator_pkey', 'authenticator.test.ts'],
    ['lims.authenticator.authenticator_person_id_fkey', 'authenticator.test.ts'],
    ['lims.authenticator.authenticator_person_id_not_null', 'authenticator.test.ts'],
    ['lims.authenticator.authenticator_secret_ciphertext_not_null', 'authenticator.test.ts'],
    ['lims.authenticator.authenticator_enrolled_at_not_null', 'authenticator.test.ts'],
    ['lims.authenticator.step_moves_forward', 'authenticator.test.ts'],
    ['lims.audit_entry.refuse_change', 'audit-trail.test.ts'],
    ['lims.access_event.open_incident', 'sign-in-incidents.test.ts'],
    ['lims.access_event.stamp_lockout', 'session-expiry.test.ts'],
    ['lims.person.lock_once', 'session-expiry.test.ts'],
    ['public.schema_migration.refuse_change', 'migrate.test.ts'],
    ['public.schema_migration.refuse_truncate', 'migrate.test.ts'],
    ['public.schema_migration.schema_migration_sha256_not_null', 'migrate.test.ts'],
    ['public.schema_migration.schema_migration_sha256_check', 'migrate.test.ts'],
    [
      'lims.record_version.record_version_content_hash_not_null',
      'unreachable: generated from content, which is not null',
    ],
    ['lims.session.session_lab_id_id_person_id_key', 'unreachable: (lab_id, id) is already the key'],
    [
      'lims.record_version.record_version_lab_id_id_content_hash_canonical_form_key',
      'unreachable: (lab_id, id) is already the key',
    ],
    [
      'lims.signature_statement.signature_statement_version_statement_hash_key',
      'unreachable: version is already the key',
    ],
    [
      'lims.signature_statement.signature_statement_statement_hash_not_null',
      'unreachable: generated from statement, which is not null',
    ],
    ['lims.reauthentication.reauthentication_facts_key', 'unreachable: (lab_id, id) is already the key'],
    ['lims.person.staff_account_through_identity_verification', 'staff-accounts.test.ts'],
    ['lims.membership.staff_role_needs_identity_verification', 'staff-accounts.test.ts'],
    [
      'lims.signature.signature_username_not_null',
      'unreachable: sign_as_the_person sets it with printed_name, whose not null refuses first',
    ],
    [
      'lims.signature.signature_lab_id_fkey',
      'unreachable: sign_in_lab_time_zone leaves signed_time_zone null, whose not null refuses first',
    ],
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
     select n.nspname || '.' || c.relname || '.' || i.relname
       from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
       join pg_namespace n on n.oid = c.relnamespace
      where x.indisunique and n.nspname in ('lims', 'public')
        and not exists (select from pg_constraint k where k.conindid = x.indexrelid and k.contype in ('p', 'u', 'x'))
     union all
     select n.nspname || '.' || c.relname || '.' || t.tgname
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('lims', 'public')`,
  );
  const rules = rows.map((row) => row.rule).sort();
  assert.deepEqual(rules, [...covered, ...elsewhere.keys()].sort());
});
