import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SESSION_ENDED } from '@lims/domain';
import { expect, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const database = execFileSync(process.execPath, ['../../packages/db/src/checkout.ts', 'database', 'lims_e2e'], {
  encoding: 'utf8',
}).trim();

/**
 * Puts this page's session past the demo idle limit on the server, as nine hours without a request would. A walk has no
 * clock seam into the API, and the session row is working state the Audit Trail does not hold.
 */
async function idleOnTheServer(page: Page) {
  const token = (await page.context().cookies()).find((cookie) => cookie.name === 'lims_session')?.value;
  if (!token) throw new Error('the page holds no session cookie');
  execFileSync(
    '../../scripts/pg.sh',
    ['psql', '-d', database, '-qtA', '-v', `hash=${createHash('sha256').update(token).digest('hex')}`],
    {
      input: `update lims.session set last_seen_at = last_seen_at - interval '9 hours'
               where token_hash = decode(:'hash', 'hex');`,
      encoding: 'utf8',
    },
  );
}

const FULL_COUNT = /^Session ends in (8:00:00|7:59:\d\d)$/;

const answered = (page: Page, status: number) =>
  page.waitForResponse((res) => res.url().endsWith('/api/session') && res.status() === status);

test('the Bench Rail counts down to the idle end, and returns to sign-in only when the server says the session has ended', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByLabel('Username').fill('quinn.qa');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const countdown = page.locator('.rail .who__clock');
  // The walk runs on the demo login, whose idle limit is 8 hours.
  await expect(countdown).toHaveText(/^Session ends in (8:00:00|7:59:5\d)$/);
  await expect(countdown).toBeVisible();

  await page.clock.fastForward('01:00:00');
  await expect(countdown).toHaveText(/^Session ends in 6:59:\d\d$/);
  await page.getByRole('link', { name: 'Equipment' }).click();
  await page.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(countdown, 'a request restarts the idle count').toHaveText(FULL_COUNT);

  const kept = answered(page, 200);
  await page.clock.fastForward('08:00:10');
  await kept;
  await expect(
    countdown,
    'the server still holds the session, so the count restarts from what it says is left',
  ).toHaveText(FULL_COUNT);
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await idleOnTheServer(page);
  const ended = answered(page, 401);
  await page.clock.fastForward('08:00:10');
  await ended;
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(SESSION_ENDED);
});
