import { randomUUID } from 'node:crypto';
import { expect, type Page, submittedTest, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1360, height: 900 };

async function openASubmittedTestAsReviewer(page: Page) {
  const description = `Metformin HCl 500 mg tablets, lot NW-0044 (fictional, ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  await submittedTest(page, description);
  await page.reload();
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('rui.reviewer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  const row = page.getByRole('row', { name: description });
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  return row;
}

/** Each visible text node whose computed size is below 12 px, as "text (size)". Text clipped to a 1 px box is for screen readers only. */
const textBelow12px = (page: Page) =>
  page.evaluate(() => {
    const clippedAway = (el: Element) => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const r = at.getBoundingClientRect();
        if ((r.width <= 1 || r.height <= 1) && getComputedStyle(at).overflow !== 'visible') return true;
      }
      return false;
    };
    const small: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent?.trim();
      if (!el || !text || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (clippedAway(el)) continue;
      const size = getComputedStyle(el).fontSize;
      if (Number(size.replace('px', '')) < 12) small.push(`${text} (${size})`);
    }
    return small;
  });

/** Each visible input, select and textarea, with the text of its visible labels and its computed text size. */
const fields = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ]
      .filter((field) => field.checkVisibility())
      .map((field) => ({
        field: field.name || field.outerHTML,
        label: [...(field.labels ?? [])]
          .filter((label) => label.checkVisibility())
          .map((label) =>
            [...label.childNodes]
              .filter((part) => !(part instanceof Element && part.matches('input, select, textarea')))
              .map((part) => part.textContent?.trim() ?? '')
              .join(' ')
              .trim(),
          )
          .join(' '),
        size: getComputedStyle(field).fontSize,
      })),
  );

/** Each element that slashes its zeros but is not an identifier, as "tag.class". */
const slashedOutsideIdentifiers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((el) => getComputedStyle(el).fontVariantNumeric.includes('slashed-zero'))
      .filter((el) => !el.closest('code, .hash'))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  );

test('with the signing sheet open at phone and desktop width, no visible text is below 12 px and every field has a visible label and 16 px text', async ({
  page,
}) => {
  await openASubmittedTestAsReviewer(page);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const sheet = page.locator('form.sheet');
  await expect(sheet.getByRole('heading', { name: 'What you are signing' })).toBeVisible();
  await expect(sheet.locator('h2 .fict'), 'the sheet title carries the fictional-data tag').toHaveText(
    'Fictional data only',
  );
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  for (const size of [PHONE, DESKTOP]) {
    await page.setViewportSize(size);
    const at = `at ${size.width}x${size.height}`;
    expect(await textBelow12px(page), `no visible text below 12 px ${at}`).toEqual([]);
    const shown = await fields(page);
    expect(shown.length, `the sheet shows its credential fields ${at}`).toBeGreaterThan(0);
    for (const { field, label, size: fontSize } of shown) {
      expect(label, `${field} has a visible label ${at}`).not.toBe('');
      expect(fontSize, `${field} keeps 16 px text ${at}`).toBe('16px');
    }
  }
});

test('digits in prose are plain, digits in table cells, values and times line up, and only identifiers slash their zeros', async ({
  page,
}) => {
  const row = await openASubmittedTestAsReviewer(page);
  await expect(page.getByRole('heading', { level: 1 }), 'the Test page heading').toHaveCSS(
    'font-variant-numeric',
    'normal',
  );
  const prose = page.locator('main p');
  await expect(prose.first()).toBeVisible();
  for (const p of await prose.all()) await expect(p, 'a prose paragraph').toHaveCSS('font-variant-numeric', 'normal');

  const performed = page.locator('tr', {
    has: page.locator('td[data-label="Meaning"] .sig', { hasText: 'Performed' }),
  });
  await expect(performed.locator('td[data-label="Time"]'), 'a Signatures time cell').toHaveCSS(
    'font-variant-numeric',
    /tabular-nums/,
  );
  await expect(page.locator('.value'), 'the Result value').toHaveCSS('font-variant-numeric', /tabular-nums/);
  await expect(page.locator('.entry__time').first(), 'an Audit Trail entry time').toHaveCSS(
    'font-variant-numeric',
    /tabular-nums/,
  );
  await expect(page.locator('code.hash').first(), 'a hash').toHaveCSS('font-variant-numeric', /slashed-zero/);
  expect(await slashedOutsideIdentifiers(page), 'only identifiers slash their zeros on the Test page').toEqual([]);

  await page.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toHaveCSS('font-variant-numeric', 'normal');
  await expect(row.locator('td[data-label="Received"]'), 'the Worklist Received cell').toHaveCSS(
    'font-variant-numeric',
    /tabular-nums/,
  );
  expect(await slashedOutsideIdentifiers(page), 'only identifiers slash their zeros on the Worklist').toEqual([]);
});
