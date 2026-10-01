import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { audited, createDb, databaseUrl, type Role } from '@lims/db';
import { hashPassword, newTotpSecret, totpCode, totpStep } from '@lims/db/credentials';
import { migrate } from '@lims/db/migrate';
import { seed } from '@lims/db/seed';
import { sql } from 'kysely';
import { buildApp } from '../src/app.ts';

export interface Account { id: string; username: string; password: string; totpSecret: string; lastStep: number }

/** A code for a time step this account has not used yet, waiting for the next step when the window is spent. */
export async function freshCode(account: Account): Promise<string> {
  for (;;) {
    const step = Math.max(account.lastStep + 1, totpStep());
    if (step <= totpStep() + 1) {
      account.lastStep = step;
      return totpCode(account.totpSecret, step);
    }
    await sleep(1000);
  }
}

export class Client {
  cookie = '';
  base: string;
  constructor(base: string) {
    this.base = base;
  }

  async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(this.base + path, {
      method,
      headers: { cookie: this.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const session = res.headers.getSetCookie().find((c) => c.startsWith('lims_session='));
    if (session) this.cookie = session.split(';')[0]!;
    return { status: res.status, body: await res.json() };
  }
  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}) => this.call('POST', path, body);
}

/** A fresh migrated and seeded database behind a listening API, torn down after the file's tests. */
export async function startApi(database: string) {
  const admin = createDb(databaseUrl('postgres'));
  await sql`drop database if exists ${sql.id(database)} with (force)`.execute(admin);
  await admin.destroy();
  await migrate(database);
  const db = createDb(databaseUrl(database, 'lims_app'));
  const superuser = createDb(databaseUrl(database)).withSchema('lims');
  const seeded = await seed(db);
  const app = buildApp(db);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  after(async () => {
    await app.close();
    await db.destroy();
    await superuser.destroy();
  });
  const { lab_id: labId } = await db.selectFrom('lab').select('lab_id').executeTakeFirstOrThrow();
  const { id: methodId } = await db.selectFrom('method').select('id').executeTakeFirstOrThrow();
  const people = Object.fromEntries(seeded.map((a) => [a.username.split('.')[0]!, { ...a, lastStep: 0 }]));

  return {
    db, superuser, base, labId, methodId, people,
    async login(account: Account): Promise<Client> {
      const client = new Client(base);
      const first = await client.post('/api/login', { username: account.username, password: account.password });
      const second = await client.post('/api/login/totp', { ticket: first.body.ticket, code: await freshCode(account) });
      if (second.status !== 200) throw new Error(`login of ${account.username} failed: ${JSON.stringify(second.body)}`);
      return client;
    },
    async addPerson(username: string, roles: Role[], opts: { trained?: boolean; customerId?: string } = {}): Promise<Account> {
      const account = { username, password: `${username}-password-for-tests`, totpSecret: newTotpSecret(), lastStep: 0, id: '' };
      await audited(db, { actor: 'svc:test', role: 'system', reason: 'Add a test person' }, async (tx) => {
        ({ id: account.id } = await tx.insertInto('person').values({
          username, display_name: username, password_hash: await hashPassword(account.password),
          totp_secret: account.totpSecret, customer_id: opts.customerId ?? null,
        }).returning('id').executeTakeFirstOrThrow());
        for (const role of roles) await tx.insertInto('membership').values({ lab_id: labId, person_id: account.id, role }).execute();
        if (opts.trained) await tx.insertInto('training_record').values({ lab_id: labId, person_id: account.id, method_id: methodId }).execute();
      });
      return account;
    },
  };
}
