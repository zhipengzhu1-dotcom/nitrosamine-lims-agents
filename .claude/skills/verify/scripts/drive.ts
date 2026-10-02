// Drives the verification instance that up.sh started, as its users do, and files evidence for one proof.
// Import it from a scenario script: `const v = await open('my-proof'); ... await v.close();`
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Playwright is a dependency of @lims/web only, so resolve it from there.
const playwright: typeof import('@playwright/test') = createRequire(`${ROOT}apps/web/package.json`)('@playwright/test');
const { chromium, expect } = playwright;
type Page = import('@playwright/test').Page;

export { expect };

export interface Instance {
  web: string;
  db: string;
  password: string;
  commit: string;
}

/** The instance up.sh wrote to .verify/instance/env; throws when there is none. */
export function instance(): Instance {
  const env = Object.fromEntries(
    readFileSync(`${ROOT}.verify/instance/env`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  return { web: env.WEB, db: env.DB, password: env.PASSWORD, commit: env.COMMIT };
}

export interface Proof {
  page: Page;
  dir: string;
  password: string;
  /** Writes a line to steps.log in the evidence directory and echoes it. */
  note: (line: string) => void;
  /** Saves a full-page screenshot as <nn>-<name>.png. */
  shot: (name: string) => Promise<void>;
  /** Runs a read-only query on the instance database as the postgres superuser and saves its output as <name>.tsv. */
  sql: (name: string, query: string) => string;
  signIn: (username: string, password?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Waits for the rail's status line to show the text the server answered with. */
  railSays: (text: string | RegExp) => Promise<void>;
  /** Fills the signature sheet's password and presses `Sign as <meaning>`. */
  sign: (meaning: 'Performed' | 'Reviewed' | 'Released', password?: string) => Promise<void>;
  /** Saves the Playwright trace and closes the browser. Always call it, also after a failure. */
  close: () => Promise<void>;
}

const psql = (db: string, ...args: string[]) =>
  execFileSync(`${ROOT}scripts/pg.sh`, ['psql', '-d', db, ...args], { encoding: 'utf8' });

/** Opens a headless Chromium on the instance and a fresh evidence directory, .verify/evidence/<UTC>-<slug>/. */
export async function open(slug: string): Promise<Proof> {
  const { web, db, password, commit } = instance();
  const stamp = psql(db, '-tAc', `select to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')`).trim();
  const dir = `${ROOT}.verify/evidence/${stamp}-${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/instance.txt`, `web ${web}\ndatabase ${db}\ncommit ${commit}\n`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: web, viewport: { width: 1360, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  let shots = 0;
  const note = (line: string) => {
    appendFileSync(`${dir}/steps.log`, `${line}\n`);
    console.log(line);
  };
  page.on('response', (r) => {
    if (r.url().includes('/api/')) note(`  ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
  });
  const railSays = (text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
  return {
    page,
    dir,
    password,
    note,
    railSays,
    shot: async (name) => {
      shots += 1;
      await page.screenshot({ path: `${dir}/${String(shots).padStart(2, '0')}-${name}.png`, fullPage: true });
    },
    sql: (name, query) => {
      const out = psql(db, '-AF', '\t', '-P', 'footer=off', '-c', query);
      writeFileSync(`${dir}/${name}.tsv`, out);
      return out;
    },
    signIn: async (username, pw = password) => {
      note(`sign in as ${username}`);
      await page.goto('/');
      await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill(pw);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
    },
    signOut: async () => {
      note('sign out');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    },
    sign: async (meaning, pw = password) => {
      note(`sign as ${meaning}`);
      await page.getByLabel(/Password/).fill(pw);
      await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
    },
    close: async () => {
      await context.tracing.stop({ path: `${dir}/trace.zip` });
      await browser.close();
      console.log(`evidence: ${dir}`);
    },
  };
}
