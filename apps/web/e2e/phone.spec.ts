import { randomUUID } from 'node:crypto';
import {
  expect,
  type Locator,
  openSessionBlock,
  PHONE,
  type Page,
  signOutFromRail,
  submittedTest,
  test,
} from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const sidewaysScroll = (box: Locator) => box.evaluate((e) => e.scrollWidth - e.clientWidth);
const height = (box: Locator) => box.evaluate((e: HTMLElement) => e.offsetHeight);
/** The most of an upright phone's height the Bench Rail may take with no sheet open and a context line of up to two lines, as #220 decided. */
const RAIL_SHARE = 0.22;

test.use({ viewport: PHONE });
// oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'iphone' && info.project.name !== 'pixel', 'a phone-width walk');
});

async function signInAsCustomer(page: Page) {
  await signIn(page, 'cora.customer');
}

async function signIn(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

test('the Submit sheet and its long Method name fit a 390 px phone with no sideways scroll', async ({ page }) => {
  await signInAsCustomer(page);
  await page.getByRole('button', { name: 'Submit' }).click();
  const sheet = page.locator('form.sheet');
  const method = sheet.locator('select');
  await method.selectOption({ index: 1 });
  await expect(method.locator('option:checked'), 'the full Method name stays in the option').toHaveText(
    /^RD-MTH-\d{4} v\d+ .{30,}/,
  );

  expect(await sidewaysScroll(sheet), 'the sheet does not scroll sideways').toBe(0);
  expect(await sidewaysScroll(page.locator('html')), 'the page does not scroll sideways').toBe(0);
  for (const part of [sheet.locator('h2'), method, sheet.getByRole('button', { name: 'Cancel' })]) {
    const box = await part.boundingBox();
    expect(box?.x, 'starts inside the screen').toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity), 'ends inside the screen').toBeLessThanOrEqual(PHONE.width);
  }
});

test('an open sheet hides the session buttons and the preferences link, and Cancel brings them back', async ({
  page,
}) => {
  await signInAsCustomer(page);
  const session = page.locator('.rail__toggle');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  const preferences = page.getByRole('link', { name: /your preferences/ });
  await openSessionBlock(page);
  await expect(signOut, 'the rail offers Sign out before a sheet opens').toBeVisible();
  await expect(preferences, 'the rail offers the preferences link before a sheet opens').toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('form.sheet')).toBeVisible();
  await expect(signOut, 'the open sheet hides Sign out').toBeHidden();
  await expect(session, 'the open sheet hides the session block button').toBeHidden();
  await expect(preferences, 'the open sheet hides the preferences link it covers').toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(signOut, 'Sign out is back once the sheet closes').toBeVisible();
  await expect(session, 'the session block button is back once the sheet closes').toBeVisible();
  await expect(preferences, 'the preferences link is back once the sheet closes').toBeVisible();
});

test('a phone held sideways hides the top bar under an open sheet, and Cancel brings it back', async ({ page }) => {
  await signInAsCustomer(page);
  await page.setViewportSize({ width: 844, height: 390 });
  const tabs = page.locator('header.top nav');
  const preferences = page.getByRole('link', { name: /your preferences/ });
  await expect(tabs, 'the top bar shows its tabs before a sheet opens').toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('form.sheet')).toBeVisible();
  await expect(tabs, 'the open sheet hides the tabs it covers').toBeHidden();
  await expect(preferences, 'the open sheet hides the preferences link it covers').toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(tabs, 'the tabs are back once the sheet closes').toBeVisible();
  await expect(preferences, 'the preferences link is back once the sheet closes').toBeVisible();
});

test('an upright phone with its keyboard up keeps the top bar above an open sheet', async ({ page }) => {
  await signInAsCustomer(page);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('form.sheet')).toBeVisible();
  // An Android keyboard shrinks the layout viewport (index.html asks for resizes-content).
  await page.setViewportSize({ width: 360, height: 480 });
  const stays = await page
    .locator('header.top')
    .evaluate((bar) => getComputedStyle(bar).visibility === 'visible' && bar.getAnimations().length === 0);
  expect(stays, 'the top bar is neither hidden nor about to hide').toBe(true);
});

async function railWithinShare(page: Page, where: string) {
  const share = (await height(page.locator('footer.rail'))) / PHONE.height;
  expect(share, `the rail on ${where} takes at most ${RAIL_SHARE * 100}% of the phone`).toBeLessThanOrEqual(RAIL_SHARE);
}

async function laidOutAtLeast(control: Locator, minHeight: number) {
  const [width, tall] = await control.evaluate((e: HTMLElement) => [e.offsetWidth, e.offsetHeight]);
  expect(width, 'touch target width').toBeGreaterThanOrEqual(44);
  expect(tall, 'touch target height').toBeGreaterThanOrEqual(minHeight);
}

test('with no sheet open, the Bench Rail takes at most 22% of the phone and its commit button stays 56 px tall', async ({
  page,
}) => {
  const description = `Valsartan 160 mg tablets (fictional, ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  await submittedTest(page, description);
  await signInAsCustomer(page);
  await laidOutAtLeast(page.getByRole('button', { name: 'Submit' }), 56);
  await railWithinShare(page, 'the Worklist, with the Submit commit button');
  await page.getByRole('row', { name: description }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible();
  await railWithinShare(page, "the Customer's Test");
  await signOutFromRail(page);

  await signIn(page, 'rui.reviewer');
  await page.getByRole('row', { name: description }).getByRole('link').click();
  const review = page.getByRole('button', { name: 'Review', exact: true });
  const context = page.locator('.rail__context');
  await expect(context, 'the context line names the Test').toContainText('Test of');
  const [lineBox, lineHeight] = await context.evaluate((e: HTMLElement) => [
    e.offsetHeight,
    Number(getComputedStyle(e.querySelector('p') ?? e).lineHeight.replace('px', '')),
  ]);
  expect(lineBox, 'the context line wraps to two lines').toBeGreaterThan(lineHeight * 1.5);
  await laidOutAtLeast(review, 56);
  await railWithinShare(page, "the Reviewer's Test, with a two-line context line and the Review commit button");
});

test('on the narrowest phone the folded rail shows the whole session countdown and the session block mark beside Switch user and Lock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signInAsCustomer(page);
  const clock = page.locator('.rail__toggle .who__clock');
  await expect(clock).toContainText(/Session ends in \d/);
  const [clipped, shortened, mark, toggleRight, switchLeft] = await page
    .locator('.rail__toggle')
    .evaluate((toggle: HTMLElement) => {
      const countdown = toggle.querySelector<HTMLElement>('.who__clock') ?? toggle;
      const chevron = toggle.querySelector<HTMLElement>('.rail__chevron');
      const name = toggle.querySelector<HTMLElement>('b') ?? toggle;
      const switchUser = [...document.querySelectorAll<HTMLElement>('.rail__session .rbtn')].find(
        (b) => b.textContent === 'Switch user',
      );
      const box = chevron?.getBoundingClientRect();
      return [
        countdown.scrollWidth > countdown.clientWidth || toggle.scrollWidth > toggle.clientWidth,
        name.scrollWidth > name.clientWidth,
        box ? { width: box.width, right: box.right } : { width: 0, right: Infinity },
        toggle.getBoundingClientRect().right,
        switchUser?.getBoundingClientRect().left ?? 0,
      ];
    });
  expect(clipped, 'the countdown fits inside the session block button').toBe(false);
  expect(toggleRight, 'the session block button ends before Switch user begins').toBeLessThanOrEqual(switchLeft);
  expect(shortened, 'the name is too long for the button, so the walk sees it shortened').toBe(true);
  expect(mark.width, 'the mark that the name opens the session block is drawn').toBeGreaterThan(0);
  expect(mark.right, 'a shortened name keeps the mark inside the button').toBeLessThanOrEqual(toggleRight);
  for (const name of ['Switch user', 'Lock']) await laidOutAtLeast(page.getByRole('button', { name, exact: true }), 44);
});

test('the phone rail keeps Switch user and Lock in one tap and Sign out in the session block', async ({ page }) => {
  await signInAsCustomer(page);
  const session = page.getByRole('button', { name: 'Cora Lindqvist, your session', exact: true });
  await expect(
    session,
    'the session block button tells the time left without it being its name',
  ).toHaveAccessibleDescription(/^Session ends in \d/);
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await laidOutAtLeast(session, 44);
  for (const name of ['Switch user', 'Lock']) await laidOutAtLeast(page.getByRole('button', { name, exact: true }), 44);
  await expect(session).toHaveAttribute('aria-expanded', 'false');
  await expect(signOut, 'Sign out folds into the closed session block').toBeHidden();
  await session.click();
  await expect(session).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('footer.rail').getByText(/^RD · Customer · cora\.customer$/)).toBeVisible();
  await laidOutAtLeast(signOut, 44);
  await session.click();
  await expect(signOut, 'closing the session block folds Sign out away again').toBeHidden();
  await railWithinShare(page, 'the Worklist, once the session block closes');
  await session.click();
  await signOut.click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
