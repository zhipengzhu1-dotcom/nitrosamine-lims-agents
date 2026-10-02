---
name: verify
description: Launch the Nitrosamine LIMS (React web on Vite, Fastify API, this checkout's Postgres) on a scratch database and drive its web UI in headless Chromium as each demo role (Customer, Sample Custodian, Lab Manager, Analyst, Reviewer, QA), capturing screenshots, a Playwright trace and the database rows and Audit Trail entries a step wrote. Use to prove a change to sign-in, the Test chain, Signatures, the Test Report or the Audit Trail works in the running app, not only in the tests.
---

# Verify the LIMS in the running app

The surface is the web UI at `#/tests`, `#/tests/<id>` and `#/tests/<id>/report`. Every write goes through the rail at the bottom of the screen. The API under `/api/*` answers the web; drive it directly only to read. The other nav entries (Equipment, Inventory and the rest) are placeholders.

All helpers live in `.claude/skills/verify/scripts/` and run from the repo root. Postgres must be running for this checkout (`scripts/pg.sh start`, which up.sh also runs).

## Launch

```bash
.claude/skills/verify/scripts/up.sh
```

It installs dependencies if `node_modules` is missing. It then runs `scripts/dev.sh --scratch` with `LIMS_DB=lims_verify`, two free ports and `DEMO_PASSWORD=verify-demo-password`, so the database `lims_verify_<checkout suffix>` is dropped, migrated and seeded fresh. It is ready when it prints `ready: http://localhost:<port> ...`, after `GET /api/me` answers 401 through the web proxy. It exits 1 and prints the end of the log if the stack dies while starting.

`.verify/instance/env` holds the URL, ports, database name, password, the commit the instance started at, and `PGID`, the PID of `dev.sh`. `.verify/instance/server.log` holds the migrate and seed output and the API's request log.

One instance per checkout. up.sh refuses to start a second one; drive the running one, or run down.sh first. Another checkout or worktree gets its own database suffix and its own free ports, so instances in two checkouts do not collide. Do not use `pnpm e2e` for this. It takes this checkout's own ports in 10000-19999 (from `node packages/db/src/checkout.ts e2e-ports`) and owns the `lims_e2e_<suffix>` database.

## Doctor

Run it first, and again whenever a drive fails strangely. It is read-only.

```bash
.claude/skills/verify/scripts/doctor.sh
```

Every line must be `ok:`. It checks that `dev.sh` is alive, that the web port belongs to a process under it, that the API answers through the proxy, and that the database holds the 8 seeded people. Vite reloads the web code as you edit, but the API does not reload. If `apps/api/src`, `packages/*/src` or a migration changed after launch, doctor fails. Run down.sh, then up.sh. A `WARN:` line means HEAD moved since launch.

## Drive

Write a scenario as a `.ts` file that imports `.claude/skills/verify/scripts/drive.ts`, and run it with `node <file>.ts`. Node 24 runs TypeScript as it is. Put throwaway scenarios in `.verify/`, which is ignored. `open(slug)` starts headless Chromium against the instance and a new evidence directory, and returns a proof `v`:

```ts
import { expect, open } from '../.claude/skills/verify/scripts/drive.ts'; // path from .verify/
const v = await open('assign-refusal');
const { page } = v;
try {
  await v.signIn('lena.manager');                       // lands on the Tests worklist
  await page.getByRole('link', { name: 'RD-S-2026-000001', exact: true }).click();
  await page.getByRole('button', { name: 'Assign' }).click();
  await page.getByLabel('Analyst').selectOption({ label: 'Theo Brandt' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await v.railSays('Refused: The assignee must be an Analyst');
  await v.shot('refused');
  v.sql('test', `select state, assignee_id from lims.test`);
} finally {
  await v.close();                                      // always: saves trace.zip
}
```

`v` also has `signOut()`, `sign(meaning, password?)` for the signature sheet, `note(line)` and `password`. `expect` is Playwright's. The page opens at 1360 × 900. `open(slug, 'phone')` opens it as a 390 × 844 touch phone instead.

## Phone width on every UI pull request

A pull request that changes what a screen shows gets a drive at phone width as part of UI review, because some defects show only on a phone. Drive each flow the pull request changes with `open(slug, 'phone')`, and again with `open(slug)` for desktop. Take `v.shot(name, false)` before the commit and after the rail shows the server's answer, plus one for each refusal the pull request adds. `false` keeps the shot to the screen a person sees, with the rail and any sheet in place; a full-page shot unrolls the fixed rail. List the screenshots in the pull request. This drive is emulation; the owner's check on a real device stays a separate step.

To get a Test into a given state, run the chain helper. It takes a new Test through the UI as each role, up to the state you name:

```bash
node .claude/skills/verify/scripts/chain.ts [Requested|Ready|Assigned|SubmittedForReview|Reviewed|Reported]
```

It writes the new Sample number (`RD-S-YYYY-00000n`) to `steps.log` and saves its own evidence. Sample numbers count up within the instance, and the newest one is the Test you just made.

Stable handles, all from the shipped UI (`apps/web/src`):

- Sign in: the fields `Username` and `Password`, and the button `Sign in`. A refusal shows in `role=alert`.
- The worklist has the heading `Tests`. Each Test is a link named by its Sample number, which matches `/^RD-S-\d{4}-\d{6}$/`. The link opens `#/tests/<id>/beside`: at desktop width the Test opens beside the list, which keeps Sample, State and Received and turns its heading into an `h2`; narrower, the Test takes the screen. The link `Close` returns to the list. `#/tests/<id>` still opens the Test alone.
- Above the worklist, the radio group `Filter by Test state` holds `All <n>` and one radio per state with Tests, such as `Submitted For Review 2`, and the search box `Search Tests` matches Sample number, description, Customer and Method. The counts follow the search.
- On a Test page, the `h1` holds the Sample number and the state in words, such as `Submitted For Review`. On a phone it sticks to the top of the record as it scrolls.
- At phone width the rail folds its session block: one row holds a button with the person's name and `Session ends in`, then `Switch user` and `Lock`. The button (`.rail__toggle`, `aria-expanded`) opens the block, which shows the person's Lab, roles, username and Workstation, the preferences link, `Switch Lab` (on an Unregistered device only) and `Sign out`. `v.signOut()` opens it first.
- The rail's person name is the link `<name>, your preferences` to `#/preferences`, the page `Your preferences` with the box `Reduce motion wherever I sign in` and the button `Save preferences`.
- The rail is `role=contentinfo`. Its status line is `role=status`. It offers only the step the signed-in person may take next, as one button: `Submit`, `Receive`, `Assign`, `Enter Result`, `Review` or `Release`. `Switch user`, `Lock` and `Sign out` are always there (on a phone, `Sign out` inside the session block), and the rail names the Workstation or `Unregistered device`. At phone width an open sheet covers the rail and hides those three buttons until it closes.
- The step form fields are `Method`, `Sample description`, `Analyst`, `Analyte`, `Result as written`, `Unit`, `Injection sequence`, `Notebook reference` and `Performed on`. Use `{ exact: true }` for these labels.
- The signature sheet shows, in order, `What you are signing`, `Meaning` (the signature statement and its version, `Eligibility`, `Record Version` and the full `SHA-256`), then `Who is signing` with the fields matching `/User ID/` and `/Password/`, and the button `Sign as Performed|Reviewed|Released`. `v.sign` types the signed-in person's own user ID.
- When the server accepts a step, the status line reads `<step or Signature> recorded in the Audit Trail. The Test is now <State in words>.`, naming the Signature (`Performed Signature`) for a signing step. When it refuses, the line reads `Refused: <message>.` and adds ` Nothing has been signed.` for a signing step.
- Test Report: the link `/^RD-R-\d{4}-\d{6}$/` on a Reported Test, the heading `Test Report RD-R-YYYY-00000n`.
- Audit Trail panel on a Test page: the region `Audit Trail`, its `listitem`s (one per entry, text starting with the chain and `#<seq>`), the field `Search the trail`, the select `Order`, each entry's `Raw entry <seq>` button and `details.long` values, and the QA-only button `Verify chain` whose answer lands in `.verdict`.

Twenty wrong passwords in a row lock an account for the life of the scratch database. Lock only `ada.admin`, and relaunch to unlock it. Demo accounts, all with the password `verify-demo-password`: `cora.customer`, `samir.custodian`, `lena.manager`, `ana.analyst` (trained on the Method), `theo.untrained` (an Analyst with no Training Record), `rui.reviewer`, `quinn.qa` and `ada.admin`.

The feature recipes are in [features/README.md](features/README.md). Read the matching file before you drive. A proof that drives one entry point is incomplete when the map lists others.

## Evidence

Each `open()` writes `.verify/evidence/<UTC stamp>-<slug>/`, and `close()` prints the path:

- `instance.txt`: the URL, the database, the commit with `-dirty` if apps or packages had changes, and the screen.
- `steps.log`: each action, and every `/api/*` call with its status code.
- `NN-<name>.png`: screenshots, numbered in order: full page, or the screen alone with `v.shot(name, false)`.
- `trace.zip`: the Playwright trace, with DOM snapshots before and after each action. Open it with `pnpm --filter @lims/web exec playwright show-trace <path>`.
- `<name>.tsv`: the output of each `v.sql()` query.

Proof standards:

- Drive the real path: sign in as the role that takes the step, and press the rail's buttons. Do not call `/api/steps/*` with curl, and do not write rows with psql. A write that skips `audited()` produces no Audit Trail and proves nothing.
- Capture the action and the result. Take a screenshot before the commit and after the rail reports the server's answer, not only the final screen.
- Check side effects in the database as well as on screen. For a step, that is the `lims.test.state`, the `lims.signature` row with its meaning, and the `lims.audit_entry` rows naming the actor, role and step as `reason`. `chain.ts` shows the queries.
- For a refusal, prove that nothing changed: the state stayed the same and no Signature was added. A refused step adds no Audit Trail entry, but every wrong password, at sign-in or on a signature sheet, adds a `person` entry with reason `Failed authentication`.
- `v.sql()` connects as the postgres superuser. Use it only for `select`.

## Cleanup

```bash
.claude/skills/verify/scripts/down.sh
```

It stops the process tree under `dev.sh`: the API, pnpm and vite. Vite has a process group of its own, so the script collects the tree by PID and never kills by process name. It then drops `lims_verify_<suffix>` and removes `.verify/instance/`. It does not touch `.verify/evidence/` or the checkout's Postgres cluster, which other runs and the tests share. Run it after every failed attempt too, so no instance is left behind.

## Helpers

| Script | Run | Does |
| --- | --- | --- |
| `scripts/up.sh` | `.claude/skills/verify/scripts/up.sh` | Starts the instance and waits until it is ready |
| `scripts/doctor.sh` | `.claude/skills/verify/scripts/doctor.sh` | Read-only health check |
| `scripts/drive.ts` | `import { open, expect } from '.../drive.ts'` | Browser, sign-in, signing, screenshots, SQL and evidence |
| `scripts/chain.ts` | `node .claude/skills/verify/scripts/chain.ts <State>` | Makes a new Test and takes it to `<State>` through the UI |
| `scripts/down.sh` | `.claude/skills/verify/scripts/down.sh` | Stops the instance and drops its database, and keeps the evidence |
