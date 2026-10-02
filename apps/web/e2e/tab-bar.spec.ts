import { DESKTOP, expect, type Locator, PHONE, type Page, signInByApi, TABLET, test, type Viewport } from './walk.ts';

type Position = 'start' | 'middle' | 'end';
/** Which edges fade with the bar scrolled to each position: the edges that more tabs lie beyond. */
const FADED_AT = { start: 'right', middle: 'both', end: 'left' } as const;

async function tabBar(page: Page, viewport: Viewport) {
  await page.setViewportSize(viewport);
  await signInByApi(page, 'cora.customer');
  await page.goto('/#/tests');
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  return page.locator('.top nav');
}

/** Which edges of the tab bar fade, and the room between the last tab and the right fade. */
const fadeOf = (nav: Locator) =>
  nav.evaluate((n) => {
    const fade = (side: '::before' | '::after') => {
      const style = getComputedStyle(n, side);
      return Number(style.opacity) > 0 ? Number(style.width.replace('px', '')) : 0;
    };
    const [left, right] = [fade('::before'), fade('::after')];
    const last = n.querySelector('a:last-of-type')?.getBoundingClientRect().right ?? Infinity;
    return {
      overflows: n.scrollWidth > n.clientWidth,
      faded: left && right ? 'both' : left ? 'left' : right ? 'right' : 'none',
      room: n.getBoundingClientRect().right - right - last,
    };
  });

async function scrollTabs(nav: Locator, at: Position) {
  await nav.evaluate((n, where) => {
    const range = n.scrollWidth - n.clientWidth;
    n.scrollTo({ left: { start: 0, middle: range / 2, end: range }[where] });
  }, at);
  await expect
    .poll(async () => (await fadeOf(nav)).faded, `the bar scrolled to its ${at} fades where more tabs lie beyond`)
    .toBe(FADED_AT[at]);
}

async function expectNoFade(nav: Locator, why: string) {
  await expect
    .poll(async () => {
      const { overflows, faded } = await fadeOf(nav);
      return { overflows, faded };
    }, why)
    .toEqual({ overflows: false, faded: 'none' });
}

async function expectTouchTargets(nav: Locator) {
  for (const tab of await nav.getByRole('link').all()) {
    const box = await tab.boundingBox();
    expect(box?.height, 'each tab is at least 44 px tall').toBeGreaterThanOrEqual(44);
    expect(box?.width, 'each tab is at least 44 px wide').toBeGreaterThanOrEqual(44);
  }
}

async function expectFadeWhereMoreTabsLie(nav: Locator) {
  expect((await fadeOf(nav)).overflows, 'the bar overflows').toBe(true);
  for (const at of ['start', 'middle', 'end'] as const) await scrollTabs(nav, at);
  // Scroll offsets are whole pixels and tab widths are not, so the last tab may end up to a pixel past the edge.
  expect((await fadeOf(nav)).room, 'the last tab ends before the fade').toBeGreaterThan(-1);
}

test.describe('at phone width', () => {
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'iphone' && info.project.name !== 'pixel', 'a phone-width walk');
  });

  test('the tabs are 44 px touch targets, the bar fades where more tabs lie beyond, and the last tab scrolls clear of the fade', async ({
    page,
  }) => {
    const nav = await tabBar(page, PHONE);
    await expectTouchTargets(nav);
    await expectFadeWhereMoreTabsLie(nav);

    await page.setViewportSize(DESKTOP);
    await expectNoFade(nav, 'a desktop tab bar that fits does not fade after a resize from a phone');
  });
});

test.describe('at tablet width', () => {
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
  test.beforeEach(({}, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Safari has no scroll-state container query, so only Chromium fades a tablet bar (agent default on #219)',
    );
  });

  test('a tablet bar that overflows fades where more tabs lie beyond, and the last tab scrolls clear of the fade', async ({
    page,
  }) => {
    const nav = await tabBar(page, TABLET);
    await expectTouchTargets(nav);
    await expectFadeWhereMoreTabsLie(nav);
  });

  test('a bar that fits fades no tab, on load and after a resize from overflowing', async ({ page }) => {
    const nav = await tabBar(page, DESKTOP);
    await expectNoFade(nav, 'a desktop bar that fits on load does not fade');
    await expectTouchTargets(nav);

    for (const at of ['start', 'middle', 'end'] as const) {
      await page.setViewportSize(TABLET);
      await scrollTabs(nav, at);
      await page.setViewportSize(DESKTOP);
      await expectNoFade(nav, `a bar resized to fit from its ${at} fades no tab`);
    }
  });
});

test.describe('on an iPad', () => {
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'ipad', 'an iPad walk');
  });

  test('the tabs are 44 px touch targets, and a bar resized to fit fades no tab', async ({ page }) => {
    const nav = await tabBar(page, page.viewportSize() ?? TABLET);
    await expectTouchTargets(nav);
    await nav.evaluate((n) => n.scrollTo({ left: n.scrollWidth }));
    await page.setViewportSize(DESKTOP);
    await expectNoFade(nav, 'a bar resized to fit fades no tab');
  });
});
