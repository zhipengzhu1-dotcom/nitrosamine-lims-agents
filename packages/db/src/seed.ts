import { randomBytes, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
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
