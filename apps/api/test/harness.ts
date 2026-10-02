import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after } from 'node:test';
import { audited, checkoutDatabase, createDb, type DB, databaseUrl, dbServer, type Role } from '@lims/db';
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
import { type AppOptions, buildApp } from '../src/app.ts';

type LogSink = NonNullable<AppOptions['log']>;

const server = dbServer();

/** The status each kind answers with, as the tests expect it; every refused answer is checked against this table. */
const STATUS_OF: { readonly [K in RefusalKind]: number } = {
  unknownField: 400,
  malformed: 400,
  badCredentials: 401,
  labNotChosen: 400,
  noSession: 401,
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
  cookie = '';
  base: string;
  /** The source address the test's proxy forwards, or none for the socket's own address. */
  from: string | null;
  constructor(base: string, from: string | null = null) {
    this.base = base;
    this.from = from;
  }

  call<R extends Route>(route: R, ...request: RouteInput<R>): Promise<Answer<R>> {
    return this.send(route, request[0]);
  }

  async send<R extends Route>(route: R, request: unknown): Promise<Answer<R>> {
    const post = route.method === 'POST';
    const res = await fetch(this.base + pathOf(route, request), {
      method: route.method,
      headers: {
        cookie: this.cookie,
        ...(post ? { 'content-type': 'application/json' } : {}),
        ...(this.from ? { 'x-forwarded-for': this.from } : {}),
      },
      ...(post ? { body: JSON.stringify(request ?? {}) } : {}),
    });
    for (const header of res.headers.getSetCookie()) {
      const session = /^lims_session=[^;]*/.exec(header);
      if (session) this.cookie = session[0];
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

interface ListenOptions {
  secureCookie?: boolean;
  log?: LogSink;
  login?: AppOptions['login'];
  sweepEveryMs?: number | null;
  logVolume?: AppOptions['logVolume'];
  trustedProxies?: string[];
}

/** Listens on 127.0.0.1 and trusts it as a proxy unless told otherwise, so a Client's `from` sets the source address. */
async function listen(
  db: Kysely<DB>,
  {
    secureCookie = false,
    log,
    login = 'decided',
    sweepEveryMs = null,
    logVolume = null,
    trustedProxies = ['127.0.0.1'],
  }: ListenOptions = {},
) {
  const lines: string[] = [];
  const app = buildApp(db, {
    log: log ?? { write: (line) => lines.push(line) },
    logVolume,
    secureCookie,
    accessEventKey,
    login,
    sweepEveryMs,
    trustedProxies,
  });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  after(() => app.close());
  return {
    app,
    base,
    log: () => lines.join(''),
    logLines: () => lines.map((line): Record<string, unknown> => JSON.parse(line)),
  };
}

/**
 * A fresh migrated and seeded database, named after `name` and this checkout, behind a listening API with the decided
 * login and no sweep of its own, that keeps its log lines, torn down after the file's tests.
 */
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
  const labOf = async (code: string) =>
    (await db.selectFrom('lab').select('labId').where('code', '=', code).executeTakeFirstOrThrow()).labId;
  const labId = await labOf('RD');
  const qcLabId = await labOf('QC');
  const { id: methodId } = await db.selectFrom('method').select('id').executeTakeFirstOrThrow();

  return {
    db,
    superuser,
    base,
    app,
    accessEventKey,
    log,
    logLines,
    startAnotherApi: (options: ListenOptions = {}) => listen(db, options),
    /** The clock seam: moves a person's open sessions `ms` into the past, as a clock advanced by `ms` would leave them. */
    async advanceClock(account: Account, ms: number): Promise<void> {
      const by = sql`${ms} * interval '1 millisecond'`;
      await superuser
        .updateTable('session')
        .set({ createdAt: sql`created_at - ${by}`, lastSeenAt: sql`last_seen_at - ${by}` })
        .where('personId', '=', account.id)
        .where('endedAt', 'is', null)
        .execute();
    },
    labId,
    qcLabId,
    methodId,
    person(name: SeededName): Account {
      return seeded.find((a) => a.username.startsWith(`${name}.`)) ?? assert.fail(`no seeded person ${name}`);
    },
    async login(account: Account, lab = labId): Promise<Client> {
      const client = new Client(base);
      ok(await client.call(routes.login, { username: account.username, password: account.password, labId: lab }));
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
