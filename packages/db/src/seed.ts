import { randomBytes, randomUUID } from 'node:crypto';
import { type Kysely, sql, type Transaction } from 'kysely';
import { dbConfig } from './config.ts';
import { hashPassword } from './credentials.ts';
import { audited, createDb, type DB, databaseUrl } from './db.ts';

// All fictional. Two Analysts so the assignment gate has someone to refuse.
const people = [
  { role: 'Customer', username: 'cora.customer', name: 'Cora Lindqvist' },
  { role: 'SampleCustodian', username: 'samir.custodian', name: 'Samir Okafor' },
  { role: 'LabManager', username: 'lena.manager', name: 'Lena Varga' },
  { role: 'Analyst', username: 'ana.analyst', name: 'Ana Ferreira', trained: true },
  { role: 'Analyst', username: 'theo.untrained', name: 'Theo Brandt' },
  { role: 'Reviewer', username: 'rui.reviewer', name: 'Rui Tanaka' },
  { role: 'QA', username: 'quinn.qa', name: 'Quinn Adeyemi' },
  { role: 'Admin', username: 'ada.admin', name: 'Ada Novak' },
] as const;

export interface SeededAccount {
  id: string;
  username: (typeof people)[number]['username'];
  role: (typeof people)[number]['role'];
  password: string;
}

// A second Lab, so that a person with Memberships in both picks the Lab at sign-in and can switch Lab.
const secondLab = { code: 'QC', name: 'QC Laboratory (fictional)', members: ['lena.manager', 'rui.reviewer'] } as const;

const SEED = { actor: 'svc:seed', role: 'system', reason: 'Seed fictional demo data' };

/** The service identities the LIMS acts as, each held by the database to the writes its Release Log entry declares. */
export const SERVICE_IDENTITIES = [
  {
    name: 'svc:seed',
    scope: [
      'customer:INSERT',
      'method:INSERT',
      'lab:INSERT',
      'room:INSERT',
      'person:INSERT',
      'membership:INSERT',
      'training_record:INSERT',
      'release_log_entry:INSERT',
      'service_identity:INSERT',
    ],
  },
  { name: 'svc:sign-in', scope: ['access_event:INSERT', 'person:UPDATE', 'credential_link:UPDATE'] },
  { name: 'svc:session-sweep', scope: ['access_event:INSERT'] },
  { name: 'svc:incident', scope: ['system_incident:INSERT'] },
] as const;

type DemoException = 'TwoRole' | 'Anchoring' | 'FileVault' | 'PlaintextAtCloudflare' | 'DemoLogin';

// The first Release Log entries: one declaring the service identities, then one per demo exception the demo runs
// under (ADR 0002). Each is approved by the Platform Operator in the seed transaction, with a re-authentication
// record the seed writes itself, which the DemoLogin entry records.
const ENTRIES: { title: string; summary: string; recordsExceptions?: [DemoException] }[] = [
  {
    title: 'Service identities of the API and the seed',
    summary: `Declares ${SERVICE_IDENTITIES.map((s) => s.name).join(', ')} and the writes each may make.`,
  },
  {
    title: 'Demo exception: one person holds two roles',
    summary: 'Ada Novak holds Admin and PlatformOperator in the R&D Laboratory, so that the demo has one operator.',
    recordsExceptions: ['TwoRole'],
  },
  {
    title: 'Demo exception: no anchoring of the Audit Trail',
    summary: 'The Audit Trail chain heads are not anchored outside the database until anchoring is built.',
    recordsExceptions: ['Anchoring'],
  },
  {
    title: 'Demo exception: FileVault without a personal recovery key',
    summary:
      'The Mac that hosts the demo has no personal FileVault key recorded; each entry that sets the data class records the fdesetup result.',
    recordsExceptions: ['FileVault'],
  },
  {
    title: 'Demo exception: plaintext at Cloudflare',
    summary: 'TLS ends at Cloudflare, which sees the demo traffic in plaintext before the tunnel to the Mac.',
    recordsExceptions: ['PlaintextAtCloudflare'],
  },
  {
    title: 'Demo exception: demo login',
    summary:
      'Every demo account shares one password, with no second factor, a lockout at 20 failures and the demo session limits. The seed also writes the re-authentication record behind each of these first approvals itself.',
    recordsExceptions: ['DemoLogin'],
  },
];

const assertSeeded = (username: string): never => {
  throw new Error(`the seed made no ${username}`);
};

/** Writes the entries as the seed, then signs each Approved as `operator` from a session in `labId` that lapses with the sweep. */
async function approveEntries(tx: Transaction<DB>, labId: string, operator: { id: string; username: string }) {
  const entries: string[] = [];
  for (const [i, entry] of ENTRIES.entries()) {
    const { id } = await tx
      .insertInto('releaseLogEntry')
      .values({ kind: 'ConfigurationChange', ...entry })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (i === 0)
      await tx
        .insertInto('serviceIdentity')
        .values(SERVICE_IDENTITIES.map((s) => ({ name: s.name, scope: [...s.scope], createdByEntryId: id })))
        .execute();
    entries.push(id);
  }
  const session = await tx
    .insertInto('session')
    .values({ labId, personId: operator.id, tokenHash: randomBytes(32) })
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`select set_config('lims.actor', ${`person:${operator.username}`}, true),
                   set_config('lims.role', 'PlatformOperator', true),
                   set_config('lims.reason', 'Approve the first Release Log entries', true)`.execute(tx);
  const { version: statementVersion } = await tx
    .selectFrom('signatureStatement')
    .select('version')
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
  for (const entryId of entries) {
    const seen = await tx
      .selectFrom('recordVersion')
      .select(['id', 'contentHash'])
      .where('recordTable', '=', 'release_log_entry')
      .where('recordId', '=', entryId)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();
    const proof = await tx
      .insertInto('reauthentication')
      .values({ labId, sessionId: session.id, personId: operator.id, meaning: 'Approved', authenticator: 'Password' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`select lims.sign(${proof.id}, ${session.id}, 'release_log_entry', ${entryId}, ${seen.id},
                               ${seen.contentHash}, ${statementVersion}, 'Approved', 'seed')`.execute(tx);
  }
}

/** Seeds two Labs, two Rooms in the first, one Customer, one Method and the demo people, who all share one password, into an empty database. */
export async function seed(db: Kysely<DB>, password = randomBytes(6).toString('base64url')): Promise<SeededAccount[]> {
  if (await db.selectFrom('lab').select('labId').executeTakeFirst())
    throw new Error('already seeded; seed a fresh database');
  const accounts = await audited(db, SEED, async (tx) => {
    const customer = await tx
      .insertInto('customer')
      .values({ name: 'Northwind Generics (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const method = await tx
      .insertInto('method')
      .values({ code: 'RD-MTH-0001', version: '1', title: 'NDMA in metformin hydrochloride by LC-MS/MS' })
      .returning('id')
      .executeTakeFirstOrThrow();
    // One transaction seeds everything, because only the seeding transaction may make staff without an Identity
    // Verification (0015). A Lab row starts its own chain, and chains are locked company first, then Labs by ID, so
    // the Labs come after the company rows and in ID order.
    const [labId, secondLabId] = [randomUUID(), randomUUID()];
    const labs = [
      { labId, code: 'RD', name: 'R&D Laboratory (fictional)', timeZone: 'America/New_York' },
      { labId: secondLabId, code: secondLab.code, name: secondLab.name, timeZone: 'America/New_York' },
    ].sort((x, y) => (x.labId < y.labId ? -1 : 1));
    for (const lab of labs) await tx.insertInto('lab').values(lab).execute();
    await tx
      .insertInto('room')
      .values([
        { labId, name: 'LC-MS/MS Room (fictional)' },
        { labId, name: 'Sample Preparation Room (fictional)' },
      ])
      .execute();
    const out: SeededAccount[] = [];
    for (const p of people) {
      const { id } = await tx
        .insertInto('person')
        .values({
          username: p.username,
          displayName: p.name,
          passwordHash: await hashPassword(password),
          customerId: p.role === 'Customer' ? customer.id : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ labId, personId: id, role: p.role }).execute();
      if ('trained' in p)
        await tx.insertInto('trainingRecord').values({ labId, personId: id, methodId: method.id }).execute();
      if (secondLab.members.some((m) => m === p.username))
        await tx.insertInto('membership').values({ labId: secondLabId, personId: id, role: p.role }).execute();
      out.push({ id, username: p.username, role: p.role, password });
    }
    const ada = out.find((a) => a.username === 'ada.admin') ?? assertSeeded('ada.admin');
    // The demo's one operator: Admin and PlatformOperator in one person, the TwoRole exception the entries record.
    await tx.insertInto('membership').values({ labId, personId: ada.id, role: 'PlatformOperator' }).execute();
    await approveEntries(tx, labId, ada);
    return out;
  });
  return accounts;
}

if (import.meta.main) {
  const { server, database, demoPassword } = dbConfig();
  const db = createDb(databaseUrl(server, database, 'lims_app'));
  try {
    const accounts = await seed(db, demoPassword);
    console.table(accounts.map((a) => ({ username: a.username, role: a.role })));
    const [first] = accounts;
    if (!first) throw new Error('the seed made no accounts');
    console.log(`Every account signs in with the password: ${first.password}`);
  } finally {
    await db.destroy();
  }
}
