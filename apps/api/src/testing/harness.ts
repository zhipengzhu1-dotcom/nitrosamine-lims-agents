// A test API on its own database, driven the way a browser and the seed script drive it: over
// the two doors with a cookie jar, and in-process through commit() as a service identity. The
// driving helpers live in src/seed/drive.ts and are re-exported here for the tests.

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVICE } from '@lims/db';
import { testDatabase, type TestDb } from '@lims/db/testing';
import type { CommitKey } from '@lims/domain/ids';
import { serviceActor, type Requester } from '../actor.ts';
import { buildApp, type Api, type AppOptions } from '../app.ts';
import { commit, type Outcome } from '../commit.ts';
import type { AnyCommandDef } from '../doors.ts';
import { Client, type Driver } from '../seed/drive.ts';

export { Authenticator, Client, credentials, enrol, login, mustSign, signAs, type Grant, type Person, type Response } from '../seed/drive.ts';

export const TEST_RELEASE = 'test';

export type TestApi = Api & Driver & {
  readonly db: TestDb;
  readonly close: () => Promise<void>;
};

export async function testApi(extra: Omit<AppOptions, 'db' | 'config'> = {}): Promise<TestApi> {
  const db = await testDatabase();
  const config = { release: TEST_RELEASE, pepper: randomBytes(32), totpKey: randomBytes(32), reportStore: mkdtempSync(join(tmpdir(), 'lims-reports-')), dataClass: 'fictional' as const };
  const api = await buildApp({ db: db.app, config, ...extra });
  const seed = serviceActor('svc:seed', SERVICE.seed.person);
  return {
    ...api,
    db,
    seed,
    client: () => new Client(api.app),
    run: (who: Requester, def: AnyCommandDef, input: unknown, key = randomUUID() as CommitKey): Promise<Outcome> => commit(api.deps, who, key, def, def.input.parse(input)),
    close: async () => {
      await api.app.close();
      await db.close();
    },
  };
}
