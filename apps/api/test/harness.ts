import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after } from 'node:test';
import { audited, checkoutDatabase, createDb, type DB, databaseUrl, dbConfig, type Role } from '@lims/db';
import { hashPassword } from '@lims/db/credentials';
import { migrate } from '@lims/db/migrate';
import { type SeededAccount, seed } from '@lims/db/seed';
import {
  pathOf,
  type RefusalKind,
  type Reply,
  type Route,
  type RouteInput,
  type RouteReply,
  readReply,
  routes,
} from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import { buildApp } from '../src/app.ts';

const { server } = dbConfig();

/** The status each kind answers with, as the tests expect it; every refused answer is checked against this table. */
const STATUS_OF: { readonly [K in RefusalKind]: number } = {
  unknownField: 400,
  malformed: 400,
  badCredentials: 401,
  noSession: 401,
  sessionLocked: 423,
  role: 403,
  guard: 403,
  notFound: 404,
  state: 409,
  stale: 409,
  keyReused: 422,
  accountLocked: 423,
  failure: 500,
};

export interface Account {
  id: string;
  username: string;
  password: string;
}

type SeededName = SeededAccount['username'] extends infer U ? (U extends `${infer N}.${string}` ? N : never) : never;
export type Answer<R extends Route> = Exclude<Reply<R>, { kind: 'breach' }>;

export class Client {
  /** The browser's cookies: the session and, once the browser is enrolled, its device token. */
  jar = new Map<string, string>();
  get cookie(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  base: string;
  constructor(base: string) {
    this.base = base;
  }

  call<R extends Route>(route: R, ...request: RouteInput<R>): Promise<Answer<R>> {
    return this.send(route, request[0]);
  }

  async send<R extends Route>(route: R, request: unknown): Promise<Answer<R>> {
    const post = route.method === 'POST';
    const res = await fetch(this.base + pathOf(route, request), {
      method: route.method,
      headers: { cookie: this.cookie, ...(post ? { 'content-type': 'application/json' } : {}) },
      ...(post ? { body: JSON.stringify(request ?? {}) } : {}),
    });
    for (const header of res.headers.getSetCookie()) {
      const [, name = '', value = ''] = /^([^=]+)=([^;]*)/.exec(header) ?? [];
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    const answer = readReply(route, res.status, await res.json());
    if (answer.kind === 'breach') assert.fail(answer.problem);
    if (answer.kind === 'refused')
      assert.equal(answer.status, STATUS_OF[answer.body.kind], `the status of a ${answer.body.kind} refusal`);
    return answer;
  }
}

export function ok<R extends Route>(answer: Answer<R>): RouteReply<R> {
  return answer.kind === 'reply'
    ? answer.body
    : assert.fail(`expected a reply, got ${answer.status} ${answer.body.kind}: ${answer.body.message}`);
}

export function refusedWith<R extends Route>(answer: Answer<R>, kind: RefusalKind): string {
  return answer.kind === 'refused' && answer.body.kind === kind
    ? answer.body.message
    : assert.fail(
        `expected a ${kind} refusal, got ${answer.status} ${answer.kind === 'refused' ? answer.body.kind : 'reply'}`,
      );
}

const accessEventKey = randomBytes(32);

async function listen(db: Kysely<DB>, { secureCookie = false } = {}) {
  const lines: string[] = [];
  const app = buildApp(db, { log: { write: (line) => lines.push(line) }, secureCookie, accessEventKey });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  after(() => app.close());
  return {
    app,
    base,
    log: () => lines.join(''),
    logLines: () => lines.map((line): Record<string, unknown> => JSON.parse(line)),
  };
}

/** A fresh migrated and seeded database, named after `name` and this checkout, behind a listening API that keeps its log lines, torn down after the file's tests. */
export async function startApi(name: string) {
  const database = checkoutDatabase(name);
  const admin = createDb(databaseUrl(server, 'postgres'));
  await sql`drop database if exists ${sql.id(database)} with (force)`.execute(admin);
  await admin.destroy();
  await migrate(server, database);
  const db = createDb(databaseUrl(server, database, 'lims_app'));
  const superuser = createDb(databaseUrl(server, database)).withSchema('lims');
  const seeded = await seed(db);
  const { app, base, log, logLines } = await listen(db);
  after(async () => {
    await db.destroy();
    await superuser.destroy();
  });
  const { labId } = await db.selectFrom('lab').select('labId').executeTakeFirstOrThrow();
  const { id: methodId } = await db.selectFrom('method').select('id').executeTakeFirstOrThrow();

  return {
    db,
    superuser,
    base,
    app,
    accessEventKey,
    log,
    logLines,
    startAnotherApi: (options: { secureCookie?: boolean } = {}) => listen(db, options),
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
