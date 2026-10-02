import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const RD = /R&D Laboratory/;
const PRESSED = 'matrix(0.97, 0, 0, 0.97, 0, 0)';

async function signIn(page: Page, username: string, button = 'Sign in') {
  await page.getByRole('radio', { name: RD }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: button }).click();
}

async function switchUser(page: Page, username: string, name: string) {
  await page.getByRole('button', { name: 'Switch user' }).click();
  await expect(page.getByRole('heading', { name: 'Switch user' })).toBeVisible();
  await signIn(page, username, 'Sign in on this screen');
  await expect(page.locator('.rail')).toContainText(name);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);

/**
 * How a press on Save preferences looks once its feedback has settled: scaled under full motion, unmoved under reduced
 * motion. The press is released on the button, as a person would, so it saves the unchanged setting, which writes nothing.
 */
async function pressedTransform(page: Page): Promise<string> {
  const save = page.getByRole('button', { name: 'Save preferences' });
  const look = () => save.evaluate((b) => getComputedStyle(b).transform);
  const steady = async () => {
    let before = '';
    await expect
      .poll(
        async () => {
          const now = await look();
          const same = now === before;
          before = now;
          return same;
        },
        { intervals: [100] },
      )
      .toBe(true);
    return before;
  };
  await expect(save).toBeEnabled();
  await steady();
  const box = await save.boundingBox();
  if (!box) throw new Error('Save preferences is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => save.evaluate((b) => b.matches(':active')), 'the press is held').toBe(true);
  const transform = await steady();
  await page.mouse.up();
  await expect(save, 'the save of the unchanged setting is answered').toBeEnabled();
  return transform;
}

async function openPreferences(page: Page, name: string) {
  await page.getByRole('link', { name: `${name}, your preferences` }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
}

async function setReducedMotion(page: Page, on: boolean) {
  const box = page.getByLabel('Reduce motion wherever I sign in');
  await box.setChecked(on);
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(
    page.getByText(on ? 'Motion is reduced wherever you sign in' : 'Motion follows each device'),
  ).toBeVisible();
  await expect(box, 'the saved setting stays shown after the save').toBeChecked({ checked: on });
}

test('on a shared bench workstation the reduced-motion preference follows each person through Switch user, without a reload', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'the shared bench workstation');
  // The stored preference is shared server state: only Theo, whom no other walk signs in as, ever turns it on.
  await page.goto('/');
  await signIn(page, 'theo.untrained');
  await openPreferences(page, 'Theo Brandt');
  await setReducedMotion(page, true);
  expect(await pressedTransform(page), 'Theo, with the preference on, sees no movement').toBe('none');
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));

  await switchUser(page, 'ana.analyst', 'Ana Ferreira');
  await expect(page.getByLabel('Reduce motion wherever I sign in')).not.toBeChecked();
  expect(await pressedTransform(page), 'Ana, with it off on a full-motion device, gets full motion').toBe(PRESSED);

  await switchUser(page, 'theo.untrained', 'Theo Brandt');
  await expect(page.getByLabel('Reduce motion wherever I sign in')).toBeChecked();
  expect(await pressedTransform(page), 'switching back to Theo reduces motion again').toBe('none');
  expect(await page.evaluate(() => 'sameDocument' in window), 'no reload happened').toBe(true);

  await setReducedMotion(page, false);
  expect(await pressedTransform(page)).toBe(PRESSED);
});

test('a device set to reduce motion keeps motion reduced for a person whose preference is off', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'rui.reviewer');
  await openPreferences(page, 'Rui Tanaka');
  await expect(page.getByLabel('Reduce motion wherever I sign in')).not.toBeChecked();
  expect(await pressedTransform(page), 'full motion while the device asks for it').toBe(PRESSED);
  const hit = await page
    .locator('label.check', { has: page.getByLabel('Reduce motion wherever I sign in') })
    .boundingBox();
  test.info().annotations.push({ type: 'checkbox hit area', description: `${hit?.width} x ${hit?.height} px` });
  expect(hit?.width, 'the label row that toggles the checkbox is wide enough for a gloved hand').toBeGreaterThanOrEqual(
    44,
  );
  expect(hit?.height, 'and tall enough').toBeGreaterThanOrEqual(44);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A page hears of a media change in its next rendering step.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
  expect(await pressedTransform(page), 'the device setting holds when the preference is off').toBe('none');
});

test('on a phone a stacked table keeps its table, row and cell roles', async ({ page }) => {
  test.skip(!['iphone', 'pixel'].includes(test.info().project.name), 'tables stack on a phone');
  const description = `Metformin HCl tablets (fictional, roles ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  await signIn(page, 'cora.customer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill(description);
  await page.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');

  const table = page.locator('table.stack');
  expect(await table.evaluate((t) => getComputedStyle(t).display), 'the table is stacked').toBe('block');
  await expect(table).toHaveAttribute('role', 'table');
  await expect(table.locator('tbody tr').first()).toHaveAttribute('role', 'row');
  await expect(table.locator('tbody td').first()).toHaveAttribute('role', 'cell');
  const row = page.getByRole('table').getByRole('row', { name: description });
  await expect(row.getByRole('cell', { name: description })).toBeVisible();
  await expect(page.getByRole('table').getByRole('columnheader', { name: 'Sample' })).toBeAttached();
});

test('on a phone a closing signature sheet leaves the accessibility tree, and the record keeps a sticky heading with its Status', async ({
  page,
}) => {
  test.skip(!['iphone', 'pixel'].includes(test.info().project.name), 'the phone layout');
  const description = `Metformin HCl tablets (fictional, sheet ${test.info().project.name} ${randomUUID()})`;
  const openTheTest = () => page.getByRole('row', { name: description }).getByRole('link').click();
  await page.goto('/');
  await signIn(page, 'cora.customer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill(description);
  await page.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');
  await signOut(page);
  await signIn(page, 'samir.custodian');
  await openTheTest();
  await page.getByRole('button', { name: 'Receive' }).click();
  await railSays(page, 'now Ready');
  await signOut(page);
  await signIn(page, 'lena.manager');
  await openTheTest();
  await page.getByRole('button', { name: 'Assign' }).click();
  await page.getByLabel('Analyst').selectOption({ label: 'Ana Ferreira' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await railSays(page, 'now Assigned');
  await signOut(page);
  await signIn(page, 'ana.analyst');
  await openTheTest();

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading.locator('.status'), 'the heading shows the Status').toContainText('Assigned');
  await page.locator('.plane').evaluate((plane) => plane.scrollTo(0, plane.scrollHeight));
  expect(await page.locator('.plane').evaluate((plane) => plane.scrollTop), 'the record scrolls').toBeGreaterThan(0);
  await expect(heading, 'the heading stays on screen').toBeInViewport();
  const [planeTop, headingTop] = await Promise.all([
    page.locator('.plane').evaluate((p) => p.getBoundingClientRect().top),
    heading.evaluate((h) => h.getBoundingClientRect().top),
  ]);
  expect(Math.abs(headingTop - planeTop), 'the heading sticks to the top of the record').toBeLessThan(1);

  await page.getByRole('button', { name: 'Enter Result' }).click();
  const signing = page.getByRole('form', { name: /Sign Performed/ });
  await expect(signing).toBeVisible();
  const closing = page.locator('form.sheet[data-closing]');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(closing, 'the sheet is closing').toBeAttached();
  const exposed = {
    form: await signing.count(),
    heading: await page.getByRole('heading', { name: /Sign Performed/ }).count(),
    field: await page.getByRole('textbox', { name: 'Analyte' }).count(),
  };
  expect(await closing.count(), 'read while the sheet was still closing').toBe(1);
  expect(exposed, 'nothing of the closing sheet is in the accessibility tree').toEqual({
    form: 0,
    heading: 0,
    field: 0,
  });
  await expect(closing).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion');
  const entry = await page.evaluate(async () => {
    const press = document.querySelector<HTMLButtonElement>('.rail button.rbtn--commit');
    press?.click();
    const transforms: string[] = [];
    const started = performance.now();
    while (performance.now() - started < 500) {
      const sheet = document.querySelector('form.sheet');
      if (sheet) transforms.push(getComputedStyle(sheet).transform);
      await new Promise((next) => {
        requestAnimationFrame(next);
      });
    }
    const sheet = document.querySelector('form.sheet');
    const style = sheet && getComputedStyle(sheet);
    return {
      framesSeen: transforms.length > 0,
      moved: transforms.filter((t) => t !== 'none'),
      property: style?.transitionProperty,
      seconds: Number(style?.transitionDuration.replace(/s$/, '') ?? Number.NaN),
      opacity: style?.opacity,
    };
  });
  expect(entry.framesSeen, 'the sheet opened').toBe(true);
  expect(entry.moved, 'with motion reduced the sheet never moves').toEqual([]);
  expect(entry.property, 'only its opacity is animated').toBe('opacity');
  expect(entry.seconds, 'the fade is short').toBeLessThanOrEqual(0.15);
  expect(entry.opacity, 'and it settles fully opaque').toBe('1');
});

test('the rail with nothing on its second line renders no empty second line', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'rui.reviewer');
  await openPreferences(page, 'Rui Tanaka');
  const line = page.locator('.rail__context');
  await expect(line).toHaveText('Nothing for you to commit here.');
  const [height, lineHeight] = await line.evaluate((el) => {
    const p = el.querySelector('p') ?? el;
    return [el.getBoundingClientRect().height, Number(getComputedStyle(p).lineHeight.replace('px', ''))];
  });
  expect(height, 'one line tall').toBeLessThan(lineHeight * 1.5);
});

test('every font family the stylesheet names is loaded by the app or is a system font', async ({ page }) => {
  await page.goto('/');
  const named = await page.evaluate(() => {
    const families: string[] = [];
    const faces: string[] = [];
    const namesOf = (style: CSSStyleDeclaration, property: string) =>
      style
        .getPropertyValue(property)
        .split(',')
        .map((f) => f.trim().replaceAll('"', ''));
    const pending: CSSRule[] = [];
    for (const sheet of document.styleSheets) pending.push(...sheet.cssRules);
    for (let rule = pending.pop(); rule; rule = pending.pop()) {
      if (rule instanceof CSSFontFaceRule) faces.push(...namesOf(rule.style, 'font-family'));
      if (rule instanceof CSSStyleRule)
        for (const property of ['font-family', '--font', '--mono']) families.push(...namesOf(rule.style, property));
      if (rule instanceof CSSStyleRule || rule instanceof CSSGroupingRule) pending.push(...rule.cssRules);
    }
    return { families, faces };
  });
  const system = new Set(['Segoe UI', 'system-ui', 'sans-serif', 'Consolas', 'ui-monospace', 'Menlo', 'monospace']);
  expect(named.families.filter(Boolean).length, 'the stylesheet names its fonts').toBeGreaterThan(0);
  const unloaded = named.families.filter(
    (f) => f && !f.startsWith('var(') && !named.faces.includes(f) && !system.has(f),
  );
  expect(unloaded).toEqual([]);
});
