# Module map

Five units in one pnpm workspace. Each owns one body of knowledge. Dependencies point one way:
`web -> contract`; `api -> domain, db, contract`; `db -> domain (ids only)`. `domain` imports nothing.
dependency-cruiser enforces the arrows in CI.

```
packages/
  domain/      pure TypeScript, no IO, no framework
  contract/    zod wire schemas and DTO types
  db/          SQL migrations, generated Kysely types, the scope seam, the audited transaction
apps/
  api/         Fastify shell, commands, views, the Records module, identity, seed
  web/         Vite + React 19 SPA
```

## packages/domain: the rules

Owns every rule that can be stated without a database. Tested by table-driven unit tests with no setup.

- `decimal.ts` owns exact numbers. Rationals, written decimals with their decimals, the one rounding.
- `verdict.ts` owns ADR 0006 (Acceptance Criteria) and decision 29 / ADR 0003 (Specification Sections). It also owns the rule that an instrument-rounded value is never rounded again.
- `calculation.ts` owns the Preparation result and the Reportable Result mean.
- `machines.ts` owns the lifecycles of Test, Sample and Test Report as data, and the derived states of Submission and Run.
- `gates.ts` owns Ready, assignment, Verified, Run Performed, Test Performed, Test Reviewed and Released, as fact types in and `GateResult` out.
- `signing.ts` owns the seven meanings, their statements, and which meanings approve a change or need an attestation.
- `canonical.ts` owns the canonical JSON type, which has no `number`, and its serialiser.
- `refusal.ts` owns every refusal and its server-rendered message, including the `not-built` spec-gap refusals.
- `ids.ts` owns the branded identifiers.

## packages/contract: the wire

Owns request and response shapes. It is the only package `apps/web` may import. So the browser can print server facts but cannot compute a verdict, an eligibility or a hash.

## packages/db: the database discipline

Owns the database, and nothing outside it holds a connection.

- `migrations/` holds the SQL in this package's `sql/` sketch. Migrations run as `lims_migrator` doing `SET ROLE lims_owner`.
- `generated.ts` is kysely-codegen output. `tables.generated.ts` is the table classification (Lab, ledger, company, portal view, insert-only). A script reads the catalog to build it, and CI fails if it is stale.
- `scope.ts` holds `Scope`, the scope plugin, and `openRead` (READ ONLY transactions). This is the lab-scoped seam.
- `audited.ts` holds `runAudited`. It takes the commit-key advisory lock, sets the audit context and pre-locks the chain heads in a fixed order, and it is the only write path.
- `blobs.ts` holds the content-addressed file store on the report-store volume.

## apps/api: the server

- `actor.ts` builds the `ActorContext` from the session cookie in the handler, and derives the session state.
- `doors.ts` registers the two doors, `GET /api/views/:name` and `POST /api/commands/:name`, plus the three fixed session and file endpoints. No other route exists.
- `commit.ts` is the commit pipeline. It checks the role, runs one audited transaction, and settles commit keys so each commit happens once.
- `records/` is the deep module. `index.ts` holds the five operations (record, change, seal, sign, standing). `kinds.ts` is the kind register with fields, content builders and signing rules. `facts.ts` holds the fact loaders, one per gate. `eligibility.ts` holds the "who is signing" probe.
- `identity/` holds passwords (argon2id + pepper), TOTP, full re-authentication for signing and unlock, and lockout derivation.
- `commands/` holds one file per area:
  - `session.ts` has login, lock, unlock, switch-user, takeover and logout.
  - `submission.ts` has submit, used by a Customer User or on behalf.
  - `acceptance.ts` has `test.accept` and `test.reject`.
  - `receipt.ts` has `sample.receive`.
  - `test-assign.ts` has `test.assign`.
  - `work.ts` has `test.start`, `run.create`, `run.linkTest` and `preparation.create`.
  - `values.ts` has `value.record`, `value.change` and `value.reject`.
  - `review.ts` has `review.open`, `review.tick` and `test.return`.
  - `signing.ts` has prepare and sign.
  - `reports.ts` has `report.draft`, `report.submitToQa`, `report.return` and `report.download`.
  - `audit.ts` has `audit.verifyChain`.
  - `gaps.ts` holds the explicit not-built commands, which always refuse and log.
- `views/` holds one file per screen family, each a `defineView`.
- `seed/` is the seed script. It drives `commit()` in-process. Reference data goes in as `svc:seed`. Each fictional person signs in with `session.login` and signs in their own session through the real re-authentication, because the database refuses a signature whose signer isn't the transaction's person (LS000).

## apps/web: the SPA

- `session/` holds SessionGate, SignIn, LockScreen, the session store (BroadcastChannel across tabs), and the activity reporter and idle lock.
- `api/` holds `useView` and `useCommand`. `useCommand` is the only mutation path, with a commit key per attempt.
- `components/` holds the Bench Rail component list plus the three from rule 12: Rail, SignaturePrompt, SignatureLine, SignatureBlock, AuditTrailPanel, CriticalDataChangeDialog, StepBar, Keypad, FitnessTag and StatusWord.
- `screens/` holds the real sample-chain screens. `screens/rough/` holds the other modules (Deviations, Checks, inventory, documents, ELN, stability). They render and save nothing, and lint stops them importing `useCommand`.

## Who owns which knowledge (the questions a newcomer asks)

| Question | Answer lives in |
|---|---|
| Can this person be assigned / sign this? | `domain/gates.ts` (rule), `api/records/facts.ts` (facts) |
| Is this value in spec? | `domain/verdict.ts` |
| What exactly was signed? | `record_version.content` bytes, written by `api/records/kinds.ts` builders |
| Is this signature still good? | `lims.version_stands()` via `Records.standing` |
| Why can't this change take effect yet? | `lims.pending_version` (ADR 0001 in SQL) |
| Who changed this, and why? | `lims.audit_entry`, written only by triggers |
| Can this query see another Lab? | `db/scope.ts` plus the capture trigger's Lab guard |
| Can this button fire twice? | `web/api/useCommand.ts` + `api/commit.ts` |
