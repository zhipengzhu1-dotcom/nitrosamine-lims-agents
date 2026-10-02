import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import jsQR from 'jsqr';
import { DECIDED_DATABASE, DECIDED_URL, DEMO_PASSWORD, E2E_DATABASE, SHOTS } from '../playwright.config.ts';
import { expect, type Page, test } from './walk.ts';

test.use({ baseURL: DECIDED_URL });

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The RFC 6238 code an authenticator app shows for this key at a 30-second time step, written apart from the API's. */
function codeAt(key: string, step: number): string {
  const bits = Array.from(key, (c) => BASE32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const secret = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Reads the page's QR code the way a phone camera would: from its pixels, not its markup. */
async function scanQrCode(page: Page): Promise<string | undefined> {
  const size = 400;
  const pixels = await page.locator('svg.qr').evaluate(async (svg, side) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser gave no 2D canvas to draw the QR code on.');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, side, side);
    return Array.from(context.getImageData(0, 0, side, side).data);
  }, size);
  return jsQR(Uint8ClampedArray.from(pixels), size, size)?.data;
}

const enrolling: Record<string, string> = { desktop: 'quinn.qa', iphone: 'rui.reviewer', pixel: 'lena.manager' };

/**
 * The enrolment grant a second Admin issues, written by the database owner in bea.admin's name. Under the decided
 * login no Admin can sign in before an authenticator is enrolled, so the first grants come from outside the LIMS, as
 * a deploy's do; the database still holds the issuer to the second-Admin rule, and the token is never stored.
 */
function grantFromSecondAdmin(username: string): string {
  const token = randomBytes(32).toString('base64url');
  execFileSync(
    '../../scripts/pg.sh',
    [
      'psql',
      '-qX',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      `token=${token}`,
      '-v',
      `username=${username}`,
      '-d',
      DECIDED_DATABASE,
      '-f',
      '-',
    ],
    {
      encoding: 'utf8',
      input: `begin;
        select set_config('lims.actor', 'person:bea.admin', true), set_config('lims.role', 'Admin', true),
               set_config('lims.reason', 'Issue an enrolment grant before any Admin can sign in', true);
        insert into lims.enrolment_grant (person_id, issued_by, token_hash)
        select p.id, admin.id, sha256(convert_to(:'token', 'UTF8'))
          from lims.person p, lims.person admin
         where p.username = :'username' and admin.username = 'bea.admin';
        commit;`,
    },
  );
  return token;
}

/** The 30-second time step at the database clock, the clock the API checks a code against. */
const currentStep = () =>
  Number(
    execFileSync(
      '../../scripts/pg.sh',
      ['psql', '-tAc', 'select floor(extract(epoch from clock_timestamp()) / 30)::bigint', '-d', E2E_DATABASE],
      { encoding: 'utf8' },
    ),
  );

test('a person enrols an authenticator from its QR code on a desktop or its typed key on a phone, then signs in with a code from it', async ({
  page,
}) => {
  const project = test.info().project.name;
  const username = enrolling[project];
  if (!username) throw new Error(`No seeded person is set aside to enrol on the ${project} project.`);
  const shot = async (what: string) => {
    if (SHOTS)
      await page.screenshot({ path: `test-results/shots/authenticator-${project}-${what}.png`, fullPage: true });
  };

  await page.goto('/');
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await shot('01-sign-in-asks-for-a-code');
  await page.getByRole('link', { name: 'Set up your authenticator' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Show my key' }).click();
  await expect(page.getByRole('alert'), 'without an enrolment grant the password alone shows no key').toHaveText(
    'Refused: The user ID, password or code is not valid.',
  );
  await shot('01b-no-grant-refused');

  await page.goto(`/#/authenticator?grant=${grantFromSecondAdmin(username)}`);
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page, 'the grant is taken off the address bar at once').toHaveURL(/#\/authenticator$/);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Show my key' }).click();
  await expect(page.getByRole('heading', { name: 'Add this key to your authenticator' })).toBeVisible();
  await shot('02-key-shown-once');

  const typedKey = (await page.locator('code.secret').textContent())?.replaceAll(' ', '') ?? '';
  expect(typedKey).toMatch(/^[A-Z2-7]{32}$/);
  if (project === 'desktop') {
    const scanned = new URL((await scanQrCode(page)) ?? 'about:blank');
    expect(scanned.protocol, 'the QR code carries an otpauth URI').toBe('otpauth:');
    expect(scanned.searchParams.get('secret'), 'the QR code carries the key shown as text').toBe(typedKey);
  }

  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const signIn = async (code: string) => {
    await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByLabel('Authenticator code').fill(code);
    await page.getByRole('button', { name: 'Sign in' }).click();
  };
  const step = currentStep();
  await signIn(codeAt(typedKey, step - 5));
  await expect(page.getByRole('alert')).toHaveText('The user ID, password or code is not valid.');
  await shot('03-stale-code-refused');
  await signIn(codeAt(typedKey, step));
  await expect(page.locator('footer.rail')).toBeVisible();
  await shot('04-signed-in-with-a-code');
});
