import { randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { expect, type Page, test as playwright } from '@playwright/test';
import { type RouteReply, routes, stepRoute } from '@lims/domain';
import { API_LOG, DEMO_PASSWORD } from '../playwright.config.ts';

export { expect, type Locator, type Page, type ViewportSize } from '@playwright/test';

/** A Lab record's time as every screen shows it: UTC, then the Lab's wall clock with its offset. */
export const utcThenLabClock = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d$/;

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

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1360, height: 900 };
export const TABLET = { width: 820, height: 1180 };
/** The widest screen the web lays out as an upright phone (app.css `max-width: 640px`). */
export const PHONE_MAX_WIDTH = 640;

/** Opens the Bench Rail's session block where an upright phone folds it; wider screens always show it. */
export async function openSessionBlock(page: Page) {
  if ((page.viewportSize()?.width ?? Infinity) > PHONE_MAX_WIDTH) return;
  const toggle = page.locator('.rail__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Signs out through the Bench Rail's Sign out button and waits for the sign-in screen. */
export async function signOutFromRail(page: Page) {
  await openSessionBlock(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** Ends any session of the page's browser and signs `username` in to the R&D Lab through the API. */
export async function signInByApi(page: Page, username: string) {
  const labs: RouteReply<typeof routes.labs> = await (await page.request.get('/api/labs')).json();
  const labId = labs.find((lab) => lab.code === 'RD')?.id;
  await page.request.post('/api/logout', { data: {} });
  const res = await page.request.post('/api/login', { data: { username, password: DEMO_PASSWORD, labId } });
  expect(res.ok(), `sign in as ${username}: ${res.status()} ${await res.text()}`).toBe(true);
}

/** A new R&D Test, submitted, received, assigned to Ana Ferreira and signed Performed through the API, so a walk starts at Submitted For Review. Leaves the page signed out. */
export async function submittedTest(page: Page, description: string): Promise<string> {
  const step = async (name: string, body: object): Promise<RouteReply<ReturnType<typeof stepRoute<'submit'>>>> => {
    const res = await page.request.post(`/api/steps/${name}`, { data: { commitKey: randomUUID(), ...body } });
    expect(res.ok(), `${name}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  const lookups = async (): Promise<RouteReply<typeof routes.lookups>> =>
    (await page.request.get('/api/lookups')).json();
  await signInByApi(page, 'cora.customer');
  const [method] = (await lookups()).methods;
  if (!method) throw new Error('the lookups offer no Method to submit a Test under');
  const { testId } = await step('submit', { input: { methodId: method.id, description } });
  await signInByApi(page, 'samir.custodian');
  await step('receive', { testId, input: {} });
  await signInByApi(page, 'lena.manager');
  const { analysts } = await lookups();
  const ana = analysts.find((a) => a.displayName === 'Ana Ferreira');
  if (!ana) throw new Error('the lookups offer no Analyst named Ana Ferreira');
  await step('assign', { testId, input: { assigneeId: ana.id } });
  await signInByApi(page, 'ana.analyst');
  const { recordVersion, statement }: RouteReply<typeof routes.test> = await (
    await page.request.get(`/api/tests/${testId}`)
  ).json();
  if (!recordVersion || !statement) throw new Error('the Assigned Test shows no Record Version or signature statement');
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
