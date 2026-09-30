// The Admin's Labs view: the Admin creates people with role grants in a Lab, and picks the Lab from
// the company's list rather than typing its id (decision 13 §3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrol, login, testApi, type TestApi } from '../src/testing/harness.ts';
import { createLab } from './support.ts';

let api: TestApi;
beforeAll(async () => {
  api = await testApi();
});
afterAll(() => api.close());

describe('admin.labs', () => {
  it('lists every Lab with its code and zone for the Admin, and refuses a Lab session', async () => {
    const rd = await createLab(api, 'RD');
    const qc = await createLab(api, 'QC');
    const adam = await enrol(api, { username: 'adam', printedName: 'Adam Admin', grants: [{ role: 'Admin' }] });
    const ann = await enrol(api, { username: 'ann', printedName: 'Ann Analyst', grants: [{ role: 'Analyst', lab: rd.id as never }] });
    const admin = await login(api, adam);
    const r = await admin.view('admin.labs');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ labs: [
      { id: qc.id, code: 'QC', zone: 'America/New_York' },
      { id: rd.id, code: 'RD', zone: 'America/New_York' },
    ] });
    expect((await (await login(api, ann)).view('admin.labs')).status).toBe(403);
  });
});
