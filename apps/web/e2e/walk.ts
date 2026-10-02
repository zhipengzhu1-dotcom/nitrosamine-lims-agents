import { randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { expect, type Page, test as playwright } from '@playwright/test';
import { API_LOG, DEMO_PASSWORD } from '../playwright.config.ts';

export { expect, type Locator, type Page } from '@playwright/test';

/** Playwright's `test`, which attaches the API log lines written during a walk that fails, so a 500 can be traced. */
export const test = playwright.extend<{ apiLog: void }>({
  apiLog: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
    async ({}, use, info) => {
      const from = statSync(API_LOG).size;
      await use();
      if (info.status === info.expectedStatus) return;
      const path = info.outputPath('api-log.ndjson');
      writeFileSync(path, readFileSync(API_LOG).subarray(from));
      await info.attach('api-log', { path, contentType: 'text/plain' });
    },
    { auto: true },
  ],
});

/** A new R&D Test, submitted, received, assigned to Ana Ferreira and signed Performed through the API, so a walk starts at Submitted For Review. Leaves the page signed out. */
export async function submittedTest(page: Page, description: string): Promise<string> {
  const labs: { id: string; code: string }[] = await (await page.request.get('/api/labs')).json();
  const labId = labs.find((lab) => lab.code === 'RD')?.id;
  const as = async (username: string) => {
    await page.request.post('/api/logout', { data: {} });
    const res = await page.request.post('/api/login', { data: { username, password: DEMO_PASSWORD, labId } });
    expect(res.ok(), `sign in as ${username}: ${res.status()} ${await res.text()}`).toBe(true);
  };
  const step = async (name: string, body: object) => {
    const res = await page.request.post(`/api/steps/${name}`, { data: { commitKey: randomUUID(), ...body } });
    expect(res.ok(), `${name}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  await as('cora.customer');
  const { methods } = await (await page.request.get('/api/lookups')).json();
  const { testId } = await step('submit', { input: { methodId: methods[0].id, description } });
  await as('samir.custodian');
  await step('receive', { testId, input: {} });
  await as('lena.manager');
  const { analysts } = await (await page.request.get('/api/lookups')).json();
  const ana = analysts.find((a: { displayName: string }) => a.displayName === 'Ana Ferreira');
  await step('assign', { testId, input: { assigneeId: ana.id } });
  await as('ana.analyst');
  const { recordVersion, statement } = await (await page.request.get(`/api/tests/${testId}`)).json();
  await step('enterResult', {
    testId,
    input: {
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0042',
      notebookRef: 'RD-NB-0007-012',
      performedOn: '2026-09-30',
    },
    signature: {
      username: 'ana.analyst',
      password: DEMO_PASSWORD,
      recordVersion: { version: recordVersion.version, contentHash: recordVersion.contentHash },
      statementVersion: statement.version,
    },
  });
  await page.request.post('/api/logout', { data: {} });
  return testId;
}
