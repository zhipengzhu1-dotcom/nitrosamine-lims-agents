import { randomUUID } from 'node:crypto';
import { type RouteReply, routes } from '@lims/domain';
import { expect, type Locator, type Page, signInByApi, testThrough, test } from './walk.ts';
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

async function signIn(page: Page, username: string) {
  await page.reload();
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
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
  const testId = await testThrough(page, inReview, 'enterResult');
  await requestedTest(page, requested);
  const sampleNumber = await sampleNumberOf(page, testId);

  await signIn(page, 'lena.manager');
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

test('beside the Worklist, a step holds the list until its answer and no longer, and its success motion stays with it', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'the Worklist stays beside the Test only on a desktop');
  const tag = randomUUID();
  const firstDescription = `Metformin HCl 500 mg tablets, lot NW-0053 (fictional, ${tag})`;
  const secondDescription = `Metformin HCl 500 mg tablets, lot NW-0054 (fictional, ${tag})`;
  await page.goto('/');
  await requestedTest(page, firstDescription);
  await requestedTest(page, secondDescription);
  await signIn(page, 'samir.custodian');
  await page.getByRole('searchbox', { name: 'Search Tests' }).fill(tag);
  // Beside a Test the list shows no description, so each Test is found by its Sample number.
  const linkOf = async (description: string) => {
    const sampleNumber = await page.getByRole('row', { name: description }).getByRole('link').textContent();
    return page
      .locator('table.stack')
      .first()
      .getByRole('link', { name: sampleNumber ?? '', exact: true });
  };
  const first = await linkOf(firstDescription);
  const second = await linkOf(secondDescription);
  const record = page.getByRole('heading', { level: 1 });

  await first.click();
  await expect(record).toContainText('Requested');
  const firstOpen = page.url();
  const held = Promise.withResolvers<void>();
  await page.route('**/api/steps/receive', async (route) => {
    await held.promise;
    await route.continue();
  });
  const sent = page.waitForRequest('**/api/steps/receive');
  await page.getByRole('button', { name: 'Receive' }).click();
  await sent;
  const other = await second.boundingBox();
  await page.mouse.click((other?.x ?? 0) + (other?.width ?? 0) / 2, (other?.y ?? 0) + (other?.height ?? 0) / 2);
  held.resolve();
  await expect(page.getByRole('status'), 'the rail shows the answer for the Test the step was taken on').toContainText(
    'now Ready',
  );
  expect(page.url(), 'no other Test opens while a step waits for its answer').toBe(firstOpen);

  await second.click();
  await expect(record).toContainText('Requested');
  await first.click();
  await expect(record).toContainText('Ready');
  await expect(
    page.locator('.split__record').locator('.status--fresh, .row--fresh'),
    'returning to a Test plays no success motion for a step it took earlier',
  ).toHaveCount(0);

  await page.unroute('**/api/steps/receive');
  const heldAgain = Promise.withResolvers<void>();
  await page.route('**/api/steps/receive', async (route) => {
    await heldAgain.promise;
    await route.continue();
  });
  await second.click();
  await expect(record).toContainText('Requested');
  const secondSample = (await second.textContent()) ?? '';
  const sentAgain = page.waitForRequest('**/api/steps/receive');
  await page.getByRole('button', { name: 'Receive' }).click();
  await sentAgain;
  await page.goBack();
  await expect(record).not.toContainText(secondSample);
  const answered = page.waitForResponse('**/api/steps/receive');
  heldAgain.resolve();
  await answered;
  await second.click();
  await expect(record, 'once a step left by Back has its answer, the list opens a Test again').toContainText(
    `${secondSample} Ready`,
  );
});
