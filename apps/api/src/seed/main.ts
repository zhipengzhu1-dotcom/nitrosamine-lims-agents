// pnpm seed [--handover]
//
// Seeds the demo dataset into the configured database through the real API (built in-process),
// then, with --handover, revokes the seed's authenticators on the demo accounts and prints one
// one-time enrolment link per account for the owner to scan into a real authenticator app. Both
// are audited. Reads the same environment the API does (deploy/README.md, "Runtime contract").

import { randomUUID } from 'node:crypto';
import { createDb, SERVICE } from '@lims/db';
import { serviceActor } from '../actor.ts';
import { buildApp } from '../app.ts';
import { CHAIN } from '../chain/index.ts';
import { commit } from '../commit.ts';
import { loadConfig } from '../config.ts';
import { reenrol } from '../commands/identity.ts';
import { DEMO_ACCOUNTS } from './cast.ts';
import { Client } from './drive.ts';
import { alreadySeeded, seedDemo } from './index.ts';

const handover = process.argv.includes('--handover');
const config = loadConfig();
const db = createDb(config.database);
const api = await buildApp({ db, config, ...CHAIN });
const seed = serviceActor('svc:seed', SERVICE.seed.person);
const driver = {
  client: () => new Client(api.app),
  run: (who: Parameters<typeof commit>[1], def: Parameters<typeof commit>[3], input: unknown) => commit(api.deps, who, randomUUID(), def, def.input.parse(input)),
  seed,
};

try {
  if (await alreadySeeded(db)) {
    console.log('Already seeded; leaving the data as it is.');
  } else {
    await seedDemo(driver, api.deps, (line) => console.log(`  ${line}`));
    console.log('Seeded.');
  }
  if (handover) {
    console.log('\nHandover: the seed\'s authenticators are revoked; enrol each account through its link within 24 hours.\n');
    for (const [username, printedName, role] of DEMO_ACCOUNTS) {
      const out = await driver.run(seed, reenrol, { username });
      if (out.kind !== 'receipt') throw new Error(`reenrol ${username}: ${out.refusal.message}`);
      const token = (out.once?.data as { enrolmentToken: string }).enrolmentToken;
      console.log(`${username.padEnd(6)} ${printedName.padEnd(16)} ${role.padEnd(40)} /enrol#${token}`);
    }
  }
} finally {
  await api.app.close();
  await db.destroy();
}
