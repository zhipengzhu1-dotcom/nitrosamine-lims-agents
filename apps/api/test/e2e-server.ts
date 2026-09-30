// The API the browser end-to-end run drives (apps/web/e2e). It runs on its own database cloned
// from the migrated template, with the API tests' `widget` kind standing in for the sample
// chain's Test, and the signing cast enrolled and enabled through the real commands. It writes
// what a person would carry (user ID, password, the authenticator secret from their own QR scan)
// to E2E_STATE for the browser test to type, then listens until it is stopped.
//
//   E2E_API_PORT=3107 E2E_STATE=/tmp/lims-e2e.json node apps/api/test/e2e-server.ts

import { writeFileSync } from 'node:fs';
import { ensureTemplate } from '@lims/db/testing';
import { createPerson } from '../src/commands/identity.ts';
import { login, testApi } from '../src/testing/harness.ts';
import { cast, createWidget, installWidget, newWidget, widgetKind } from './support.ts';

const port = Number(process.env['E2E_API_PORT'] ?? 3107);
const statePath = process.env['E2E_STATE'];
if (!statePath) throw new Error('E2E_STATE names the file the browser test reads');

await ensureTemplate();
const api = await testApi({ kinds: [widgetKind], commands: [createWidget] });
await installWidget(api);
const people = await cast(api);
const annTab = await login(api, people.ann);
const widget = await newWidget(annTab, 'W-E2E');
await annTab.command('session.logout', {});

const newcomer = await api.run(api.seed, createPerson, { printedName: 'Fay Newcomer', username: 'fay', grants: [{ role: 'Analyst', lab: people.lab.id }] });
if (newcomer.kind !== 'receipt') throw new Error(`createPerson: ${newcomer.refusal.message}`);

const carried = (p: typeof people.ann) => ({ username: p.username, printedName: p.printedName, password: p.password, secret: p.auth.secret, lastUsedStep: p.auth.lastUsedStep() });

writeFileSync(
  statePath,
  JSON.stringify({
    widget,
    lab: people.lab,
    database: api.db.name,
    people: { ann: carried(people.ann), bob: carried(people.bob), admin: carried(people.admin) },
    enrolmentToken: (newcomer.once?.data as { enrolmentToken: string }).enrolmentToken,
  }),
);

await api.app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void api.close().finally(() => process.exit(0));
  });
}
