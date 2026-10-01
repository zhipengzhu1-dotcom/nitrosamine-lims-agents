# Thin slice of the sample chain

Answers [#24](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) and stops: Customer submits, Sample Custodian receives, Lab Manager assigns to a trained Analyst, Analyst types a Result, Reviewer signs, QA releases the Test Report. Password + TOTP login, re-authenticating Electronic Signatures, an Audit Trail enforced in the database. Hard budget 5,000 counted lines (`scripts/loc.sh`). Ideas may come from `prototype/walking-skeleton`; code never does.

## The chain-step table

One registry in `packages/domain` drives the API's single step endpoint (`POST /api/steps/:step`) and the web's Bench Rail action. No per-step endpoints or screens. The API registers that endpoint once per registry entry, all through one handler, so each step's body is validated against its own schema.

```ts
type Role = 'Customer' | 'SampleCustodian' | 'Analyst' | 'Reviewer' | 'QA' | 'LabManager' | 'Admin';
type TestState = 'Requested' | 'Ready' | 'Assigned' | 'SubmittedForReview' | 'Reviewed' | 'Reported';
type Meaning = 'Performed' | 'Reviewed' | 'Released';
interface StepFacts { actor: PersonId; assignee: PersonId | null; assigneeTrained: boolean; signers: Partial<Record<Meaning, PersonId>> }
interface Step { from: TestState | null; to: TestState; role: Role; signs: Meaning | null; guard?: (f: StepFacts) => string | null }
const steps = { submit, receive, assign, enterResult, review, release } satisfies Record<string, Step>;
```

| Step | From → to | Role | Signs | Guard (refusal when it fails) |
|---|---|---|---|---|
| submit | none → Requested | Customer | none | creates the Submission, its Sample and its Test |
| receive | Requested → Ready | Sample Custodian | none | records Acceptance and Sample receipt as one action |
| assign | Ready → Assigned | Lab Manager | none | assignee holds the Analyst role in the Lab and a Training Record for the Method |
| enterResult | Assigned → SubmittedForReview | Analyst | Performed | actor is the assignee |
| review | SubmittedForReview → Reviewed | Reviewer | Reviewed | actor did not sign Performed |
| release | Reviewed → Reported | QA | Released | actor signed neither Performed nor Reviewed; creates the Test Report |

The reason recorded with each step's writes is the step name.

## Tables (schema `lims`)

Company-owned: `person` (id, username, display_name, customer_id for Customer Users, password_hash, totp_secret, totp_last_step so a code is accepted once, failed_logins, locked_at), `customer` (id, name), `method` (id, code, title, version), `submission` (id, customer_id, submitted_by).

Roles, Test states and Signature Meanings are Postgres enums, so the generated Kysely types carry them as unions.

Lab-owned, `lab_id NOT NULL` and first in every primary key, children referencing `(lab_id, parent_id)` so no row points into another Lab: `lab` (lab_id, code, name), `membership` (person_id, role), `training_record` (person_id, method_id), `sample` (submission_id, number with the Lab code, received_at), `test` (sample_id, method_id, state, gxp_class, assignee_id), `result` (test_id, value as written, unit, injection_sequence_ref, notebook_ref, performed_on, entered_by), `signature` (person_id, meaning, record_table, record_id, content bytes, content_hash generated as sha256(content), signed_at), `test_report` (test_id, number), `session` (person_id, token_hash, last_seen_at, ended_at).

`audit_entry` (chain, seq, at, actor, role, reason, table_name, op, old_row, new_row, prev_hash, hash), chained per `audit_chain`: one chain per Lab plus a `company` chain for company-owned rows.

- One capture trigger on every table except `audit_entry` and `session` writes the entry. Actor, role and reason come from `set_config('lims.*', …, true)`; a write missing any of them is refused. Time is `clock_timestamp()` read under the chain lock. Credential columns are dropped from the stored row images.
- `hash = sha256(prev_hash || entry_bytes)`, where `entry_bytes` is a fixed rendering of the entry's columns. `lims.verify_chain(chain)` recomputes it and returns the first broken `seq`, or null.
- Blocking triggers refuse UPDATE, DELETE and TRUNCATE on `audit_entry` and `signature`.
- `lims_owner` (NOLOGIN) owns everything. `lims_app` logs in, owns nothing, holds SELECT, INSERT and UPDATE on business tables, SELECT and INSERT on `signature`, SELECT on `audit_entry`, no DELETE anywhere, and EXECUTE only on `verify_chain`.

## Module layout and line budget

| Area | Holds | Budget |
|---|---|---|
| `packages/db` | migrations, migrate, Kysely + `audited()` write path, credentials, seed | 550 |
| `packages/domain` + `apps/api` | step registry and guards; Fastify, sessions, `ActorContext`, step endpoint, signing, views | 1,200 |
| `apps/web` | login, worklist, Test page with Bench Rail and Audit Trail panel, placeholder modules | 1,400 |
| tests (any `test/` folder) | real Postgres and real HTTP, no mocks | 700 |
| `deploy/` | Compose, Caddy, Cloudflare Tunnel, runbook script | 200 |
| config and `scripts/` | workspace, tsconfig, `loc.sh`, `pg.sh` | 150 |

Planned 4,200. Stop and raise at 4,500. Generated `packages/db/src/schema.ts`, the lockfile and docs are not counted.

## Left out on purpose

- Instrument import, the Python worker, passkeys, anchoring, backups, Deviations, Holds, the Verified step, Runs and Preparations (one typed Result per Test).
- Separate Acceptance and rejection, cancellation, Return, reassignment, Amended Reports.
- Specifications, limits, verdicts and Calculation Versions: the Result is printed as typed, with no pass or fail.
- Critical Data Changes and corrections: a Result is entered once, at enterResult.
- Authorisations (a Training Record stands in for the Method Authorisation), Document versions, GxP Class choice (every Test is GMP).
- Release locks, Record Version history and "unsigned after change", the TOTP encryption key and password pepper, Admin screens. Every other module is one placeholder screen.
