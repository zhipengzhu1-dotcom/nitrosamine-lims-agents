// A test API on its own database, driven the way a browser and the seed script drive it: over
// the two doors with a cookie jar, and in-process through commit() as a service identity. The
// harness enrols people through the real commands and holds their TOTP secrets the way a phone
// would, so nothing here bypasses a credential check.

import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { SERVICE } from '@lims/db';
import { testDatabase, type TestDb } from '@lims/db/testing';
import { COMMAND_HEADER, SESSION_COOKIE } from '@lims/contract';
import type { CommitKey, PersonId } from '@lims/domain/ids';
import { serviceActor, type Requester } from '../actor.ts';
import { buildApp, type Api, type AppOptions } from '../app.ts';
import { commit, type Outcome } from '../commit.ts';
import type { AnyCommandDef } from '../doors.ts';
import { createPerson } from '../commands/identity.ts';
import { TOTP_PERIOD_SECONDS, totpCode, totpStep } from '../identity/totp.ts';

export const TEST_RELEASE = 'test';

export type TestApi = Api & {
  readonly db: TestDb;
  readonly close: () => Promise<void>;
  readonly client: () => Client;
  /** Runs a command in-process as a service identity (or any requester): the seed script's path. */
  readonly run: (who: Requester, def: AnyCommandDef, input: unknown, key?: CommitKey) => Promise<Outcome>;
  readonly seed: Requester;
};

/** The body is whatever JSON came back; tests read into it freely. */
export type Response = { readonly status: number; readonly body: any };

/** A browser tab: one cookie jar, the two doors, and the fixed endpoints. */
export class Client {
  cookie: string | undefined;
  readonly #app: FastifyInstance;

  constructor(app: FastifyInstance) {
    this.#app = app;
  }

  async #inject(opts: InjectOptions): Promise<Response> {
    const res = await this.#app.inject({ ...opts, headers: { ...opts.headers, ...(this.cookie ? { cookie: `${SESSION_COOKIE}=${this.cookie}` } : {}) } });
    const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) this.cookie = set.value === '' ? undefined : set.value;
    return { status: res.statusCode, body: res.body ? res.json() : {} };
  }

  get(path: string, query: Record<string, string> = {}): Promise<Response> {
    return this.#inject({ method: 'GET', url: path, query });
  }

  view(name: string, query: Record<string, string> = {}): Promise<Response> {
    return this.get(`/api/views/${name}`, query);
  }

  session(): Promise<Response> {
    return this.get('/api/session');
  }

  activity(): Promise<Response> {
    return this.#inject({ method: 'POST', url: '/api/session/activity', headers: { [COMMAND_HEADER]: '1' } });
  }

  command(name: string, input: unknown, key: string = randomUUID(), headers: Record<string, string> = { [COMMAND_HEADER]: '1' }): Promise<Response> {
    return this.#inject({ method: 'POST', url: `/api/commands/${name}`, headers, payload: { commitKey: key, input } });
  }

  raw(opts: InjectOptions): Promise<Response> {
    return this.#inject(opts);
  }
}

export async function testApi(extra: Omit<AppOptions, 'db' | 'config'> = {}): Promise<TestApi> {
  const db = await testDatabase();
  const config = { release: TEST_RELEASE, pepper: randomBytes(32), totpKey: randomBytes(32) };
  const api = await buildApp({ db: db.app, config, ...extra });
  const seed = serviceActor('svc:seed', SERVICE.seed.person);
  return {
    ...api,
    db,
    seed,
    client: () => new Client(api.app),
    run: (who, def, input, key = randomUUID() as CommitKey) => commit(api.deps, who, key, def, def.input.parse(input)),
    close: async () => {
      await api.app.close();
      await db.close();
    },
  };
}

/**
 * The test's authenticator app: it knows the secret from the enrolment QR and mints codes at the
 * wall clock. The server accepts each step once and a code from a step within ±1, so three codes
 * are available per 30-second period; when they are spent, next() waits for the next period.
 * No clock is injected anywhere: this is what a person with a phone would do.
 */
export class Authenticator {
  readonly secret: string;
  readonly #used = new Set<number>();

  constructor(otpauthUri: string) {
    const secret = new URL(otpauthUri).searchParams.get('secret');
    if (!secret) throw new Error('the otpauth URI carries no secret');
    this.secret = secret;
  }

  /** A code from a step never used for this person, waiting for a fresh period if all three are spent. */
  async next(): Promise<string> {
    for (;;) {
      const now = totpStep(new Date());
      const step = [now - 1, now, now + 1].find((s) => !this.#used.has(s));
      if (step !== undefined) {
        this.#used.add(step);
        return totpCode(this.secret, new Date(), step - now);
      }
      const msIntoPeriod = Date.now() % (TOTP_PERIOD_SECONDS * 1000);
      await new Promise((r) => setTimeout(r, TOTP_PERIOD_SECONDS * 1000 - msIntoPeriod + 50));
    }
  }

  /** The latest step this authenticator spent, so a second authenticator for the person can start after it. */
  lastUsedStep(): number | null {
    return this.#used.size === 0 ? null : Math.max(...this.#used);
  }

  /** A code the server has already accepted, for the "wait for the next code" test. */
  used(): string {
    const now = totpStep(new Date());
    const step = [now, now - 1, now + 1].find((s) => this.#used.has(s));
    if (step === undefined) throw new Error('no step of this period was used yet');
    return totpCode(this.secret, new Date(), step - now);
  }
}

export type Person = {
  readonly id: PersonId;
  readonly username: string;
  readonly printedName: string;
  readonly password: string;
  readonly auth: Authenticator;
};

export type Grant = { role: 'SampleCustodian' | 'Analyst' | 'Reviewer' | 'QA' | 'LabManager'; lab: string } | { role: 'Admin' };

const goodPassword = () => `Bench-${randomBytes(8).toString('hex')}-Q7!`;

/**
 * Creates a person as the seed service, then enrols them through the real one-time link: the
 * Admin never sees the password or the secret, and the enrolment's live code check consumes a
 * TOTP step. The returned nextCode() steps through the ±1 window so a test can sign a few times
 * per person inside one 30-second period.
 */
export async function enrol(api: TestApi, spec: { username: string; printedName: string; grants: readonly Grant[]; by?: Requester }): Promise<Person> {
  const created = await api.run(spec.by ?? api.seed, createPerson, { printedName: spec.printedName, username: spec.username, grants: spec.grants });
  if (created.kind !== 'receipt') throw new Error(`createPerson refused: ${created.refusal.message}`);
  const token = (created.once?.data as { enrolmentToken: string }).enrolmentToken;
  const id = (created.receipt.data as { personId: PersonId }).personId;
  const anon = api.client();
  const start = await anon.command('identity.enrolStart', { token });
  if (start.status !== 200) throw new Error(`enrolStart: ${JSON.stringify(start.body)}`);
  const auth = new Authenticator((start.body as { once?: { otpauthUri: string } }).once?.otpauthUri ?? (start.body['data'] as { otpauthUri: string }).otpauthUri);
  const password = goodPassword();
  const finish = await anon.command('identity.enrolFinish', { token, password, totp: await auth.next() });
  if (finish.status !== 200) throw new Error(`enrolFinish: ${JSON.stringify(finish.body)}`);
  return { id, username: spec.username, printedName: spec.printedName, password, auth };
}

/** Signs a person in on a fresh tab. */
export async function login(api: TestApi, person: Person, workstation = 'bench-1'): Promise<Client> {
  const tab = api.client();
  const r = await tab.command('session.login', { ...(await credentials(person)), workstation });
  if (r.status !== 200) throw new Error(`login: ${JSON.stringify(r.body)}`);
  return tab;
}

export const credentials = async (p: Person, over: Partial<{ typedUserId: string; password: string; totp: string }> = {}) =>
  ({ typedUserId: p.username, password: p.password, totp: over.totp ?? (over.password || over.typedUserId ? p.auth.used() : await p.auth.next()), ...over });

/** A signing over the door as the prompt does it: prepare, then sign exactly what was shown. */
export async function signAs(tab: Client, person: Person, meaning: string, role: string, targets: readonly string[], attestation: string | null = null): Promise<Response> {
  const prepared = await tab.command('signing.prepare', { meaning, role, targets, attestation });
  if (prepared.status !== 200) return prepared;
  const data = (prepared.body as { data: { items: { version: { versionId: string; hash: string } }[]; attestation: { versionId: string; hash: string } | null } }).data;
  return tab.command('signing.sign', {
    meaning, role, targets: data.items.map((i) => ({ versionId: i.version.versionId, hash: i.version.hash })),
    attestation: data.attestation ? { versionId: data.attestation.versionId, hash: data.attestation.hash } : null,
    credentials: await credentials(person),
  });
}
