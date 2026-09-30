// The API the browser walkthrough of the whole chain drives (apps/web/e2e/walkthrough.spec.ts). It
// seeds only the reference data and the people through the real commands, the same way the demo
// seed does, and leaves every Submission to the browser. It writes what each person carries (user
// ID, password, authenticator secret and the last code step the seed spent) to E2E_STATE, then
// listens until it is stopped.
//
//   E2E_API_PORT=3108 E2E_STATE=/tmp/lims-walkthrough.json node apps/api/test/e2e-chain-server.ts

import { writeFileSync } from 'node:fs';
import { ensureTemplate } from '@lims/db/testing';
import { CHAIN } from '../src/chain/index.ts';
import { authorise, seedCast } from '../src/seed/cast.ts';
import { METHOD_DOCUMENTS, METHOD_GCMS, METHOD_LCMS, seedCustomers, seedReference } from '../src/seed/reference.ts';
import { testApi, type Person } from '../src/testing/harness.ts';

const port = Number(process.env['E2E_API_PORT'] ?? 3108);
const statePath = process.env['E2E_STATE'];
if (!statePath) throw new Error('E2E_STATE names the file the browser test reads');

await ensureTemplate();
const api = await testApi(CHAIN);
const customers = await seedCustomers(api);
const cast = await seedCast(api, api.deps, customers, METHOD_DOCUMENTS);
await seedReference(api, cast, customers);
await authorise(cast, [METHOD_LCMS, METHOD_GCMS]);

const carried = (p: Person) => ({ username: p.username, printedName: p.printedName, password: p.password, secret: p.auth.secret, lastUsedStep: p.auth.lastUsedStep() });

writeFileSync(
  statePath,
  JSON.stringify({
    lab: cast.lab,
    people: { cara: carried(cast.cara), sam: carried(cast.sam), lena: carried(cast.lena), ann: carried(cast.ann), dee: carried(cast.dee), bob: carried(cast.bob), cid: carried(cast.cid), adam: carried(cast.adam) },
  }),
);

await api.app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void api.close().finally(() => process.exit(0));
  });
}
