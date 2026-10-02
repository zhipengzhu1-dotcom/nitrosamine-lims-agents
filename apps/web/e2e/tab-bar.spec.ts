import {
  DESKTOP,
  expect,
  type Locator,
  PHONE,
  type Page,
  signInByApi,
  TABLET,
  test,
  type ViewportSize,
} from './walk.ts';

type Position = 'start' | 'middle' | 'end';
/** Which edges fade with the bar scrolled to each position: the edges that more tabs lie beyond. At the end no fade is on the right, so the last tab is clear of it. */
const FADED_AT = { start: 'right', middle: 'both', end: 'left' } as const;

async function tabBar(page: Page, viewport: ViewportSize) {
  await page.setViewportSize(viewport);
  await signInByApi(page, 'cora.customer');
  await page.goto('/#/tests');
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  return page.locator('.top nav');
}

/** Whether the tab bar overflows, and which of its edges fade. */
const fadeOf = (nav: Locator) =>
  nav.evaluate((n) => {
    const fade = (side: '::before' | '::after') => {
      const style = getComputedStyle(n, side);
      return Number(style.opacity) > 0 ? Number(style.width.replace('px', '')) : 0;
    };
    const [left, right] = [fade('::before'), fade('::after')];
    return {
      overflows: n.scrollWidth > n.clientWidth,
      faded: left && right ? 'both' : left ? 'left' : right ? 'right' : 'none',
    };
  });

async function expectFadeScrolledTo(nav: Locator, at: Position) {
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

/** The largest difference in any colour channel between two screenshots of one size, decoded in the page. */
const largestDifference = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async (shots) => {
      const decode = async (base64: string) => {
        const png = new Blob([Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0)], { type: 'image/png' });
        const image = await createImageBitmap(png);
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d');
        context?.drawImage(image, 0, 0);
        return context?.getImageData(0, 0, image.width, image.height).data ?? new Uint8ClampedArray();
      };
      const [x = new Uint8ClampedArray(), y = new Uint8ClampedArray()] = await Promise.all(
        shots.map((shot) => decode(shot)),
      );
      return x.reduce((most, v, i) => Math.max(most, Math.abs(v - (y[i] ?? 0))), 0);
    },
    [a.toString('base64'), b.toString('base64')],
  );

async function expectTouchTargets(nav: Locator) {
  for (const tab of await nav.getByRole('link').all()) {
    const box = await tab.boundingBox();
    expect(box?.height, 'each tab is at least 44 px tall').toBeGreaterThanOrEqual(44);
    expect(box?.width, 'each tab is at least 44 px wide').toBeGreaterThanOrEqual(44);
  }
}

async function expectFadeWhereMoreTabsLie(nav: Locator) {
  expect((await fadeOf(nav)).overflows, 'the bar overflows').toBe(true);
  for (const at of ['start', 'middle', 'end'] as const) await expectFadeScrolledTo(nav, at);
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
      'Safari has no scroll-state container query, so only Chromium fades a tablet bar (owner ruling on #219)',
    );
  });

  test('a tablet bar that overflows fades where more tabs lie beyond, and the last tab scrolls clear of the fade', async ({
    page,
  }) => {
    const nav = await tabBar(page, TABLET);
    await expectTouchTargets(nav);
    await expectFadeWhereMoreTabsLie(nav);
  });

  test('a tab reached from the keyboard under the fade shows its label and focus ring unfaded', async ({ page }) => {
    const nav = await tabBar(page, TABLET);
    const tabs = nav.getByRole('link');
    // The fade starts clear, so pick the first tab that reaches past its middle, where hiding would show.
    const veiled = await nav.evaluate((n) => {
      const fade = Number(getComputedStyle(n, '::after').width.replace('px', ''));
      const middle = n.getBoundingClientRect().right - fade / 2;
      return [...n.querySelectorAll('a')].findIndex((a) => a.getBoundingClientRect().right > middle);
    });
    expect(veiled, 'a tab lies past the middle of the right fade').toBeGreaterThan(0);
    await tabs.nth(veiled - 1).focus();
    await page.keyboard.press('Tab');
    const focused = tabs.nth(veiled);
    await expect(focused, 'Tab moves to the tab under the fade').toBeFocused();

    const shot = async () => {
      const box = await focused.boundingBox();
      if (!box) throw new Error('the focused tab has no box');
      return page.screenshot({ clip: { ...box, x: box.x - 4, width: box.width + 8 } });
    };
    const withFade = await shot();
    await page.addStyleTag({ content: '.top nav::before, .top nav::after { opacity: 0 !important; }' });
    // The fade is painted in the bar's own colour, so a tab drawn above it looks as it does with no fade, give or take the gradient's dither.
    expect(
      await largestDifference(page, withFade, await shot()),
      'the focused tab looks as it would with no fade',
    ).toBeLessThanOrEqual(2);
  });

  test('a bar that fits fades no tab, on load and after a resize from overflowing', async ({ page }) => {
    const nav = await tabBar(page, DESKTOP);
    await expectNoFade(nav, 'a desktop bar that fits on load does not fade');
    await expectTouchTargets(nav);

    for (const at of ['start', 'middle', 'end'] as const) {
      await page.setViewportSize(TABLET);
      await expectFadeScrolledTo(nav, at);
      await page.setViewportSize(DESKTOP);
      await expectNoFade(nav, `a bar resized to fit from its ${at} fades no tab`);
    }
  });
});
