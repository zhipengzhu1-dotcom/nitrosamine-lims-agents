# Coding standards

These rules bind all hand-written code in this repo: TypeScript, SQL migrations, Python, shell and tests. A rule is here only while no tool in `pnpm check` enforces it, and only if an engineer who follows the pstack skills would not already do it. Each rule gives its reason. Process lives in the Notes of the [map](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1), and domain vocabulary lives in `CONTEXT.md`.

The walking skeleton does not meet every rule yet. [Task: bring the walking skeleton into line with the coding standards](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/49) lists what remains. [Task: bring the thin slice into line with the frontend design cycle](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/53) lists what remains of the UI rules.

## The gate decides what is green

- Run `pnpm check` before you push. It runs the Biome format check, oxlint, the typecheck, ruff, shellcheck, and the TypeScript and Python tests. The tests need the local Postgres (`scripts/pg.sh start`), and ruff and shellcheck need `uvx`. The schema drift check joins the gate with item 6 of the task above.
- GitHub Actions runs `pnpm check` on every pull request and on `main`, with the Playwright walk (`pnpm e2e`) as a second job. The repo's plan has no branch protection, so the person who merges checks that both jobs passed.
- Biome formats at 120 columns (`pnpm format`). oxlint with tsgolint lints, and its type-aware rules use a TypeScript 7 checker. It also enforces the import direction between packages. `tsconfig.base.json` sets the compiler's strictness. This document does not repeat what those tools check. Read `.oxlintrc.json`, `biome.json` and `ruff.toml`.
- Keep `main` green. Do not skip or weaken a check to pass the gate. Fix the code, or change the rule as the last section describes.

## A glossary noun means one thing

- In an identifier, use Test, Method, Run, Check, Result and Specification only for the domain concept, because a `test` that sometimes means an automated test makes every reader stop and work out which one it is.
- Write automated tests with `describe` and `it` from `node:test`, so that `test` in code always means the domain Test. The `test/` folders and the `*.test.ts` and `*.spec.ts` suffixes stay, because the tools look for them.
- Name a test helper for what it does (`startApi`), never `testSomething`, because the prefix spends the reserved noun and says nothing.
- Do not call a function a "method" in a name or a comment, and do not use `run` as a bare identifier, because both words belong to the glossary.
- Name files in kebab-case and types in PascalCase, as the slice does, so that a name never depends on who wrote it. Write an enum value as its glossary term without spaces (`SampleCustodian`), so that each value maps back to one glossary entry.
- Read and write camelCase in TypeScript through Kysely's `CamelCasePlugin`, and keep snake_case inside `.sql` files and `sql` fragments, so that no query renames columns by hand. Audit Trail row snapshots keep their stored column names, because they are records of the row.

## Every write and every read goes through a seam

- Write to the database only inside `audited()` (`packages/db/src/db.ts`), because it sets the actor, role and reason that the Audit Trail captures ([thin slice design](design/thin-slice.md)).
- Reach Lab-owned rows only through `labScope` (`apps/api/src/scope.ts`), because it filters every query to the Lab of the `ActorContext` ([ADR 0002](adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md)).
- Authorise each request from its `ActorContext` inside the route, never in framework middleware, because a middleware bypass then skips nothing (ADR 0002).
- Decide who may take a step, and from which state, only in the step registry (`packages/domain/src/steps.ts`). The API and the web both read it, so they cannot disagree (thin slice design).
- Write a Signature only through the one database function that re-authenticates in the same transaction, so that no code path signs without proving who signs. [Decide the spec gaps the walking skeleton found](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/45) decided the function, and the slice does not have it yet.
- Give every exported seam function one doc sentence that states the invariant it guarantees, so that a reader learns the rule at the seam.

## Types say what crosses a boundary

- Turn a type check off (a cast, a non-null `!` or an `any`) only inside a seam module, on a line whose lint-disable comment says why the types cannot express it, so that every escape has a stated reason and a small home. `scope.ts` and `apps/web/src/api.ts` are the two modules that need casts today. The web types a reply as its route's reply without checking it, because the API serializes every reply through that route's schema and the API tests check every reply against it, and a check in the browser would add TypeBox's checker to the bundle.
- Define each shape that crosses HTTP once, as a TypeBox schema in `@lims/domain`. Validate requests with it in the API, and import the derived type in the web and the tests, so that the three cannot drift apart.
- Declare a response schema on every route, so that a column that is not in the schema never leaves the API.

## A refusal is a value, a failure is thrown

- Return a refusal from domain code as a value. Domain code never throws, so that the API and the web can both ask "may this person do this?" without a `try`.
- Turn a refusal into an HTTP error only in the API, and only through `refuse`, so that every status code is chosen in one place.
- Do not swallow an unexpected failure, because a hidden failure on a write path is a lost record. A `catch` adds context and rethrows with `cause`, or it does not exist.
- Write a refusal message as a sentence for the person at the bench, in glossary terms, because the web shows it as written.

## Values keep their digits and time comes from the database

- Never hold a measured value or a limit in a JavaScript `number`. Use a decimal string in TypeScript and `text` or `numeric` in Postgres, because a float loses the digits as typed.
- Do arithmetic on values in one domain module, so that rounding ([ADR 0006](adr/0006-acceptance-criteria-round-the-value-once-to-the-limits-written-decimals.md)) has one implementation. Choose the decimal library when the first calculation is built.
- Take every timestamp that is stored on a row from the database clock, never from `new Date()` or `Date.now()`, because the API host's clock is not the record's clock.
- Send a time over HTTP as an ISO 8601 UTC string, and format it for display in one web function, so that every screen shows time the same way.

## The database refuses bad data

- Write migrations forward-only. Fix a mistake with a new migration, never by editing one that is on `main`, because a database that already applied the old file would then differ from the repo.
- Regenerate `packages/db/src/schema.ts` in the commit that adds the migration, and never edit it by hand, so that the types always describe the schema that the migrations build.
- Make every rule that the database can enforce a constraint or a trigger, so that the database refuses bad data even when the API is wrong.
- Write SQL with lowercase keywords, singular snake_case table names and schema-qualified names, so that each migration reads like the ones before it.
- Send SQL from TypeScript only through Kysely or its `sql` tag with parameters, never through string concatenation, because concatenated SQL is how injection happens.

## Tests use the real database and the real API

- Test against real Postgres and real HTTP. Fake only what the repo does not own (object storage, mail, the clock), at an injected seam, never by module mocking, because a mock of our own code tests the mock.
- Give each test file its own database, and make each test create its own records, so that any test passes alone and in any order.
- Test through the public interface: HTTP for the API, exported functions for the domain, SQL for database invariants. A test that reaches inside breaks on every refactor. Give a pure rule with many cases a table-driven test in `packages/domain`.
- Name a test with a sentence that states the behaviour in glossary terms, because the name is what a failing run shows.
- Do not chase a coverage percentage, because a percentage rewards lines, not refusals. Show every step-registry refusal and every database constraint or trigger refusing in a test, and land every bug fix with a test that failed first.
- Test the web with Playwright walks only, one for each user-visible flow. Move logic that needs a unit test to `@lims/domain`, so that the web stays free of rules.

## Packages stay apart

- Keep `@lims/domain` free of I/O: no `process.env`, no `fetch`, nothing that reaches outside the process, because the browser runs it too.
- Keep business rules out of the web, because a rule in the web is a rule that the API does not check. What a person may do comes from the step registry or from the API.
- Reach another package only by its name, never by a relative path, because the lint rule sees only paths that spell `packages/` or `apps/`.
- Bump dependency versions in the monthly patch round that ADR 0002 sets for image digests, so that upgrades arrive together and get one test pass.
- When a pull request adds a runtime dependency, say in the pull request what the dependency saves writing and why Node 24's built-ins do not cover it, because every dependency is code that the monthly round must then patch.

## Configuration is read once, and logs carry no record content

- Read the environment once, at process start, in one config module for each process, so that a missing value stops the process at start and not at the first request that needs it. No other file touches `process.env`.
- Give a secret no default in code, and never commit one, because a default secret ends up in a real deployment. A secret arrives through a file or a variable that the deploy config names, as `deploy/README.md` describes.
- Log record IDs and step names. Never log a request body, a password, a token or record content, because signing requests carry passwords.
- The seed script prints the demo password. ADR 0002 documents this as a demo exception.

## The web stays small

- Read server data through `useApi`. A component does not keep its own copy, so that a reload shows what the database holds.
- Record a decision on the map before a pull request adds a state library, a CSS framework or a component library, because every screen then has to follow it.
- Render a status only through `Status`, so that the word, glyph and colour order from [Prototype the UI direction](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/23) holds on every screen.

## Motion follows the server, and every screen works on a phone

These rules come from [Decide the frontend design cycle](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/52). A signed, verdict or status value is any Signature, verdict, Status or record state that the server decides.

- Start motion on a signed, verdict or status value only after the server's answer, never on the press, so that the screen never shows a state the record is not in.
- Show a new status word and glyph in full from the first frame. Motion is an accent on a confirmed state, such as a tint that fades. Never crossfade or morph one status into the next, because both would be on screen at once.
- Animate a row in only if the server returned it, and play no part of the success motion on a refusal or a failure, so that motion never claims what the Audit Trail does not hold.
- Keep a control inert from the first press until the server answers, and take no press on a surface that is closing, so that every commit happens once.
- Follow the build rules of [Prototype the UI direction](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/23) where they and the `emil` skills disagree. Feeling faster is never a reason to show an unconfirmed record.
- Animate status changes, row insertions, screen transitions, press feedback, and the enter and exit of occasional surfaces such as the signature sheet. Keep typed-entry grids, keyboard-initiated actions and bulk queue work instant, because an action repeated all day must not wait on an animation.
- Honour `prefers-reduced-motion`: remove movement, keep at most a short opacity fade, and make status accents instant, so that a person who cannot tolerate motion can still use every screen.
- Animate with CSS: transitions, `@starting-style` and the View Transitions API. Do not animate a property that triggers layout, such as `height`, `top` or `margin`, because it makes the page stutter under load. A JavaScript motion library needs a named component that CSS cannot serve, chosen through `emil:pick-ui-library` and justified in its pull request. The decision above already allows a headless primitives library for dialogs, popovers and tooltips.
- Design sign-in, signing, the Customer portal, bench quick-entry of readings, and the inventory steps of receiving Packs, Placement, Pack status changes and the Verified signing for a phone. Design every other screen for tablet and desktop, and keep it readable and operable at phone width, because staff and Customers reach the LIMS from all three.
- Make every control at least 44 × 44 CSS px and a rail commit button at least 56 px tall, for gloved hands. Set input text to at least 16 px, because an iPhone zooms the page when a smaller input takes focus.

## Python and shell follow the same gate

- Put a type hint on every Python function signature, so that a reader knows each argument's type without running the script.
- Test Python with `unittest`, because it needs no dependency.
- When the pdfplumber worker arrives, manage its packages with uv and a lockfile, and add pyright to the gate, so that Python gets the same pins and type check as TypeScript.
- Start every shell script with `set -euo pipefail`, so that a failed command stops the script.
- Use shell for glue only, because shell has no types here and no tests. Rewrite a script in TypeScript when it grows real logic or passes about 40 lines.

## Commits and pull requests

- Write a commit subject as an imperative sentence in glossary terms, with no type prefix, in at most 72 characters, because the subject is the one line of history that everyone reads.
- Bring code to `main` only through a squash-merged pull request that links its ticket, with one ticket for each pull request, so that every commit on `main` traces to one decision.
- A change to `CONTEXT.md`, an ADR or a document other than this one may commit straight to `main`, because it changes no code that the gate checks.

## Changing this standard

- Change a rule with a pull request, like code, so that the change gets the same review.
- Add a rule when the same review finding has come up twice, because one finding is an incident and two are a pattern.
- Delete a prose rule in the pull request that makes a tool enforce it, so that this document never repeats a tool.
- When a pull request must break a rule, change the rule in that pull request and give the reason. A rule that is broken silently stops being a rule.
