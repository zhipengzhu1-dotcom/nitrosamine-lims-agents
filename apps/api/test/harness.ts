import assert from 'node:assert/strict';
import { after } from 'node:test';
import { audited, createDb, databaseUrl, type Role } from '@lims/db';
import { hashPassword } from '@lims/db/credentials';
import { migrate } from '@lims/db/migrate';
import { type SeededAccount, seed } from '@lims/db/seed';
import { pathOf, type Reply, type Route, type RouteInput, type RouteReply, readReply, routes } from '@lims/domain';
import { sql } from 'kysely';
import { buildApp } from '../src/app.ts';

export interface Account {
  id: string;
  username: string;
  password: string;
}

type SeededName = SeededAccount['username'] extends infer U ? (U extends `${infer N}.${string}` ? N : never) : never;
export type Answer<R extends Route> = Exclude<Reply<R>, { kind: 'breach' }>;

export class Client {
  cookie = '';
  base: string;
  constructor(base: string) {
    this.base = base;
  }

  async call<R extends Route>(route: R, ...request: RouteInput<R>): Promise<Answer<R>> {
    const [input] = request;
    const post = route.method === 'POST';
    const res = await fetch(this.base + pathOf(route, input), {
      method: route.method,
      headers: { cookie: this.cookie, ...(post ? { 'content-type': 'application/json' } : {}) },
      ...(post ? { body: JSON.stringify(input ?? {}) } : {}),
    });
    for (const header of res.headers.getSetCookie()) {
      const session = /^lims_session=[^;]*/.exec(header);
      if (session) this.cookie = session[0];
    }
    const answer = readReply(route, res.status, await res.json());
    return answer.kind === 'breach' ? assert.fail(answer.problem) : answer;
  }
}

export function ok<R extends Route>(answer: Answer<R>): RouteReply<R> {
  return answer.kind === 'reply'
    ? answer.body
    : assert.fail(`expected a reply, got ${answer.status}: ${answer.message}`);
}

export function refusedWith<R extends Route>(answer: Answer<R>, status: number): string {
  return answer.kind === 'refused' && answer.status === status
    ? answer.message
    : assert.fail(`expected a ${status} refusal, got ${answer.status}`);
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
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  after(async () => {
    await app.close();
    await db.destroy();
    await superuser.destroy();
  });
  const { labId } = await db.selectFrom('lab').select('labId').executeTakeFirstOrThrow();
  const { id: methodId } = await db.selectFrom('method').select('id').executeTakeFirstOrThrow();

  return {
    db,
    superuser,
    base,
    labId,
    methodId,
    person(name: SeededName): Account {
      return seeded.find((a) => a.username.startsWith(`${name}.`)) ?? assert.fail(`no seeded person ${name}`);
    },
    async login(account: Account): Promise<Client> {
      const client = new Client(base);
      ok(await client.call(routes.login, { username: account.username, password: account.password }));
      return client;
    },
    async addPerson(
      username: string,
      roles: Role[],
      opts: { trained?: boolean; customerId?: string } = {},
    ): Promise<Account> {
      const account = { username, password: `${username}-password-for-tests`, id: '' };
      await audited(db, { actor: 'svc:test', role: 'system', reason: 'Add a test person' }, async (tx) => {
        ({ id: account.id } = await tx
          .insertInto('person')
          .values({
            username,
            displayName: username,
            passwordHash: await hashPassword(account.password),
            customerId: opts.customerId ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow());
        for (const role of roles)
          await tx.insertInto('membership').values({ labId, personId: account.id, role }).execute();
        if (opts.trained)
          await tx.insertInto('trainingRecord').values({ labId, personId: account.id, methodId }).execute();
      });
      return account;
    },
  };
}
