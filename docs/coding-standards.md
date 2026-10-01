# Coding standards

These rules bind all hand-written code in this repo: TypeScript, SQL migrations, Python, shell and tests. A rule is here only if no tool can enforce it and an engineer who follows the pstack skills would not already do it. Each rule gives its reason. Process lives in the Notes of the [map](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1), and domain vocabulary lives in `CONTEXT.md`.

The walking skeleton does not meet every rule yet. [Task: bring the walking skeleton into line with the coding standards](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/49) lists what remains.

## The gate decides what is green

- Run `pnpm check` before you push. It runs oxlint, the typecheck, ruff, shellcheck and every test. The tests need the local Postgres (`scripts/pg.sh start`), and ruff and shellcheck need `uvx`.
- GitHub Actions runs `pnpm check` on every pull request and on `main`, with the Playwright walk (`pnpm e2e`) as a second job.
- Biome formats at 120 columns (`pnpm format`). oxlint with tsgolint lints, and its type-aware rules use the TypeScript 7 checker. `tsconfig.base.json` sets the compiler's strictness. This document does not repeat what those tools check. Read `.oxlintrc.json`, `biome.json` and `ruff.toml`.
- Keep `main` green. Do not skip or weaken a check to pass the gate. Fix the code, or change the rule as the last section describes.

## A glossary noun means one thing

- In an identifier, use Test, Method, Run, Check, Result and Specification only for the domain concept, because a `test` that sometimes means an automated test makes every reader stop and work out which one it is.
- Write automated tests with `describe` and `it` from `node:test`, so that `test` in code always means the domain Test. The `test/` folders and the `*.test.ts` and `*.spec.ts` suffixes stay, because the tools look for them.
- Name a test helper for what it does (`startApi`, `harness`), never `testSomething`.
- Do not call a function a "method" in a name or a comment, and do not use `run` as a bare identifier. Both words belong to the glossary.
- Name files in kebab-case and types in PascalCase. Write an enum value as its glossary term without spaces (`SampleCustodian`), so that each value maps back to one glossary entry.
- Keep snake_case inside `.sql` files and `sql` fragments. TypeScript reads and writes camelCase through Kysely's `CamelCasePlugin`, so that no query renames columns by hand. Audit Trail row snapshots keep their stored column names, because they are records of the row.

## Every write and every read goes through a seam

- Write to the database only inside `audited()` (`packages/db/src/db.ts`), because it sets the actor, role and reason that the Audit Trail captures ([ADR 0002](adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md)).
- Reach Lab-owned rows only through `labScope` (`apps/api/src/scope.ts`), because it filters every query to the Lab of the `ActorContext` (ADR 0002).
- Authorise each request from its `ActorContext` inside the route, never in framework middleware, because a middleware bypass then skips nothing (ADR 0002).
- Decide who may take a step, and from which state, only in the step registry (`packages/domain/src/steps.ts`). The API and the web both read it, so they cannot disagree ([thin slice design](design/thin-slice.md)).
- Write a Signature only through the one database function that re-authenticates in the same transaction ([Decide the spec gaps the walking skeleton found](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/45)).
- Give every exported seam function one doc sentence that states the invariant it guarantees, so that a reader learns the rule at the seam.

## Types say what crosses a boundary

- Do not use `any`, `as`, a non-null `!`, or `@ts-expect-error`, in tests as well as in source, because each one turns off the check that would have caught the mistake.
- Cast only inside a seam module, on a line whose lint-disable comment says why the types cannot express it. `scope.ts` narrows Kysely's types this way.
- Define each shape that crosses HTTP once, as a TypeBox schema in `@lims/domain`. The API validates requests with it, and the web and the tests import the derived type, so that the three cannot drift apart.
- Declare a response schema on every route, so that a column that is not in the schema never leaves the API.

## A refusal is a value, a failure is thrown

- Return a refusal from domain code as a value. Domain code never throws, so that the API and the web can both ask "may this person do this?" without a `try`.
- Turn a refusal into an HTTP error only in the API, and only through `refuse`, so that every status code is chosen in one place.
- Do not swallow an unexpected failure. A `catch` adds context and rethrows with `cause`, or it does not exist.
- Write a refusal message as a sentence for the person at the bench, in glossary terms, because the web shows it as written.

## Values keep their digits and time comes from the database

- Never hold a measured value or a limit in a JavaScript `number`. Use a decimal string in TypeScript and `text` or `numeric` in Postgres, because a float loses the digits as typed.
- Do arithmetic on values in one domain module, so that rounding ([ADR 0006](adr/0006-acceptance-criteria-round-the-value-once-to-the-limits-written-decimals.md)) has one implementation.
- Take every timestamp that is stored on a row from the database clock, never from `new Date()` or `Date.now()`, because the API host's clock is not the record's clock.
- Send a time over HTTP as an ISO 8601 UTC string, and format it for display in one web function.

## The database refuses bad data

- Write migrations forward-only. Fix a mistake with a new migration, never by editing one that is on `main`, because a database that already applied the old file would then differ from the repo.
- Regenerate `packages/db/src/schema.ts` in the commit that adds the migration, and never edit it by hand.
- Make every rule that the database can enforce a constraint or a trigger, so that the database refuses bad data even when the API is wrong.
- Write SQL with lowercase keywords, singular snake_case table names and schema-qualified names, as the existing migrations do.
- Send SQL from TypeScript only through Kysely or its `sql` tag with parameters, never through string concatenation.

## Tests use the real database and the real API

- Test against real Postgres and real HTTP. Fake only what the repo does not own (object storage, mail, the clock), at an injected seam, never by module mocking, because a mock of our own code tests the mock.
- Give each test file its own database, and make each test create its own records, so that any test passes alone and in any order.
- Test through the public interface: HTTP for the API, exported functions for the domain, SQL for database invariants. Give a pure rule with many cases a table-driven test in `packages/domain`.
- Name a test with a sentence that states the behaviour in glossary terms.
- Do not chase a coverage percentage. Show every step-registry refusal and every database constraint or trigger refusing in a test, and land every bug fix with a test that failed first.
- Test the web with Playwright walks only, one for each user-visible flow. Move logic that needs a unit test to `@lims/domain`.

## Packages depend in one direction

- Import along `db` ← `domain` ← `api` only. The web imports `@lims/domain` and nothing else from the workspace.
- Keep `@lims/domain` pure: no I/O, no `node:` imports, and only types from `@lims/db`, because the browser runs it too.
- Keep business rules out of the web. What a person may do comes from the step registry or from the API.
- Import a package through its `exports` map, never through its `src/` path.
- Pin every dependency to an exact version. Bump versions in the monthly patch round that ADR 0002 sets for image digests.
- When a PR adds a runtime dependency, say in the PR what the dependency saves writing and why Node 24's built-ins do not cover it.

## Configuration is read once, and logs carry no record content

- Read the environment once, at process start, in one config module for each process. The module fails with a clear message when a value is missing. No other file touches `process.env`.
- Give a secret no default in code, and never commit one. A secret arrives through a file or a variable that the deploy config names, as `deploy/README.md` describes.
- Log record IDs and step names. Never log a request body, a password, a token or record content, because signing requests carry passwords.
- The seed script prints the demo password. This is the documented demo exception in ADR 0002.

## The web stays small

- Read server data through `useApi`. A component does not keep its own copy, so that a reload shows what the database holds.
- Record a decision on the map before a PR adds a state library, a CSS framework or a component library.
- Render a status only through `Status`, so that the word, glyph and colour order from [Prototype the UI direction](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/23) holds on every screen.

## Python and shell follow the same gate

- Put a type hint on every Python function signature, and test with `unittest`.
- When the pdfplumber worker arrives, manage its packages with uv and a lockfile, and add pyright to the gate.
- Start every shell script with `set -euo pipefail`.
- Use shell for glue only. Rewrite a script in TypeScript when it grows real logic or passes about 40 lines.

## Commits and pull requests

- Write a commit subject as an imperative sentence in glossary terms, with no type prefix, in at most 72 characters.
- Bring code to `main` only through a squash-merged pull request that links its ticket, with one ticket for each pull request.
- A change to `CONTEXT.md`, an ADR or a document may commit straight to `main`.

## Changing this standard

- Change a rule with a pull request, like code.
- Add a rule when the same review finding has come up twice.
- Delete a prose rule in the pull request that makes a tool enforce it.
- When a pull request must break a rule, change the rule in that pull request and give the reason. Do not break a rule silently.
