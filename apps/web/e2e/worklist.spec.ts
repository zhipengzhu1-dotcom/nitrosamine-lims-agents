import { randomUUID } from 'node:crypto';
import { type RouteReply, routes } from '@lims/domain';
import { expect, type Locator, type Page, signInByApi, submittedTest, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

async function requestedTest(page: Page, description: string) {
  await signInByApi(page, 'cora.customer');
  const { methods }: RouteReply<typeof routes.lookups> = await (await page.request.get('/api/lookups')).json();
  const res = await page.request.post('/api/steps/submit', {
    data: { commitKey: randomUUID(), input: { methodId: methods[0]?.id, description } },
  });
  expect(res.ok(), `submit: ${await res.text()}`).toBe(true);
  await page.request.post('/api/logout', { data: {} });
}

async function sampleNumberOf(page: Page, testId: string) {
  await signInByApi(page, 'lena.manager');
  const view: RouteReply<typeof routes.test> = await (await page.request.get(`/api/tests/${testId}`)).json();
  await page.request.post('/api/logout', { data: {} });
  return view.test.sampleNumber;
}

const sidewaysScroll = (box: Locator) => box.evaluate((e) => e.scrollWidth - e.clientWidth);

async function atLeast44(control: Locator, what: string) {
  const box = await control.boundingBox();
  expect(box?.height ?? 0, `${what} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0, `${what} is at least 44 px wide`).toBeGreaterThanOrEqual(44);
}

test('a Lab Manager filters the Worklist by Test state, searches by Sample number and opens the Test', async ({
  page,
}) => {
  const tag = `${test.info().project.name} ${randomUUID()}`;
  const inReview = `Metformin HCl 500 mg tablets, lot NW-0051 (fictional, ${tag})`;
  const requested = `Metformin HCl 500 mg tablets, lot NW-0052 (fictional, ${tag})`;
  await page.goto('/');
  const testId = await submittedTest(page, inReview);
  await requestedTest(page, requested);
  const sampleNumber = await sampleNumberOf(page, testId);

  await page.reload();
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('lena.manager');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  const worklist = page.locator('table.stack').first();
  const list = worklist.locator('tbody tr');
  await expect(page.getByRole('row', { name: requested })).toBeVisible();

  const pipeline = page.getByRole('radiogroup', { name: 'Filter by Test state' });
  const chips = pipeline.getByRole('radio');
  const all = pipeline.getByRole('radio', { name: /^All \d+$/ });
  await expect(all, 'the Worklist opens on every state').toBeChecked();
  for (const chip of await chips.all())
    await expect(chip, 'a shown state holds at least one Test').toHaveAccessibleName(/ [1-9]\d*$/);
  for (const label of await pipeline.locator('label').all()) await atLeast44(label, 'a state filter');
  const inReviewChip = pipeline.getByRole('radio', { name: /^Submitted For Review \d+$/ });
  await inReviewChip.check();
  await expect(page.getByRole('row', { name: inReview }), 'the filter keeps a Test in the chosen state').toBeVisible();
  await expect(page.getByRole('row', { name: requested }), 'the filter drops a Test in another state').toHaveCount(0);
  for (const state of await list.locator('td[data-label="State"]').allTextContents())
    expect(state, 'every listed Test is in the chosen state').toBe('Submitted For Review');

  const search = page.getByRole('searchbox', { name: 'Search Tests' });
  await expect(search, 'the search box takes 16 px text, so a phone does not zoom').toHaveCSS('font-size', '16px');
  await atLeast44(search, 'the search box');
  await search.fill(sampleNumber);
  await expect(list).toHaveCount(1);
  await expect(pipeline.locator('label'), 'every state with no matching Test is hidden').toHaveText([
    /^All\s*1$/,
    /^Submitted For Review\s*1$/,
  ]);

  await list.getByRole('link', { name: sampleNumber }).click();
  const record = page.getByRole('heading', { level: 1 });
  await expect(record).toContainText(`${sampleNumber} Submitted For Review`);
  expect(new URL(page.url()).hash).toBe(`#/tests/${testId}/beside`);
  expect(await sidewaysScroll(page.locator('html')), 'the page does not scroll sideways').toBe(0);

  const desktop = test.info().project.name === 'desktop';
  if (desktop) {
    await expect(list, 'the Worklist stays beside the Test').toHaveCount(1);
    await expect(worklist.getByRole('columnheader')).toHaveText(['Sample', 'State', 'Received']);
    const split = await page.locator('.split').boundingBox();
    const opened = await page.locator('.split__record').boundingBox();
    const share = (opened?.width ?? 0) / (split?.width ?? Infinity);
    expect(share, 'the Test takes about 60% of the width').toBeGreaterThan(0.55);
    expect(share, 'the Test takes about 60% of the width').toBeLessThan(0.65);

    await all.check();
    await search.fill(tag);
    await list.filter({ hasNotText: sampleNumber }).getByRole('link').click();
    await expect(record, 'choosing another Test beside the list shows that Test').toContainText('Requested');
    await expect(record).not.toContainText(sampleNumber);
    await expect(list, 'the Worklist keeps both Tests beside the one open').toHaveCount(2);
    await search.fill(sampleNumber);
  } else {
    await expect(page.getByRole('heading', { name: 'Tests' }), 'on a phone the Test opens full screen').toBeHidden();
    const [opened, plane] = await Promise.all([
      page.locator('.split__record').evaluate((e) => e.clientWidth),
      page.locator('.plane').evaluate((e) => e.clientWidth - 24),
    ]);
    expect(opened, 'on a phone the Test takes the full width inside the margins').toBe(plane);
  }

  const close = page.getByRole('link', { name: 'Close' });
  await atLeast44(close, 'Close');
  await close.click();
  await expect(page.getByRole('heading', { name: 'Tests', level: 1 })).toBeVisible();
  await expect(search, 'Close keeps the search').toHaveValue(sampleNumber);
  await expect(desktop ? all : inReviewChip, 'Close keeps the filter').toBeChecked();

  await page.goto(`/#/tests/${testId}`);
  await expect(record).toContainText(sampleNumber);
  await expect(page.getByRole('heading', { name: 'Tests' }), 'the Test link still opens the Test alone').toHaveCount(0);
});
