import { randomUUID } from 'node:crypto';
import { type RouteReply, routes } from '@lims/domain';
import { DESKTOP, expect, PHONE, type Page, signInByApi, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

async function credentials(page: Page, lab: RegExp, password = DEMO_PASSWORD) {
  await page.getByRole('radio', { name: lab }).check();
  await page.getByLabel('Username').fill('lena.manager');
  await page.getByLabel('Password').fill(password);
}

test('the sign-in screen offers each Lab with none selected, and the rail switches Lab only after the credentials', async ({
  page,
}) => {
  await page.goto('/');
  const choice = page.getByRole('group', { name: 'Lab' }).getByRole('radio');
  await expect(choice).toHaveCount(2);
  for (const radio of await choice.all()) await expect(radio).not.toBeChecked();
  for (const option of await page.locator('.labs__option').all()) {
    const box = await option.boundingBox();
    expect(box?.height ?? 0, 'a Lab option is a 44 px touch target').toBeGreaterThanOrEqual(44);
  }

  await credentials(page, /R&D Laboratory/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  const rail = page.getByRole('contentinfo');
  await expect(rail).toContainText('RD · Lab Manager');

  await rail.getByRole('button', { name: 'Switch Lab' }).click();
  const form = page.locator('form.signin');
  await expect(form.getByRole('heading', { name: 'Switch Lab' })).toBeVisible();
  await expect(form.getByRole('radio')).toHaveCount(1);
  await expect(form.getByRole('radio', { name: /QC Laboratory/ })).not.toBeChecked();

  await credentials(page, /QC Laboratory/, 'not-the-password');
  await form.getByRole('button', { name: 'Switch Lab' }).click();
  await expect(form.getByRole('alert')).toHaveText('the user ID or password is not valid');
  await expect(rail, 'a refused switch leaves the session in its Lab').toContainText('RD · Lab Manager');

  await credentials(page, /QC Laboratory/);
  await form.getByRole('button', { name: 'Switch Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(rail).toContainText('QC · Lab Manager');
  await expect(page.getByRole('banner')).toContainText('QC');

  await page.reload();
  await expect(rail, 'the switch is held by the server, not the page').toContainText('QC · Lab Manager');
});

/** Registers a new R&D Workstation as the Admin and enrols this browser as it, so the browser offers only R&D. Leaves the page signed out. */
async function enrolThisBrowserInRD(page: Page) {
  await signInByApi(page, 'ada.admin');
  const { rooms }: RouteReply<typeof routes.workstations> = await (await page.request.get('/api/workstations')).json();
  const registered = await page.request.post('/api/workstations', {
    data: {
      name: `RD-BENCH-${test.info().project.name}-${randomUUID().slice(0, 8)}`,
      roomId: rooms[0]?.id,
      browserPolicy: 'Managed Chrome; no saved passwords',
      reason: 'New bench PC for the Switch Lab walk',
    },
  });
  expect(registered.ok(), `register a Workstation: ${await registered.text()}`).toBe(true);
  const workstation: RouteReply<typeof routes.registerWorkstation> = await registered.json();
  const enrolled = await page.request.post('/api/workstations/enrol', {
    data: { workstationId: workstation.id, reason: 'Enrol the bench PC browser' },
  });
  expect(enrolled.ok(), `enrol this browser: ${await enrolled.text()}`).toBe(true);
  await page.request.post('/api/logout', { data: {} });
}

test('on a browser enrolled in one Lab, Switch Lab gives its reason beside the disabled button, as the button’s description', async ({
  page,
}) => {
  await page.goto('/');
  await enrolThisBrowserInRD(page);
  await page.reload();
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('ana.analyst');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await page.goto('/#/switch-lab');
  const form = page.locator('form.signin');
  await expect(form.getByRole('heading', { name: 'Switch Lab' })).toBeVisible();
  await expect(form.getByRole('group', { name: 'Lab' }), 'no empty Lab choice').toHaveCount(0);
  const reason = form.getByText('There is no other Lab to work in.');
  const button = form.getByRole('button', { name: 'Switch Lab' });
  await expect(reason).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription('There is no other Lab to work in.');
  for (const size of [page.viewportSize() ?? DESKTOP, PHONE, DESKTOP]) {
    await page.setViewportSize(size);
    const [said, row] = [await reason.boundingBox(), await button.boundingBox()];
    if (!said || !row) throw new Error('the reason or the button is not on screen');
    const gap = Math.max(row.y - (said.y + said.height), said.y - (row.y + row.height), 0);
    expect(gap, `the reason sits within 16 px of the button at ${size.width}x${size.height}`).toBeLessThanOrEqual(16);
  }
});
