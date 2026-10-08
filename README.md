# Nitrosamine LC-MS/MS LIMS

A demo laboratory information management system for a nitrosamine QC lab, built to 21 CFR Part 11, EU GMP Annex 11 and ISO/IEC 17025. Every record in this repo is fictional.

The work is planned on GitHub: the [map](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1) holds the standing decisions, and [spec #85](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/85) holds the build tickets.

## Layout

| Path | What it holds |
|---|---|
| `apps/api` | The Fastify API. Every route authorises from the request's `ActorContext` and serializes through a TypeBox schema. |
| `apps/web` | The React web app on Vite, and its Playwright walks in `apps/web/e2e`. |
| `packages/db` | Forward-only SQL migrations, the generated Kysely schema, the seed, and the database tests. |
| `packages/domain` | Rules shared by the API and the web: the step registry, refusals, and value arithmetic. No I/O. |
| `scripts` | `dev.sh` runs the app, `pg.sh` runs this checkout's Postgres, `check.sh` is the gate, and `ci-runner.sh` runs CI on this Mac. |
| `deploy` | The Compose stack and the owner's runbook for the hosted demo. |
| `ci/runner` | The self-hosted GitHub Actions runner image. |
| `docs` | ADRs, the coding standards, the thin-slice design, and the real-data gate. |
| `CONTEXT.md` | The glossary. Code, tickets and prose use its terms. |

## What you need

- Node 24 and pnpm 12.8.1 (`corepack enable` picks up the version in `package.json`).
- PostgreSQL 18 from Homebrew (`brew install postgresql@18`). `scripts/pg.sh` looks for it in `/opt/homebrew/opt/postgresql@18/bin`, or in `PGBIN`.
- uv, for ruff and shellcheck in the gate.
- Docker, only to run the CI runners.

Then install the packages:

```sh
pnpm install
```

## Run it locally

```sh
scripts/dev.sh
```

This starts the checkout's Postgres, applies the migrations, seeds an empty database (the seed prints the demo accounts and password), and starts the API and the web together. Open http://localhost:5173.

`scripts/dev.sh --scratch` drops and recreates this checkout's own database first.

## Check your work

```sh
scripts/pg.sh start
pnpm check
pnpm e2e
```

`pnpm check` is the gate: the Biome format check, oxlint, the typecheck, ruff, shellcheck, and the database, domain and API tests. It includes the schema drift check and the refusal completeness check. `pnpm e2e` runs the Playwright walks on desktop, iPhone and Pixel. Both must pass before you push.

To use a Postgres you already run, set `LIMS_PG=postgres://postgres@localhost:<port>`.

## CI

GitHub Actions runs `check` and `e2e` on every pull request and on `main`. The jobs run on self-hosted runners in Docker on the owner's Mac, never on GitHub-hosted runners:

```sh
scripts/ci-runner.sh build    # build the runner image
scripts/ci-runner.sh start    # start one check runner and one e2e runner
scripts/ci-runner.sh status   # list the runners and confirm the Mac stays awake
scripts/ci-runner.sh stop     # stop the runners and deregister them
```

Run `start` again after the Mac restarts. Closing the lid still sleeps the Mac and fails the running job. [`ci/runner/README.md`](ci/runner/README.md) has the details.

## Deploy

[`deploy/README.md`](deploy/README.md) is the runbook for the hosted demo. A deploy pauses for the owner.

## How work lands

- Code reaches `main` only through a squash-merged pull request that links one ticket.
- A behaviour change ends with a compliance review by the `part11-expert`, `iso17025-expert` and `usp-expert` agents. Other work says "No compliance review: <reason>" in the pull request.
- [`docs/coding-standards.md`](docs/coding-standards.md) holds the rules for hand-written code, and [`CLAUDE.md`](CLAUDE.md) holds the rules for agents working in this repo.

## Licence

Released under the MIT License. See [LICENSE](LICENSE).
