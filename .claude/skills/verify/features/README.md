# LIMS verification map

This directory is the maintained source for verifying what the LIMS does for the people who use it. Read the index before you drive the app, then follow the matching feature file as the recipe. The words follow `CONTEXT.md`.

## Baseline preconditions

- Start an instance with `.claude/skills/verify/scripts/up.sh`, and require every line of `doctor.sh` to be `ok:`.
- The database is seeded fresh: one Lab (`RD`) with two Rooms, one Customer, the Method `RD-MTH-0001 v1`, the 8 demo accounts and no Tests.
- Every account signs in with `verify-demo-password`.
- Never drive an instance that this run did not start, such as `pnpm e2e`'s, which takes this checkout's own ports in 10000-19999 (from `node packages/db/src/checkout.ts e2e-ports`) and owns `lims_e2e_<suffix>`, or the owner's `scripts/dev.sh` on 5173.

## Driving conventions

- Drive through a scenario that imports `scripts/drive.ts`. Use `scripts/chain.ts <State>` to make a Test in the state a recipe needs.
- Find elements by ARIA role and accessible name. The handles are in the SKILL.md Drive section.
- Address a Test by its Sample number link (`/^RD-S-\d{4}-\d{6}$/`), never by its position in the worklist, because Tests from earlier drives stay in the instance.
- Sign out between roles. Each role sees only the rail button for the step it may take.

## Proof and skip reporting

- Show the action and the server's answer: a screenshot with the rail status line, plus the `steps.log` line with the `/api/*` status code.
- A mutation also needs a second, read-only view: reload or reopen the page, and run a `v.sql()` query on `lims.test`, `lims.signature` or `lims.audit_entry`.
- A refusal needs proof of absence: the state did not change, and no Signature was added. A refused step adds no Audit Trail entry, but a wrong password adds one with reason `Failed authentication`, so name which kind of refusal you proved.
- Name the feature ID and the entry point next to each artifact you report.
- Report an entry point you could not reach, with what you tried. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the behaviour a user sees, then four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.ts` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Sign in and out](./sign-in.md) covers signing in, the refusal of bad credentials, the session and signing out.
- [Submit a Test request](./submit-test.md) covers a Customer User submitting a Sample for a Method.
- [Take a Test through its steps](./test-steps.md) covers Receive, Assign, Enter Result, Review and Release, with their Signatures and refusals.
- [Test Report](./test-report.md) covers the released report and its three Signatures.
- [Test Audit Trail](./test-audit-trail.md) covers the Audit Trail panel on a Test page, the entries behind it, raw entries, record links and QA's Verify chain.
- [Workstations, Lock and Switch user](./workstations.md) covers registering and enrolling a Workstation, and the rail's Lock and Switch user.

Not mapped yet: the nav modules (Equipment, Inventory, Deviations, Documents, Training, Stability, Notebooks, Dashboards). Each is a placeholder page at `#/<module>` that says what it will hold. Add a feature file when one of them gets behaviour.
