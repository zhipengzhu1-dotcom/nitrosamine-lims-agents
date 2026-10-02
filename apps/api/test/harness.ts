import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after } from 'node:test';
import { audited, checkoutDatabase, createDb, type DB, databaseUrl, dbServer, type Role } from '@lims/db';
import { hashPassword } from '@lims/db/credentials';
import { migrate } from '@lims/db/migrate';
import { type SeededAccount, seed } from '@lims/db/seed';
import {
  isSentence,
  pathOf,
  type RefusalKind,
  type Reply,
  type Route,
  type RouteInput,
  type RouteReply,
  readReply,
  routes,
  type SigningBody,
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
  sessionLocked: 423,
  role: 403,
  guard: 403,
  notFound: 404,
  state: 409,
  stale: 409,
  recordChanged: 409,
  signingRefused: 409,
  realDataRefused: 409,
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
  set cookie(header: string) {
    this.jar = new Map(
      header.split('; ').flatMap((pair): [string, string][] => {
        const at = pair.indexOf('=');
        return at > 0 ? [[pair.slice(0, at), pair.slice(at + 1)]] : [];
      }),
    );
  }
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
      const [, name = '', value = ''] = /^([^=]+)=([^;]*)/.exec(header) ?? [];
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    const answer = readReply(route, res.status, await res.json());
    if (answer.kind === 'breach') assert.fail(answer.problem);
    if (answer.kind === 'refused') {
      assert.equal(answer.status, STATUS_OF[answer.body.kind], `the status of a ${answer.body.kind} refusal`);
      assert.ok(
        isSentence(answer.body.message),
        `the message of a ${answer.body.kind} refusal: ${answer.body.message}`,
      );
    }
    return answer;
  }
}

export function ok<R extends Route>(answer: Answer<R>): RouteReply<R> {
  return answer.kind === 'reply'
    ? answer.body
    : assert.fail(`expected a reply, got ${answer.status} ${answer.body.kind}: ${answer.body.message}`);
}

export async function signatureOf(client: Client, testId: string, account: Account): Promise<SigningBody> {
  const { recordVersion, statement } = ok(await client.call(routes.test, { id: testId }));
  const { version, contentHash } = recordVersion ?? assert.fail('a signer sees the Record Version of the Test');
  return {
    username: account.username,
    password: account.password,
    recordVersion: { version, contentHash },
    statementVersion: statement?.version ?? assert.fail('a signer sees the signature statement'),
  };
}

export function refusedWith<R extends Route>(answer: Answer<R>, kind: RefusalKind): string {
  return answer.kind === 'refused' && answer.body.kind === kind
    ? answer.body.message
    : assert.fail(
        `expected a ${kind} refusal, got ${answer.status} ${answer.kind === 'refused' ? answer.body.kind : 'reply'}`,
      );
}

const accessEventKey = randomBytes(32);
export const TEST_RELEASE = 'test-release';

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
    release: TEST_RELEASE,
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

  /**
   * Resolves once `sessions` backends of this database wait on a lock, polled on a connection of its own, because a
   * transaction sees one frozen snapshot of `pg_stat_activity`; fails after about 10 s.
   */
  async function untilWaitingOnLocks(sessions: number): Promise<void> {
    for (let polls = 0; polls < 200; polls++) {
      const { waiting } = await superuser
        .selectNoFrom(
          sql<number>`(select count(*)::int from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock')`.as('waiting'),
        )
        .executeTakeFirstOrThrow();
      if (waiting >= sessions) return;
      await sql`select pg_sleep(0.05)`.execute(superuser);
    }
    assert.fail(`${sessions} sessions never waited on a lock`);
  }

  return {
    db,
    superuser,
    base,
    app,
    accessEventKey,
    log,
    logLines,
    startAnotherApi: (options: ListenOptions = {}) => listen(db, options),
    untilWaitingOnLocks,
    /**
     * Lands a Lockout on `account` that commits while `press` waits on a lock: the person row is locked out and the
     * Signature table held in one open transaction, so a signing that never waits on the person row reads it unlocked
     * and waits at its Signature insert instead, inside the window between that read and its commit. An unlock takes no
     * Signature, so code that never holds the person row waits only on its failure-count reset: the unlock case enters a
     * wrong password first, leaving `failedLogins` at 1, so that such code waits too. A Lock holds no person row and
     * waits on the company chain, which the person update's Audit Trail capture takes. Sets `locked_at` alone, with no
     * Lockout Access Event.
     */
    async lockOutWhile<T>(account: Account, press: () => Promise<T>): Promise<T> {
      const as = { actor: 'svc:test', role: 'system', reason: 'Lock a person out while they press' } as const;
      const { answer } = await audited(superuser, as, async (tx) => {
        await sql`lock table lims.signature in exclusive mode`.execute(tx);
        await tx.updateTable('person').set({ lockedAt: sql`now()` }).where('id', '=', account.id).execute();
        const answer = press();
        // A press left behind by a failed wait must not surface as an unhandled rejection.
        answer.catch(() => {});
        await untilWaitingOnLocks(1);
        // Wrapped, so the transaction does not await an answer that waits on its own lock.
        return { answer };
      });
      return answer;
    },
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
      // The owner adds test people with passwords; the app role creates staff only on an Identity Verification.
      await audited(superuser, { actor: 'svc:test', role: 'system', reason: 'Add a test person' }, async (tx) => {
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
