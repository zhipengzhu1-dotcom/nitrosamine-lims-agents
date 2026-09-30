# Walking skeleton core: sealed versions, Recorded Values, two doors

The design contract for [Prototype the walking skeleton on main](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24). It came out of a three-model architect arena. This file, `module-map.md`, `sessions.md` and `test-plan.md` are the base candidate's package with the synthesis applied. The SQL and TypeScript sketches it refers to were throwaway; the code in `packages/` and `apps/` replaces them.

## Problem

One fictional Submission must travel the whole sample chain for real: Customer, Sample Custodian, Lab Manager, Analyst, Verifier, Reviewer and QA, ending in a downloadable PDF with its hash. Every write must be audited inside Postgres, and every signature must bind to the exact content shown. A critical value corrected after its first save must stay a proposal until a second person approves it. Every commit must happen once, and a GET must never change anything. The shape is not obvious because of four constraints that pull against each other.

1. **Signatures bind to content, and content spans rows.** A Test's signed content includes its Preparations, its results and the Run Versions it used. A Run's content includes its typed values and its True Copy hash. A change to any of them must show the signature as "UNSIGNED — changed after signature", years later, under a later release of the code.
2. **Critical data is corrected per value.** Typed entry is Verified value by value (decision 20). A correction is a proposal that a signing approves, and the earlier value stays current until then (ADR 0001). So attribution, verification and correction all happen at the level of one value, not one record.
3. **Two chains, one clock.** Each Lab and the company has its own hash chain. Audit ids are assigned under the chain lock, times come from the database clock, and the app role can never write the trail itself (decision 13).
4. **This is a one-way door.** Deviations, Checks, documents, ELN and stability all reuse whatever versioning, signing and audit shape the skeleton sets. A shape that needs per-module signing code will be copied wrong nine times.

Constraints carried in unchanged: the stack and `ActorContext` in the handler (ADR 0002), the lab-scoped seam with a test, company tables apart and `lab_id NOT NULL`, the 25 build rules (decision 23), the seven meanings, the SoD rules and the Authorisation model (decisions 13 and 19), Preparation-first verdicts per Section (decision 29, ADR 0003), and ADR 0006's rounding. Terms follow `CONTEXT.md`. One new term is proposed, **Recorded Value**, and one internal word is added, **ledger**, meaning the company or a Lab as the owner of one audit chain.

## Usage (caller's view)

### Quickstart for the next module author

Every mutation is a named Command. Every read is a named View. Every typed value on a signable record goes through `tx.records`. Signing is never code you write. You describe your record kind and the core does the rest.

```ts
// A command: parse at the boundary, load facts, call a pure gate, act. That's the whole server side.
export const assignTest = defineCommand({
  name: 'test.assign',                                   // also the audit entry's action
  input: z.object({ testId: TestIdSchema, analystId: PersonIdSchema }),
  actingAs: 'LabManager',                                // pipeline refuses unless held in this Lab
  reason: { kind: 'action' },                            // Reason for Change: the action itself
  ledgers: (_i, actor) => [actingLab(actor)],            // chains this may write, locked in fixed order
  run: async (tx, { testId, analystId }) => {
    const { facts, display } = await loadAssignmentFacts(tx.db, testId, analystId, tx.dbNow);
    const gate = assignmentGate(facts);                  // pure: domain/gates.ts
    if (!gate.go) return toRefusal(gate);
    const t = transition(TestMachine, facts.testState, 'assign', 'LabManager');
    if (!t.ok) return { kind: 'transition', message: `${display.testNumber} is ${facts.testState}.` };
    await tx.db.updateTable('test').set({ state: t.to, assigned_analyst: analystId })
      .where('id', '=', testId).execute();               // lab_id added by the scope plugin; audited by trigger
    return tx.receipt(`Assigned ${display.testNumber} to ${display.analystName}.`);
  },
});
```

```ts
// Typing a value: first save is effective at once; a later critical value is a pending proposal.
await tx.records.record({ parent: testId, field: 'prep.weight', subject: prepId,
                          value: { type: 'decimal', value: parseWritten('100.12'), unit: 'mg' } });
await tx.records.change({ value: weightId,                // reason comes from the command's picklist input
                          to: { type: 'decimal', value: parseWritten('100.21'), unit: 'mg' } });
// -> { standing: 'pending' }. The old value stays current until someone else signs Verified.
```

```tsx
// The web app: a View to read, a Command to act, and a SignaturePrompt that the server fills.
const view = useView<AssignmentView>('test.assignment', { testId });
const assign = useCommand<{ testId: string; analystId: string }>('test.assign');
<Rail primary={{ label: `Assign to ${chosen.printedName}`, disabled: assign.busy,
                 onPress: () => assign.run({ testId, analystId: chosen.id }) }}
      receipt={assign.state.status === 'done' ? assign.state.receipt : null} />

const signing = useSigning();                             // press -> signing.prepare -> sheet opens
<Rail primary={{ label: 'Sign Test as Performed', onPress: () => signing.open('Performed', [testId], null) }} />
{signing.sheet && <SignaturePrompt meaning="Performed" prepared={signing.sheet} actionLabel="Sign Test RD-S-2026-000123/T1 as Performed" … />}
```

```sql
-- A new signable record type (Deviation, later): one kind row, one head table, one registration call,
-- plus one entry in apps/api/src/records/kinds.ts. Versioning, CDC, signing, UNSIGNED, locks, audit: inherited.
insert into lims.record_kind values ('deviation', 'lab', false, array['Reviewed', 'Approved']);
create table lims.deviation (lab_id uuid not null, id uuid not null, number text not null, kind text not null,
  state text not null, investigator uuid, primary key (lab_id, id),
  foreign key (lab_id, id) references lims.record (ledger_id, id));
select lims.register_signable_head('lims.deviation', array['state', 'investigator']);
```

### The chain, as commands

| Brief step | Who | Commands (all `POST /api/commands/<name>`) |
|---|---|---|
| 1 | Customer User | `session.login`, then `submission.submit`, which creates the Samples (Expected) and Tests (Requested) with `customer_id` on each |
| 2 | Sample Custodian | `test.accept` or `test.reject` (reason visible to the Customer), then `sample.receive` (Lab-coded number). Whichever completes Accepted + Received runs `readyGate` and moves the Test to Ready in the same transaction |
| 3 | Lab Manager | `test.assign` (View `test.assignment` offers only eligible Analysts) |
| 4 | Analyst | `test.start`, `run.create`, `run.linkTest`, `preparation.create`, then `value.record` once per typed value as it is made, and `value.change` for any correction |
| 4 | Second person | `signing.prepare` + `signing.sign` with meaning Verified, as a group over every Recorded Value, approving pending changes |
| 4 | Analyst | Run signed Performed, then the Test signed Performed (the Test becomes Submitted for Review). The Test's version cites the Run Version id and hash |
| 4 | Reviewer | Run signed Reviewed (with its own Review record) |
| 5 | Reviewer | `review.open` and `review.tick` for the checklist including "audit trail reviewed", then Test signed Reviewed with the Review as attestation. Or `test.return` with a reason |
| 6 | Reviewer or Lab Manager | `report.draft`, then `report.submitToQa` |
| 6 | QA | release Review (checklist plus a confirmation per verdict, nothing pre-ticked), then Released. The same transaction locks, marks the Tests Reported, renders the PDF from the stored bytes and stores its hash |
| 6 | Customer User | `report.download` (audited, returns a 60-second token), then `GET /files/:token`. The portal shows the SHA-256 beside the link |

## Shape

### The two decisions other designs will likely get wrong

1. **Where signature validity comes from.** The likely default is to build canonical JSON from relational rows in TypeScript at signing time, and then rebuild it at display time to decide "UNSIGNED — changed after signature". That makes every historic signature depend on the current release's serialiser and row shapes. Here the signed thing is the stored bytes. The database computes their hash, and a foreign key makes a signature to any other hash impossible. "Changed after signature" is a question about which version is effective and what it cites, and nothing is ever re-serialised.
2. **What a Critical Data Change is.** The likely default is a side table of proposals plus approval code in the application. Here a correction is the next version of a Recorded Value. The database marks it as requiring approval and does not make it effective until someone other than its author signs that exact version Verified or Approved. The per-value atom is also what makes "Verified value by value" an ordinary group signing, not a special case.

### Data structures first

**A signable record is a head plus sealed versions.** The head row (`test`, `run`, `test_report`, and later `deviation`) holds identity and in-place lifecycle state only. `lims.register_signable_head` installs a trigger that refuses an in-place change to any other column. Every typed datum on the record is a **Recorded Value**, and every signed state is a **Record Version**.

**A Recorded Value is the atom of Critical Data.** Each typed value is its own tiny record (kind `value`, parent = the Test or Run), and its versions are the value's history: v1 is the first save, attributed and timed by the database. That makes the four things decisions 13, 20 and ADR 0001 demand per value into one structure:

- **Who typed it and when** is the version's author and time.
- **Verified value by value** means one signature row per value version, through ordinary group signing.
- **Correction as a proposal** is a later version. For a critical field, `requires_approval` is set by trigger and the app cannot opt out.
- **"Earlier value stays current"** is `lims.effective_version`, a view that ignores unapproved versions.

So the Critical Data Change is not a side table with its own approval logic. It is a version the database won't make current without an approving signature from someone other than its author (`lims.signature_guard`, LS001 and LS002). The Verified signer signs exactly the proposed version and hash the dialog showed. This is ADR 0001 in SQL, per **model-the-domain** (encode the rule in the structure) and **encode-lessons-in-structure** (the strongest mechanism available: the database).

**A Record Version stores its canonical bytes, and the database hashes them.**

- `record_version.content` is the canonical JSON as bytes. `content_hash` is `GENERATED ALWAYS AS (sha256(content)) STORED`.
- A signature carries `(ledger_id, record_version_id, content_hash)` through a composite foreign key onto `record_version (ledger_id, id, content_hash)`. A signature bound to any other hash cannot be inserted.
- A version cites its children by `(version id, hash)`, which makes it a Merkle node. A Test cites its Recorded Values, its Run Versions, its Method version and its pinned Specification version. A Test Report cites its Test versions.
- "UNSIGNED — changed after signature" is `lims.version_stands(v)`: v is still its record's effective version, no child value moved since it was sealed, and everything it cites still stands. The function never recomputes a hash.

**Sealing is lazy and idempotent.** Typing values creates value versions, not parent versions. A Test or Run version is sealed only when someone opens a signing prompt (`signing.prepare`). The builder serialises the effective state, and if the bytes hash to the latest version's hash, that version is reused. Re-opening a prompt twice makes nothing new, per **make-operations-idempotent**. The prompt then displays exactly the stored version, and `signing.sign` carries back the `{versionId, hash}` pairs it showed.

**Attestations are records of their own.** A Reviewer's checklist ticks and QA's per-verdict confirmations are Recorded Values on a **Review** record. The Reviewed or Released signature cites that Review's version (`signature.attestation_version_id`). If the ticks were content of the Test, the Reviewer ticking "audit trail reviewed" would itself unsign the Analyst's Performed signature. Keeping them apart is **separate-before-serializing-shared-state** applied to a record: two actors, two write targets, merged at the signature.

**Ledgers and chains.**

- `ledger` rows are the company and each Lab, and a Lab's id is its ledger id. Lab tables keep `lab_id NOT NULL` with composite FKs. The generic tables (`record`, `record_version`, `signature`, `audit_entry`) carry `ledger_id NOT NULL`, so nothing is ever nullable to mean "company".
- The audit trail is written only by `SECURITY DEFINER` trigger functions owned by the NOLOGIN owner. `lims_app` has SELECT on `audit_entry` and nothing else.
- Every audited transaction declares its ledgers, and `lock_chains` locks their heads in id order before any write. So chains can't deadlock, audit ids are assigned under the lock, and `clock_timestamp()` read under the lock makes chain order and time order agree.
- Each entry stores the bytes it hashed (`entry_bytes`), so verification hashes stored bytes. It does not re-serialise columns.

### How data flows

1. **Request.** A request comes in on `requireActor(req)` (cookie → session → `ActorContext` | session refusal).
2. **Parse.** The zod input is parsed at the boundary.
3. **Commit.** `commit(actor, key, def, input)` runs in order:
   - role check;
   - `runAudited`, which takes the key's advisory lock, sets the audit context, locks the chains and reads `dbNow`;
   - replay check against `commit_outcome`;
   - `def.run(tx, input)`;
   - on a receipt, the outcome row is written in the same transaction and committed;
   - on a refusal, the transaction rolls back, and a settle transaction writes the refusal outcome plus what must survive it (auth failures, the used TOTP step, spec gaps).
4. **Views.** `openRead(scope, fn)` runs in a READ ONLY transaction.

A reader traces any feature through three files: the command, `records/`, and the SQL.

### Invariants, by where they are enforced

The ladder goes from strongest to weakest, per **type-system-discipline** and **encode-lessons-in-structure**.

- **Unrepresentable in types.**
  - Canonical content has no `number` type.
  - A decimal is a `Written` with its decimals, and there are no floats in `decimal.ts`.
  - An instrument-rounded value is a different `Measured` variant from a full-precision one, so it can't be rounded twice.
  - `Records.sign` demands a `ReauthenticatedSigner` that only `identity/reauth.ts` can construct, so no code path signs without full re-authentication.
  - Session and machine states are sum types.
  - The customer-scope Kysely type contains only `portal_*` views.
- **Refused by the database.**
  - Insert-only tables, and no audit write path for the app.
  - The missing audit context (LA001 to LA004), a write to another Lab (LA006) or an undeclared ledger (LA005).
  - A signature hash that isn't the stored content's.
  - Self-approval and self-verification, and a signature written outside its signer's own audited transaction (LS000).
  - Critical changes that aren't effective before approval.
  - Release locks, and Admin combined with a business role.
  - TOTP step reuse (primary key).
  - A write inside a View (READ ONLY).
- **Structural in the server.**
  - Two doors only, so no mutating GET exists.
  - One write path (`runAudited`).
  - A commit key per attempt with advisory-lock serialisation.
  - The scope plugin throws `ScopeViolation` on a Lab table in a non-Lab scope.
- **Pure functions, tested as tables.** Every gate, every verdict, every transition. Per **boundary-discipline**, facts are loaded and clock standings are computed from the database clock in `facts.ts`. Gates never see a row or a clock.

### Interface depth

`Records` has five operations: `record`, `change`, `seal`, `sign` and `standing`. Behind them are the version table, canonical bytes, Merkle cites, the effective and pending derivation, CDC approval, both structural SoD rules, stale-version refusal, release locks and the standing computation. A module adds a record kind by supplying three things: a field register, a content builder, and a `SigningRule.check` per meaning (which loads facts and calls a pure gate). The commit pipeline is one function, `commit`. Its definition object is the only place a command states its role, reason policy and ledgers. No caller coordinates several calls to finish one operation. The one deliberate exposure is `tx.db`, the scoped Kysely handle, because each command owns its own in-place lifecycle update and hiding plain SQL behind a repository would be a pass-through layer (**minimize-reader-load**).

### What it deliberately does not do

- No OOS or Deviation workflow. A failing Preparation, Run Check or QA verdict disagreement returns `not-built: deviation-workflow` with the message "Deviation workflow not built in the skeleton", logged in `spec_gap`.
- No Hold creation. The `hold` table and gate checks exist, and nothing creates Holds yet.
- No imports, no passkeys, no anchoring (decision #34), no Amended Reports, no Invalidation, no LOQ/LOD reporting forms, no sums, no basis correction. Each is refused and logged, never approximated.
- No row-level security (deferred by ADR 0002). Reads are scoped in `packages/db`. Writes are also guarded in the database by the capture trigger's Lab check.
- No stored Run state and no stored Submission Accepted/Rejected. Both are derived.
- No cross-Lab staff views. A staff session acts in one Lab, so company QA across Labs waits.

## Synthesis decision

Three candidates (opus, fable, sonnet) sketched the core from one brief. A fable judge scored them blind on six criteria: audit integrity, signature correctness, Lab scope, domain modelling, depth and proportion, and extensibility. It gave this design 26, the sonnet design 24 and the fable design 22. The orchestrator's own reading picked the same base.

**Base: this design.** It is the only candidate whose signatures never depend on re-serialising old content. The bytes are stored, the database hashes them, a composite foreign key binds each signature to that hash, and versions cite their children Merkle-style. The other two recomputed today's canonical content to decide "changed after signature". ADR 0001 is a database fact here, not gate code every module must remember to call.

**The three converged** on three shapes. Each typed critical value is insert-only rows, never a mutable column. Versions are sealed when a signing prompt opens, not on every save. Reviewer ticks sit on a record separate from the one reviewed. That agreement is strong evidence for all three.

**Fixes to the base, from the judge:**
- `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA lims FROM PUBLIC`, then grant each function the app may call by name. As sketched, `append_audit` was callable by the app role, which could have forged audit entries.
- `register_table` takes a primary-key expression. Capture took `row_id` from a column named `id`, which several core tables lack.
- `version_stands` is written as the recursive rule, not a stub.
- The release lock covers everything the released versions cite, walking the cite closure, so Run-parented values lock too.
- A signing command acts under the role its meaning requires (Performed as Analyst, Verified as a second person holding a Verified Authorisation, Reviewed as Reviewer, Released as QA). There is no `self` role. The signature row and the audit entry take the role from the same context.
- LS002 stays strict: nobody who authored any version of a value signs it Verified. This is a decision, recorded here.

**Grafted from the sonnet design:**
- `require_context` also checks that the session is live, unlocked and belongs to the claimed person, and that the person holds the claimed role in the claimed Lab (`assert_actor`).
- Its exact-rational `decimal.ts` and `verdict.ts` bodies, already run against ADR 0006's examples, keeping this design's `Measured` type so an instrument-rounded value is never rounded twice.
- The seal-only door. `lims_app` has no INSERT on `record_version` or `signature`. Both go through SECURITY DEFINER functions (`lims.seal`, `lims.sign`) whose EXECUTE is granted by name.

**Grafted from the fable design:**
- After a signing's effects, the transaction asserts that every signed version still stands, or it rolls back.
- `ReadDb` is a Kysely type with no `insertInto`, `updateTable` or `deleteFrom`, on top of the READ ONLY transaction.
- Verdicts are also stored as rows (`section_verdict`, with Rule Set and calculation version) beside the Test version that carries them, so reports never parse bytes. A `release` table identifies each app release, and `app_release` references it.

**Rejected or deferred:**
- The sonnet design's database-enforced transition table. The pure machine runs inside the one write path, and a second copy in SQL is duplication the skeleton doesn't need yet. Revisit if a second write path appears.
- The #38 Unconfirmed Value mechanism. The slice types no readings and no equipment Checks. Whether #38 reaches typed Run Check values is an open question. The value version keeps room for a `standing` column.
- The fable design's `projectApproved`. It isn't needed here: a Verified signing signs the value versions themselves, and a Run version is sealed later and cites the effective value versions. So approving a change can never unsign the approver.

**Seeding and demo login.** Reference data (Method, Adoption, Product, Specification, Authorisations, Training Records) goes in through the real commands. The fictional people it creates sign with authenticators the seed script enrols. For the owner's demo, `seed --handover` then revokes those authenticators and prints a one-time enrolment link per demo account. The owner sets a password and scans a real QR code in Microsoft Authenticator or Duo, which is the owner's choice from the framing checkpoint. Past signatures stand, and revocation and enrolment are audited. This goes in the demo-exception record: seed signatures were made by the seed script acting for fictional people. Tests skip the handover.

**Data size.** Seed data stays at or under 30% of the #23 prototype's counts, generated into the database by the seed, never committed as a data file. A test fails if any count goes over.

## Tradeoffs accepted

- **One insert per typed value, plus one record row.** We accept roughly 3 rows per value (record, version, typed detail) and an EAV-looking `recorded_value` table in exchange for per-value attribution, Verified signing, correction and history from one mechanism. Queries over values go through the typed `recorded_value_version` columns, not JSON.
- **Relational detail and canonical bytes are both stored.** We accept that `recorded_value_version`, `authorisation_version` and similar rows sit beside the bytes built from them. Both are immutable and written in one transaction, so they cannot drift. In exchange, gates query columns and signatures never depend on re-serialising them.
- **Per-ledger serialisation.** Chain heads are locked for the whole audited transaction, and signing commands also lock the company chain (TOTP and auth events are company rows). Throughput per Lab is bounded by transaction length. That is fine for 8 people. PDF rendering inside the release transaction holds the lock for about 200 ms. We accept this in exchange for "Released ⇒ PDF exists" with no half state.
- **The canonical serialiser can change, and old bytes never do.** A future `test@2` builder writes new versions only. Old signatures keep verifying because nothing rebuilds old bytes. The cost is that the PDF renderer must read every schema version it has ever written.
- **Self-approval and self-verification are checked twice.** The pure gate checks them to explain the refusal before credentials, and the database enforces them. A test runs the gate's SoD table against the database to keep the two in agreement.
- **Seeding is slow on purpose.** A TOTP step is accepted once, and the seed signs as fictional people through the real re-authentication. So seeding waits for fresh codes, which group signing reduces to a few minutes. No clock injection or bypass exists, because it would be a demo aid under rule 2.
- **Lab-scoped reads are enforced in the app, not in Postgres.** RLS stays deferred per ADR 0002. The type split plus the plugin plus the seam test is the control.

## Alternatives considered

- **Per-kind version tables with the hash computed in TypeScript from relational rows at signing and at display.** This is the obvious shape. It exposes less machinery to a new module on day one, but it hides a time bomb. Signature validity depends on today's serialiser reproducing yesterday's bytes from today's rows. A release that adds a column to the projection, changes decimal formatting or reorders keys flips historic signatures to "SIGNATURE INVALID", or silently validates changed content. It also needs per-kind code for "changed after signature". Rejected because it is a shallow interface over a leaky invariant.
- **Critical Data Change as a `pending_change` side table with application-level approval.** It is simpler to read in isolation. But the approval rule then lives in code every module must call correctly, the Verified signer signs the record rather than the proposed value, and nothing stops a buggy command writing the new value directly. Rejected. The versioned-value shape makes the rule a database fact.
- **Event sourcing, with all state folded from an append-only event log.** It fits "nothing is ever deleted" beautifully. But Kysely types generated from tables, in-place lifecycle rows the decisions explicitly allow, and per-field old/new audit capture by trigger all fight it. The audit chain would duplicate the event log. Rejected as more machinery than the constraints ask for.
- **Eager parent versions, a new Test version on every typed value.** It removes the sealing step. But every keystroke-level save would make a new Test and Run version, and a Test would need re-versioning whenever a Run value moved. Rejected for lazy, idempotent sealing at the prompt.
- **One generic `POST /api/:resource` REST surface.** Rejected for the two doors. Named commands give the audit action vocabulary, the reason policy and the declared ledgers one home, and "no mutating GET" becomes a property of the router.

## Implementation reconciliation

### U2, the database core (`packages/db`)

Each entry says what differs from this document or the sketches, why, and whether the shared contract still holds. Codes in brackets are the SQLSTATEs the tests assert.

- **`register_table` reads the primary key from the catalog** instead of taking an expression, and takes `record_col` (defaulting to a `record_id` column when one exists) and `redact` (columns whose values the trail shows as `[changed]`). Stricter than the judge's fix: a wrong key cannot be passed. `row_pk` is a JSON array of the key values. Contract holds.
- **`lock_chains()` takes no argument.** It reads the ledgers from the context, so the declared set and the locked set cannot differ, and it validates the whole context at transaction start (a declared ledger with no chain is LA010). Contract holds.
- **`assert_actor` is LA009 inside `require_context`.** A human's context must name a live session of that person opened for the same Lab or Customer; service identities (`svc:%`) need none. The session is judged as of the transaction's start (`now()`), because the capture trigger runs after the row changed, and a person locking or ending their own session would otherwise refuse itself. `session_state(s, last_activity, at)` is therefore "the state at instant `at`", with a lock or end stamped later than `at` not yet in effect. The sketch's version ignored `at` for those two columns; that is a sketch bug JUDGE.md did not list.
- **PUBLIC execute is revoked by a global default privilege for `lims_owner`**, not per schema. The per-schema form can only add to Postgres's built-in default, never revoke from it, so the sketch's fix as first written left every function callable. The grant audit test enumerates the functions `lims_app` may execute, so a future migration cannot widen the set unnoticed.
- **Two more door-only tables.** `record_version_cite` is written only by `lims.seal`, which checks each cite against the cited version's stored hash (LV002) and requires the hash to appear in the content bytes (LV003), closing the sketch's TODO. `record_lock` is written only by `lims.lock_released(signature)`, which walks the cite closure. `lims_app` has SELECT only on both.
- **`lims.seal(record, content, schema, cites)`** returns the latest version when the bytes are identical (idempotent prompt re-open) and otherwise the next version. **`lims.sign(signer, version, hash, meaning, authenticator, group, attestation…)`** takes the signer explicitly so a mismatch with the context is refused by the door (LS000) and testable as `lims_app`; every other signature column comes from the context and the account. LS003 refuses a meaning the kind does not carry; LS004 a signer without an account.
- **The head guard** (`lims.head_guard`, the sketch's `refuse_if_locked`) lets an identity column be set once from null, which resolves the sketch's TODO for the pinned Specification, and refuses any later change (LR002). A locked head refuses every in-place change (LR001), so the releasing transaction updates its heads (Test to Reported, report to Released) before calling `lock_released`. That ordering replaces the sketch's TODO about recognising the releasing transaction.
- **LS002 is strict** as the Synthesis decision says: any author of any version of a value is refused Verified on it.
- **Service identities are the trust root.** Migration 0030 inserts the three `svc:` persons and grants with the capture trigger disabled for those statements, since the first role grant cannot be audited under itself. Everything after is written under one of them.
- **`release` is exempt from capture and insertable by `lims_app`** (`on conflict do nothing`), because it is the referent of every `app_release`. The harness inserts `test`; who registers a release in production is a spec gap below.
- **`section_verdict` and `blobs.ts` are left to the sample-chain unit.** The verdict rows reference Specification Sections and Lines, and the blob store has no part A test.
- **Branded ids lived in `packages/db/src/ids.ts` until U3**, with `COMPANY_LEDGER` and the `SERVICE` identities; the db package now imports them from `@lims/domain/ids` and keeps the ledger facts in `ledgers.ts`.
- **The scope plugin refuses raw SQL** as a root query and in FROM or JOIN position, aliased or not. The door functions are typed wrappers that run on the unscoped transaction held in a WeakMap keyed by the write handle, so the API never writes SQL text.
- **The chain link** is `head = sha256(prev_head || sha256(entry_bytes))`, and `entry_bytes` includes `prev_hash`, so each entry commits to its position. `verify_chain` checks entry k against entry k+1's `prev_hash` (or the head), which names a tampered entry at its own seq.
- **`session.acting_role` is dropped.** The role is chosen per command and carried by the context; the session holds the Lab or Customer it was opened for. **`account`** is included though not in the unit's list, because `lims.sign` needs the username.
- **Commit attribution** names the model that wrote the commits (Claude Fable 5.1), not the one the builder contract assumed.
- **`erasableSyntaxOnly`** is on in `packages/db`, so Node 24 can run any file in the package without a build step.
- **`dbNow` is for comparisons, not for stamping rows.** A JS `Date` keeps milliseconds and Postgres microseconds, so a `locked_at` written from `dbNow` can predate the transaction's own `now()` and read as a lock already in effect. Rows take their time from `clock_timestamp()` in SQL, which is also what decision 13 asks for.

### Spec gaps found by U2

- Who registers an app release (decision 13 stores the release id on every entry; nothing says how a release comes to exist). Assumed: the API inserts its own id at boot.
- Whether a service identity may write any Lab's rows without acting in a Lab (decision 13 names service identities but not their reach). Assumed yes; LA006 exempts `svc:%`.
- Whether an Admin's session has a Lab. Assumed none, and Admin's context has no Lab.
- Which meanings approve a pending value version. The sketch's `Verified` or `Approved` is kept (decision 13 says Reviewer signs Approved after Performed).
- Turning down a proposal (`version_rejection`) is an audited, unsigned action like a Return (decision 13 does not say).
- Whether a transaction from an idle session (15 minutes) is refused in the database as well as with 423 at the API. Assumed yes.

### U6a: `apps/web` presentation layer

The shared contract still holds for every item below. The components print server facts and compute no verdict, eligibility or hash.

- **Local prop types, not `packages/contract`.** The components take shapes from `apps/web/src/model.ts`, named with `CONTEXT.md` terms (`Signature`, `EligibilityAnswer`, `AuditEntry`, `SigningItem`, `Fitness`, `Limit`). The wiring unit maps DTOs onto them. The `web -> contract` arrow still holds, because nothing in `apps/web` imports another package yet.
- **The rough-screen lint is a source-scan test, not an ESLint rule.** `src/structure.test.ts` fails if a file under `screens/rough/` mentions a commit, a field or a request. It also fails if any source file formats a number (rule 20), or if a credential component has a fill path (rule 2). The module map's `no-command-in-effect` rule belongs to the wiring unit.
- **The production-bundle check lives in `src/bundle.test.ts`.** It runs a real `vite build` in a child process and fails if the bundle holds a forbidden marker. The markers are `lims-dev-gallery` and `lims-demo-aid`. A demo module (rule 2) must carry the second marker.
- **One commit key is sent at most once, on top of the in-flight guard.** `useCommitKeyOnce` refuses to send a key twice. After a refusal the owner hands the sheet a fresh key, as the sketch's `useCommand` rotates its key per attempt. `SignaturePrompt`, `CriticalDataChangeDialog`, `LockScreen` and `SignIn` all use it.
- **The sheet is a native modal `<dialog>`.** The page behind it is inert. The prototype used a positioned layer, which left the record behind the sheet reachable by Tab and screen readers.
- **The refusal and the attempts left sit in the sheet's footer rail.** In the prototype they sat under the credentials, and they scrolled out of view at 1366×768. Decision 23 says the attempts left stay in view, and the direction answers in the rail.
- **Lock-screen tiles are the owner and "Someone else".** The prototype showed one tile per person. A tile never fills the user ID, because decision 23 types it at every sign-in.
- **FitnessTag's compact form keeps its word visible.** The prototype hid the word visually in compact rows. Rule 19 supersedes that.
- **Fonts are self-hosted** through `@fontsource`, not the Google Fonts link. A bench PC then makes no third-party request.
- **Light only.** The direction rejects a dark theme, so the tokens set `color-scheme: light` and ignore the OS preference. Only the rail and the lock screen are dark.
- **`pnpm-workspace.yaml` gained `minimumReleaseAgeExclude` entries.** pnpm added them for vitest 5.0.3, which is younger than pnpm 12's default minimum release age. The other units will need the same lines.

### `packages/domain` (U2b, the pure rules)

The shared contract holds: module names, the `Measured` type, `Written`, `parseWritten`, `transition`, `toRefusal`, the gate names the sketches call and `eligibleAnalysts` are as the design names them. These are the differences, with why.

- **Sketch bug, not in JUDGE.md: branded ids collapsed to `never`.** The base `ids.ts` put every brand under one symbol key, so `RecordId & Brand<'TestId'>` intersected `'RecordId' & 'TestId'` to `never`, and any id was assignable to any other (checked with tsc). A brand is now a set of tags. `ids.test.ts` fails on the old definition.
- **Sketch bug, not in JUDGE.md: reassigning an In Progress Test moved it back to Assigned.** The base Test machine had one `to` per event, so `reassign` from In Progress landed in Assigned. The machine is now a list of cells (from, event, to), and reassignment keeps the state. It also gains decision 12's `reopenAfterChange` (Reviewed back to Submitted for Review after an approved change), and `system` may cancel, for a Sample Rejected at receipt.
- **Sketch bug, not in JUDGE.md: `submissionState` could stay Submitted forever.** A Submission whose Tests were all Rejected or Cancelled read as Submitted. A Cancelled Test's state no longer says whether it was accepted first, so the fact for a Cancelled Test carries `acceptedBeforeCancel`.
- **Decimals.** The sonnet bodies are grafted under the base names: its `Decimal {unscaled, scale}` is `Written {unscaled, decimals}`. `parseWritten` returns a `not-a-decimal` value instead of throwing, and `written()` is the throwing form for literals. `roundTo` adds half-even for GB/T 8170.
- **Acceptance Criteria.** A range rounds per bound (the sonnet sketch rounded both bounds at the larger decimals). An instrument-rounded value is compared only with a bound written to its own decimals. Fewer decimals in the limit returns `criterion-coarser-than-export` as designed, and fewer in the value returns a new `export-coarser-than-criterion`. The verdict lists one comparison per bound instead of one `compared` text.
- **Test-plan item 10's "79.5 against NLT 80 fails".** Under ADR 0006, NLT 80 is coarser than a 1-decimal export, so that pair returns `criterion-coarser-than-export`. The vector table has 79.5 against NLT 80.0 (does not conform) and against NLT 80 (refused). Neither ever rounds to 80.
- **Specification Sections.** A Specification Line is an Analyte, an NMT limit as written, and a USP-claim flag. Report-only lines, limit tests and multiple-nitrosamine rules are left out of the type, so the skeleton cannot hold them rather than refusing them at judging time. `judgeSpecification` takes every Preparation's results, judges each Preparation, then the mean rounded once, and returns `result-missing` rather than assuming a gate refused earlier. Each Reportable line carries `percentOfLimit`.
- **Calculation.** A weight of zero or less returns `weight-not-positive` rather than dividing, and a missing concentration surfaces as `result-missing` from the judgement, where the base threw.
- **Canonical content.** Beyond the type, the serialiser throws on a number, bigint or undefined that a cast smuggled in (it would otherwise have written `{}`), and on a string that is not well-formed UTF-16. Both are bugs upstream, never data.
- **Gates.** Gates no longer check the record's state; the machines own that. This is what lets `eligibleAnalysts` agree with `assignmentGate` on every row. The base `PersonFacts` is split into Performer, Verifier, Reviewer and Releaser facts, each holding exactly what decision 19 checks for that meaning. `isAdmin` is dropped, since the database refuses Admin with a business role (LI001). `GateResult` has no separate not-built variant: not-built is one reason among the others, so every failing reason is listed, and `specGapsOf(refusal)` names the spec_gap rows to write. `acceptanceGate` and `cancelGate` are added. Reviewed is one `reviewedGate` for a Test (with its feeding Runs) or a Run (with none).
- **Refusals.** `hash-mismatch` is dropped: the composite foreign key makes a signature to another hash impossible, and `stale-version` covers the prompt that showed an old version. `NotBuilt` gains the machines' not-built events, `split-performed-signing`, `anchoring` and `basis-correction`.
- **Statements.** The seven statements come from the chosen UI direction (`prototypes/ui-direction/gen-data.mjs`), not the base sketch's wording. `SIGNS_AS` names the roles each meaning signs under.
- **Tooling.** TypeScript 7.0.2 runs as pinned, with no fallback. vitest is 5.0.2, not the newest 5.0.3: 5.0.3 was published hours before this build, and pnpm 12's minimum-release-age policy refuses it. Relaxing a supply-chain policy for a test runner isn't worth it; move to 5.0.3 once it ages in. The vector table loads through Vite's `?raw` import, so the package needs no `@types/node`.

### `packages/domain`, after the USP review and #37's resolution

- **Variability between Preparations is judged.** The Method's variability limit is an Acceptance Criterion (#37 §1, §3) that names its statistic. The relative difference of a pair, `|a − b| / mean × 100 %`, is built, computed from the unrounded Preparation results and rounded once, half away from zero, to the limit's decimals, on every pair (decision 29). Any other statistic returns `variability-statistic` not built. A failing or missing variability result leaves that Analyte's Reportable Result `not-judged` in every Section and blocks Test Performed. Preparations are still judged on their own.
- **`judgeSpecification` became `judgeTest({ sections, preparations, variability })`** and `SpecificationJudgement` became `TestJudgement`, because variability is the Method's criterion, judged once per Test whatever its Sections. `SectionVerdict.conforms` became `outcome` (`conforms`, `does-not-conform`, `not-judged`), and a Reportable line is a `judged` or `not-judged` variant.
- **Share of the limit.** `percentOfLimit: Written` became `share: { percent: Rational; displayPercent: string }`. Bands and triggers compare the exact `percent` through `exceedsShare`. The one-decimal figure is text, so nothing can compare it by accident.
- **Criteria carry their source (GN 7.10).** `Criterion` has a `source`: compendial with its citation, a Method version, or an SOP version. A decimals mismatch carries it. For a compendial criterion the message says to set the export to the printed decimals and never suggests changing the criterion. For the lab's own, it offers either change.
- **Run Checks say how their value is compared (#37 §4).** `RunCheck` is `as-exported` (S/N, %Rec), whose typed value is `Measured` as exported, or `lims-computed` with a named statistic, which takes raw inputs and returns `computed-run-check` not built. `judgeRunCheck` produces the outcome, and `RunPerformedFacts.runChecks` carries `{ check, outcome }` instead of `verdict | null`.
- **GN 7.20's twelve illustration values** and −9.5 against NLT −9 are golden vectors, along with a non-terminating mean just below a tie and variability vectors at, just over and past the limit.

### U3 and U4: identity, the two doors, the commit pipeline and the Records module (`apps/api`, `packages/contract`)

The shared contract holds for every item below unless it says otherwise: two doors plus the fixed session endpoints, one `commit` pipeline over `runAudited`, `Records` with its operations, a kind register the sample chain plugs into, and full re-authentication producing a `ReauthenticatedSigner` that only `identity/reauth.ts` constructs.

- **A refusal is settled in the same transaction, not a second one.** The command body runs in a savepoint (`AuditedTx.attempt`); a refusal rolls the savepoint back, and the rows that must survive it (auth failures, the used TOTP step, alerts, spec gaps) plus the refusal outcome are written before the one COMMIT, still under the commit key's advisory lock. The two-transaction shape in "How data flows" had a window between the rollback and the settle in which a duplicate of the same attempt could run afresh and count a failure twice. The observable contract (a refused signing retried with its key returns the same refusal and moves the count by one) holds and is tested.
- **A commit key settles once per input.** `commit_outcome` is keyed by `(commit_key, input_hash)` with one receipt per key. A receipt with a different input is `commit-key-reused`; a refusal with a different input lets the corrected attempt run (the fable candidate's bug C1). The web app still mints a fresh key after every answer; this is the server refusing to make that a requirement for correctness.
- **Survivors are written as `svc:auth` in both paths** (`CommandTx.survive`, `AuditedTx.withContext`), so every access-log row has the same author whether the attempt succeeded or not. The subject of the row is its `person_id`. Success events (`login_ok`, `signing_ok`, `unlock_session`) are written by the command that knows what the success opened, and a session unlock also ends a run of failures (`lockout_state` changed in 0040).
- **Every command declares the company ledger.** Spec gaps and access-log rows live there, and a Lab-only transaction that locked the company head late could deadlock against one that locked both in id order. Throughput is bounded by the company chain, which the Tradeoffs section already accepts at demo scale.
- **Commands act under a declared `acting` rule**, not `actingAs: 'self'`: `nobody` (login, enrolment; runs as `svc:auth`), `locked-session` (unlock, takeover; runs as `svc:auth`, since the person cannot act in a locked session, LA009), `session` (the person's own session acts, audited under a primary role chosen by a fixed precedence), `role`, or `role-from-input` (signing, values: the role the meaning requires, chosen in the prompt and checked against `SIGNS_AS` and the person's grants). A service identity satisfies any active requirement, which is how the seed drives every command in-process.
- **A receipt has a `once` channel** for what is delivered with the first answer and never stored: the session cookie and the enrolment link. A replay returns the receipt without it, so no bearer token sits in `commit_outcome`.
- **Enrolment is two commands** (`identity.enrolStart`, `identity.enrolFinish`): the first mints and stores the secret encrypted on the link and returns the otpauth URI; the second checks the password rules, the live code (its step is consumed, purpose `enrol`) and sets the password hash and secret in one statement. The otpauth URI is the one response that carries a secret, to the enrolling person alone; the no-secret test covers every other response.
- **The breach check is a small bundled list**, not the Pwned Passwords range API the login research chose. The rule and its refusal exist; the source of the list is the thing to swap. Recorded as a spec gap.
- **The Authorisation and Training Record heads are built here** (U4 in the run todo), in their smallest shape: `authorisation` (Lab head, Approved by QA, valid range, suspension) and `training_record` (company head, the person's own Acknowledged). `register_signable_head` takes a ledger source for the company head. Acknowledged needs the Admin's identity check and nothing else; Approved on an Authorisation needs the QA role and the three enabling steps, and no Authorisation of its own, or the first QA could never be authorised. The enabling documents are `POL-ESIG@1` and `SOP-LIMS@1` until the documents module names them. Method-version training and the per-record facts are the sample-chain unit's, built on `records/facts.ts`.
- **`GET /files/:token` is not registered.** No blob store exists yet; the route enumeration test lists it as a fixed endpoint the next unit may add.
- **A View declares one scope kind** (`lab`, `customer` or `company`) and the actor's scope must match; an Admin does not read Lab views. View inputs are flat query strings parsed by the view's schema.
- **`Records.sign` re-derives the version to sign for every target** and compares it with what the prompt carried back; a difference is `stale-version` before any credential is consumed by a gate. The post-effect assertion from the fable design is kept: a signed version that no longer stands after its meaning's effects throws and rolls everything back.
- **Ids cross the wire unbranded** (`packages/contract` has no domain import, per the module map) and are branded once in `apps/api/src/wire.ts`. `packages/db/src/ids.ts` is gone; the db package imports its id types from `@lims/domain/ids` and keeps only the ledger facts the migrations install.
- **`migrate()` takes the owner role before it reads the ledger** (found by the deploy builder): `lims_migrator` is NOINHERIT, so a rerun on a migrated database failed with 42501 and a deployed stack could not restart. A test runs it twice and applies a late migration alone.
- **The sweeper is a function** (`sweepIdleSessions`) on a one-minute interval in `main.ts`; the idle-lock test proves the state is locked before it runs and that it writes exactly one `idle_lock` row afterwards.
- **`ActorContext` carries the Lab's code and zone** for the session DTO, and a `service` actor has an optional Lab so the seed can write Lab rows.

### Spec gaps found by U3 and U4

- Which role a person's own session actions (lock, switch user, logout) are audited under when they hold several (decision 13 records "role at the time"; a session has no acting role since U2). Assumed a fixed precedence: Lab Manager, QA, Reviewer, Analyst, Sample Custodian.
- Which Lab or Customer a sign-in opens when the person's grants span several (decision 22 says one at a time). Assumed the only one; otherwise the login must name it, and the client has no picker yet.
- The e-signature policy and LIMS-use training documents (decision 13 §1 step 2, decision 19 §7) have no identity until the documents module exists. Assumed `POL-ESIG@1` and `SOP-LIMS@1`, one LIMS-use document for every role.
- Who authorises the first QA to sign Authorisations Approved (decision 13 §1 makes Authorisations QA's grant). Assumed: the QA role and the three enabling steps suffice for that one kind.
- The password breach check's source (the login research chose the Pwned Passwords range API; the hosting decision keeps third-party calls out of the bench). Assumed a bundled list until decided.
- Names a password may not contain beyond the user ID and the person's name (decision 22 adds the company, a Customer or a Product); nothing stores the company name yet, and Customers and Products are the next unit's.
- Whether a wrong code after a right password reveals which part failed (decision 23 rule 6 logs every failure). Assumed one message for both, with the reason only in the access log.
- Whether a login on an already active session of another person ends that session as a takeover (sessions.md names takeover only from the lock screen). Assumed yes, with reason `takeover`.
- Who may turn a proposed Critical Data Change down, and whether the proposer may (decision 13 says nothing). Assumed anyone acting in the role who is not refused by a gate; the proposer included.
- Whether an unknown user ID's failures should report attempts left (decision 13 §3 counts failures per account). Assumed a count per typed ID that locks nothing.

### U8, deploy packaging (`deploy/`)

This design says nothing about packaging, so these entries record what `deploy/` chose against ADR 0002 and decision #34. The shared contract holds for all of them; the API's side of it is the runtime contract in `deploy/README.md`.

- **Three more Compose secrets.** ADR 0002 lists five. The database needs passwords once Postgres leaves trust auth, so `db_superuser_password`, `db_migrator_password` and `db_app_password` join them. Each container gets only the secrets it needs: the API gets `lims_app`'s, `db-init` the superuser's and the migrator's.
- **`db-init` sets the passwords as SCRAM verifiers.** `deploy/db/init.ts` calls `bootstrapRoles` and `migrate` from `packages/db`, and between them runs `alter role … password '<SCRAM-SHA-256 verifier>'`. The plaintext never reaches a server log. It also creates the database `lims` owned by `lims_owner`. The roles themselves stay defined only in `bootstrap/roles.sql`.
- **The password reaches node-postgres through pgpass.** `connectionFor` takes no password, so the image's entrypoint writes the granted secrets into a pgpass file on a tmpfs and sets `PGPASSFILE`. The API needs no change for it. node-postgres deprecates pgpass for pg 9; when the pin moves, `connectionFor` should take a password function instead.
- **Bug in `packages/db`: `migrate()` fails on an already-migrated database.** It reads `lims.migration` as the session user `lims_migrator` before `set local role lims_owner`, and `lims_migrator` is `noinherit` with no usage on schema `lims`, so the second run fails with "permission denied for schema lims" (42501). The test harness migrates each template once, so no test sees it. Deployed, `db-init` runs on every start, and the stack cannot restart after its first start. The fix belongs to `packages/db`: take the owner role before reading the ledger. `deploy/` doesn't work around it.
- **Caddy config is baked into the web image**, not mounted, so the image digest in the Release Log covers the proxy configuration. `Caddyfile.tunnel` and the inactive `Caddyfile.vps` share `site.caddy`.
- **cloudflared runs as a Compose service** under the `tunnel` profile, on the internal `edge` network plus an outbound-only network. So nothing is published on the Mac, not even on localhost. `compose.local.yaml` publishes Caddy on `127.0.0.1:8080` for a smoke test before the tunnel exists.
- **The mount check also confines secret and config files to the secrets folder.** It judges `docker compose config` output, so short and long syntax and `driver_opts` volumes are caught alike.
- **The build context is an allowlist** (`.dockerignore`), so the real exports folder cannot enter a Docker build, whatever it is called.
- **The scripts use Homebrew's Docker tools and their own Docker client config** (`~/.config/nitrosamine-lims/docker`), never Docker Desktop's CLI plugins or credential helper. Colima starts with `--activate=false` and mounts only the secrets folder.

### Spec gaps found by U8

- Where the first Release Log entry lives. The skeleton has no Release Log record kind. The runbook's default is a comment by the owner on #24.
- How the API learns the VM clock's sync state (ADR 0002 "Time": audited writes wait for sync within 1 s). chrony runs in the Colima VM, outside every container. `start.sh` checks it once at launch; nothing checks it while running.
- How a clock step becomes a System Incident. chrony logs steps in the VM, and nothing carries them to the company chain.
- The formats of the TOTP key and pepper. `secrets.sh` makes 32 random bytes, base64. Tokens and passwords are 32 bytes, hex.

### U8 after the Part 11 and ISO/IEC 17025 review

These entries close the reviewers' gaps on `6010acd..555453f`. The shared contract holds for all of them. The runbook in `deploy/README.md` holds the owner's side.

- **Approval before go-live (17025 7.11.2).** `start.sh --local` builds the candidate release and prints its release record. The record holds full image ids, the SHA-256 of `cloudflared.yml`, the tunnel id, the Colima, Compose and macOS versions, and the runbook's own commit. It also prints an approval line. The tunnel launch refuses unless HEAD appears in the owner-held `approved_releases` in the secrets folder, and unless the `api` and `web` image ids match that line. It never rebuilds (`--no-build`), so what goes live is exactly what the owner signed. Both starts run `pnpm check:deploy` first, and both refuse a dirty tree.
- **The data class is stored with the data (the real-data gate, #34).** `deploy/db/data-class.ts` keeps a marker and an append-only history on a new `state` volume. The first start records the class. `db-init` refuses any start that asks for a different class. It also refuses a start where the database exists but the marker is missing, so deleting the state volume can't reset the class. Only `deploy/mac/data-class.sh`, which requires a Release Log link, changes the class. `start.sh` reads the stored class and keys the FileVault check on it.
- **Operator logs: per-role `log_statement` stands in for pgaudit.** This is an interpretation of ADR 0002 "Operator logs", recorded here for the owner to accept. Postgres runs with `logging_collector` into `log/` inside the pgdata volume. It logs connections and disconnections with a prefix giving time, pid, user, database, host and application. `db-init` sets `log_statement = 'all'` on `postgres` and `lims_migrator`. The official image lacks pgaudit, and a custom image would be the first one not pulled by digest. What `log_statement` misses compared with pgaudit is object-level audit classes and statements run inside functions. The superuser's direct statements, the migrations and `pg_dump` are all logged. Passwords never reach the log, because `db-init` sends SCRAM verifiers. I checked that none of the three plaintext passwords appears in the log.
- **`stop.sh` stops and never removes by default.** `--down` removes the containers and networks after a warning. No script ever passes `-v`.
- **Backups by hand.** `deploy/mac/backup.sh` streams a custom-format `pg_dump`, a tar of the report store and a tar of the Postgres log directory, each through `age -R age_public_key`, to a folder the owner names. It refuses a folder inside the repo, the secrets folder (which the VM mounts), `~/.colima` or `~/.lima`. `--restore-check` checks `SHA256SUMS`, checks that both archives decrypt and read back, restores into a scratch database in the running cluster, runs `lims.verify_chain` on every ledger, and drops the scratch database.
- **Time.** chrony in the VM answers monitoring commands from the egress network, whose subnet is now fixed at `172.30.10.0/24`. The gateway `172.30.10.1` is the VM, and the API gets it as `LIMS_CHRONY_HOST`. `start.sh` prints chrony's step lines from the VM journal since the API last started.
- **Secret `uid`, `gid` and `mode` are gone from compose.yaml.** Compose 5.5 ignores them for file secrets outside swarm, and warns. It bind-mounts each file instead. My first U8 report said each container got its secrets with its own uid, and that was wrong. On the Mac, a container reads a secret because virtiofs checks the host file's mode as the owner. Owner-only is enforced by the host file (600 in a 700 folder), which `start.sh` checks. On a plain Linux VPS, the files will need owners the containers can read (spec gap below).
- **The api image creates `/var/lib/lims/reports` and `/var/lib/lims/state` owned by `node`.** Without that, a new named volume is root-owned, and the API couldn't write its report store.
- **Image hygiene.** `.dockerignore` excludes `**/.env*` and `**/*.tsbuildinfo`. I proved it with a control. In a scratch copy, `apps/web/.env.production` held `VITE_LEAK_PROBE`, and `App.tsx` rendered it. With the new rules, the probe was in neither the build context nor the bundle. With the rules removed, it was in both.
- **ZAP by hand.** `deploy/checks/zap.sh` runs the ZAP baseline container on the local stack's published network against `http://web`. It copies the report out with `docker cp`, so nothing is bind-mounted. The ZAP image is not pinned by digest yet, because pinning needs a registry lookup I was told not to make. The script prints the digest that ran, for the Release Log. I only dry-ran it.
- **Operator scripts share `deploy/mac/env.sh`** (socket, client config, compose command). `start.sh` keeps its own, because its compose files depend on the mode.

### Spec gaps found by U8 after review

- How the API reads chrony. The cmdmon protocol on UDP 323 is binary, so the API needs `chronyc` in its image (an apt install at build time) or a small client of its own. `LIMS_CHRONY_HOST` is only the address.
- A file-secret owner scheme for the VPS. Compose bind-mounts secrets with their host owner, so on Linux they must be readable by uids 1000 and 999 without being world-readable.
- Who runs the daily `backup.sh` while the Mac sleeps. The RPO rests on the owner, as a signed exception.
- The restore check restores into a scratch database in the live cluster. A drill on a separate host (ADR 0002's quarterly drill) isn't scripted.
- Where the report store's hashes are checked. The restore check proves that `reports.tar` reads back, not that each blob matches its hash, because `blobs.ts` isn't built.
- Whether a separate QA person's re-signing, the lapse condition for the two-role exception, happens in the app or on the Release Log.

### U5, the sample chain (`packages/db` migration 0050, `apps/api/src/chain`, `records/kinds/{reference,chain}.ts`, `commands/{reference,chain}.ts`, `views/chain.ts`, `seed/`)

The shared contract holds for every item below unless it says otherwise: one migration following the `40_sample_chain.sql` sketch and ADR 0002's ownership split, kinds that plug into the Records module with content builders citing children by `(id, hash)`, commands that load facts and call the domain's gates, machines and verdicts, and a seed that drives the real commands and signings.

- **A Customer writes its own rows into a Lab.** The sketch had `submission.submit` create Samples (Expected) and Tests (Requested) with `customer_id` on each, but the capture trigger refused any Lab row written outside that Lab (LA006), and a Customer's context has no Lab. Rather than a two-row Test (a company request row plus a Lab Test row), the Lab guard now admits an INSERT by a Customer context of a row that names that Customer, plus the bare `record` row a signable head needs; an UPDATE or a row naming another Customer is still LA006, each half proved by a mutant. A command may also declare its own read scope (`CommandDef.scope`), so the submit runs on a Lab-scoped handle while the audit context stays the Customer's; the entry on the Lab chain names the Customer User and the Customer acted for. `report.download` uses the same two mechanisms for its audited `report_download` row.
- **Specification Sections and Lines are in the version's bytes, not in tables.** A Section row could not reference a version that is sealed after it, so a Specification's structured data (Sections, Lines, limits as written, the Rule Set version per Section, the Acceptable Intake and source behind each line) is an identity `jsonb` column on the head, written once and sealed into the version unchanged, parsed by one zod schema at the wire and when read back. The same holds for a Method version's data (Analytes, calculation, replication, variability criterion, Run Checks with written limits and their source, prerequisite Documents). `section_verdict` names the Section by `(specification_version_id, jurisdiction)` and the Line by its Analyte.
- **The Test pins its Method version at Acceptance**, beside the Specification version: the Customer requests a Method, and the Sample Custodian's accept resolves the current Approved version (decision 36: a Test finishes on the version it was assigned under). Both are identity columns set once from null.
- **`section_verdict` rows are written when the Test is signed Performed**, in the meaning's `after` effect, from the same pure judgement the version's bytes carry; the design left the timing open. The rows reference the Test version and the Specification version and carry the Rule Set, the Calculation Version, the compared value, the limit as written, the share of the limit and each Preparation's comparison.
- **A signing rule receives the sealed attestation.** `SigningRule.check` gained a fourth argument, the sealed Review a Reviewed or Released signing cites, and `Records.sign` refuses a stale attestation as it refuses a stale target. Without it, no rule could read the checklist it is meant to enforce. The `after` hook takes `deps` as an argument (the report store and the release id), because a spread copy of the transaction handle is not the handle the door functions recognise.
- **Run Check values, the instrument, the sequence ID and the True Copy are Recorded Values on the Run** (fields `run.instrument`, `run.sequence`, `run.trueCopy`, `runcheck.value` with the check's name as subject), and a Test's typed entries are `prep.weight`, `prep.dilution` and `prep.result` with subjects `P<n>` and `P<n>/<Analyte>`. Every one of them needs a second person's Verified before Performed, the True Copy included; the seed's first attempt forgot the three the Run is created with, and the gate refused it.
- **The Review Checklists are constants** (`CL-RUN@1`, `CL-TEST@1`, `CL-RELEASE@1` in `chain/model.ts`) until the documents module versions them. A tick is a non-critical boolean Recorded Value; an untick is not built (it would be a change needing a Reason for Change, and the skeleton has no screen for it). QA's per-verdict confirmation is a text value with subject `<test id>/<Jurisdiction>`.
- **Download tokens are process state.** `GET /files/:token` consumes a 60-second single-use token from an in-memory map that the audited `report.download` command minted and returned in the receipt's `once` channel, so the GET writes nothing and no token is ever stored. The regulated fact is the `report_download` row.
- **The blob store lives in `packages/db/src/blobs.ts`** as the module map says, though it writes files: a stored file is named by its SHA-256, the `blob` row is written in the caller's audited transaction after the file, and a read rehashes the bytes so a corrupted file is never served as its hash.
- **The PDF is rendered from the Test versions' stored bytes** (the judgement inside them) plus the signature rows on the cited versions, inside the releasing transaction, with pdf-lib 1.17.1. It prints limits and results as the stored strings, each signature block with meaning, name, role, UTC and Lab-local time and the first 8 characters of the hash, and a "Fictional data" mark on every page. Its creation date is the Released signature's time.
- **`GET /files/:token` is registered** and the route enumeration test's fixed list already named it.
- **The seed keeps each person's first tab.** Every login spends a TOTP step, so the seed logs each person in once and reuses the tab; the Customer User acts for two Customers on two tabs. The Lab Manager also holds QA so a second QA person can sign the QA person's own Released Authorisations Approved (nobody grants their own); this doubling goes in the demo-exception record.
- **The seed refuses to run twice** on a database that holds a Customer, rather than reconciling; `--handover` runs on a seeded database and needs none of the seed's secrets, since `identity.reenrol` (Admin) revokes the password and secret, ends the person's sessions, and mints a new link.
- **Sizes.** Two Customers, four Products, two Methods, five Submissions, eight people: about 4 % of the #23 prototype's counts, well inside the 30 % cap; `chain.test.ts` fails if any count exceeds the cap.
- **Two Kysely deprecations** (`orderBy(array)`) were replaced by chained calls when the chain test printed the warning.
- **The LA006 mutant moved to migration 0050.** It edited `lims.capture()` in 0010, which 0050 now replaces, so the mutation never reached the running function and the mutant survived; it now edits the Lab guard where it lives. A mutant of a replaced function is a stale mutant the runner cannot detect, so a migration that replaces a guarded function must move its mutants.

### Spec gaps found by U5

- Which Lab a portal Submission goes to (decision 22 names no Lab on a Submission; the Price List is per Lab). Assumed: the Customer picks the Lab from the catalogue and the input names it.
- Whether a Customer may write Lab rows at all, or the Lab materialises them at Acceptance (decision 12 says Samples exist as Expected when the Submission is made). Assumed the former, limited to inserts of the Customer's own rows.
- Whether a Test without an accepted Specification can be accepted (decision 22 requires one only when a conformity statement is wanted). Assumed: every Test in the skeleton needs one, since every report states verdicts.
- The Review Checklist versions and their items (decision 20 §7 names the Test items; nothing names a Run's or QA's release items).
- Who approves the QA person's own Released Authorisations when the company has one QA (decision 19 §5: two QA people approve each other's). Assumed: the Lab Manager holds QA as well, as a demo exception.
- Whether replacing an authenticator through the handover repeats the Admin's identity check (decision 13 §1 says replacing a lost authenticator repeats step 1). Assumed not for the owner's own demo accounts; the check stays recorded.
- The unit of an S/N Run Check (a ratio; decision 36's catalogue names no unit). Written as `ratio`.
- The AI-derived limit's stated digits (decision 29 rounds down to the stated digits; nothing states them). The seed writes NDMA at 320 mg/day as `0.30` ppm.
- Whether a Reviewer may Return a Test that is Submitted for Review after the report is drafted (the report holds only Reviewed Tests, so the question does not arise in the slice).
- Whether `submissionState` should read a Rejected Submission when every Test was rejected at Acceptance and the Sample was never received. Assumed yes; the portal prints it.
- How the Reviewer unticks a checklist item (a change to a non-critical value needs a picklist reason). Not built; a tick stands.

### U6b: the web app's session and signing wiring (`apps/web`, `packages/contract/src/session.ts`)

The shared contract holds for every item below: the browser prints server facts, every read is a View, every change is a Command sent from an event handler with a commit key per attempt, and the session is the server's.

- **A session refusal is recognised by its kind, not its status.** sessions.md says any 401 or 423 makes the client ask `GET /api/session` again. The API also answers 401 for a wrong credential (`credentials`) and 423 for a locked-out account (`locked-out`); treating those as a lost session would pull the lock screen over a signing prompt that should print the refusal. The client asks again only when the refusal's kind is `session` (and when `POST /api/session/activity` answers 401 or 423). Contract holds.
- **No query client; cached record data is structural.** Record data lives only in the state of the screen that read it, under a subtree keyed on the session epoch. A lock, a switch of person or an unlock unmounts it, so nothing read survives; there is no `queryClient.clear()` to forget. Views send `cache-control: no-store`. Contract holds.
- **The locked session answer names more.** `GET /api/session` in the locked state now also gives the owner's native-script name and roles, `lockedAt` (the stamp, or the idle deadline for an idle lock), the Lab's zone and the workstation, because the LockScreen names them without any other read. `apps/api/src/actor.ts` and `doors.ts` changed; the type is `SessionAnswer` in `@lims/contract/session`, which narrows `SessionDto`. A test covers it (`apps/api/test/contract.test.ts`).
- **Four server rules are copied into the contract**: `SIGNS_AS` (the prompt opens `signing.prepare` under a role the person holds), `STATEMENT` (the SignatureLine), the change-reason picklist and the password-rule sentences. The web may import only the contract, so each copy has a parity test against the server's own definition in `apps/api/test/contract.test.ts`.
- **Navigation between screens is a page load.** There is no client router: each nav link loads the page, which asks the server first like every load (rule 1 by construction). The path is only a destination; SignIn prints it by its route title.
- **The idle lock looks 2 seconds after the server's deadline**, and if the server still answers active for the same deadline (the browser's clock ahead of the server's), the tab looks again after 5 seconds instead of looping. The clock skew comes from the HTTP `Date` header, to the second. Real input posts activity at most once a minute and then asks for the new deadline, since the activity endpoint answers 204 with none.
- **Presentational changes from U6a**: `EligibilityAnswer.authorisation` may be null (Acknowledged on a Training Record needs no Authorisation); the Critical Data Change dialog takes `requiresApproval`, false for a non-critical field whose change needs a reason but takes effect at once; the Audit Trail panel omits an empty username; the Fictional data banner is never hidden, and the header wraps to two rows under 600 px (#34). A test fails if any stylesheet hides `.fict`.
- **`no-command-in-effect` is a source scan** (`src/structure.test.ts`): it fails if the body of any `useEffect`, `useLayoutEffect` or `useInsertionEffect` calls `.run(`, `.command(` or names `/api/commands/`, and a second test proves the scan finds a planted one.
- **The end-to-end run uses a dev-only record bench** (`src/dev/bench`, `/dev/bench?parent=`) over the API tests' `widget` kind, because the sample chain's Test screens don't exist yet. It hosts the wired Recorded Value field, the signing prompt, the SignatureLines and the inline Audit Trail; `bundle.test.ts` fails if its marker reaches a production bundle. `apps/api/test/e2e-server.ts` starts the API on a cloned test database with the signing cast enrolled through the real commands, and `pnpm --filter @lims/web e2e` runs Playwright against it and the Vite dev server. It is not part of `pnpm test`, because the TOTP waits make it take about 90 seconds. The harness `Authenticator` gained `lastUsedStep()` so the browser's phone never reuses a step the setup spent.
- **The enrolment link carries its token in the fragment** (`/enrol#<token>`), which the browser never sends to a server, a proxy log or a referrer. The page shows the otpauth URI only as a QR code drawn in the browser (`qrcode-generator` 2.0.4, no dependencies); the secret is never printed.
- **The workstation's name is the PC's configuration**: `localStorage['lims.workstation']`, set with the bench PC's setup (rule 3), else "Unnamed workstation". It names the PC, never a person, so it is the one thing the browser keeps.
- **A commit key rotates after every answer, including no answer.** If the network drops a response after the server committed, the person's retry is a new attempt with a new key. The sheets refuse to send a key twice (U6a), so keeping the key would leave the button dead. See the spec gap below.

### Spec gaps found by U6b

- The data class is not exposed by the API: `config.ts` does not read `LIMS_DATA_CLASS` and no endpoint returns it, so the banner prints "Fictional data" as a constant (#34, ADR 0002 "The real-data switch").
- `record.audit` returns raw column captures: `bytea` as hex, ids as uuids, table names rather than record labels, and no username. A Recorded Value's typed text is filed under its version's id (`recorded_value_version` registers `version_id` as its record column), so the value's own trail never shows the value (decision 23 rule 12, "who with role, old → new value"). The panel prints what the view gives.
- `signing.standing` carries no record label, Lab or statement; the web takes the statement from the contract copy and the Lab from the session (rule 10).
- No view lists the Labs, so the Admin screen takes a Lab ID typed or pasted (decision 13 §3).
- No view gives a record's Recorded Values with their field register (unit, critical); the field takes both as props from its screen, and the bench can't show a saved value's text after a remount.
- Where a workstation's name comes from. `session.login` requires one; decision 23 rule 3 records the workstation configuration but not how the browser learns it.
- The signing role when a person holds several that may sign a meaning. The RATIONALE says "chosen in the prompt"; the prompt signs under the first role the server calls eligible and offers no picker.
- Signing out. The rail offers Switch user and Lock only (decision 23), so a session ends by takeover or its 12-hour end; `session.logout` has no button.
- A lost response after a commit, retried. The server replays a key, but the client rotates it; whether the sheets should keep the key after no answer is undecided (rule 25).
- Enrolling without a camera. The page shows the QR code only; whether the secret may also be shown as text for manual entry (standard in authenticator apps) under rule 2 is undecided.
- The enrolment page prints the server's password-problem sentences as the rules, so the breach rule reads as a refusal ("That password appears in a published breach").

### U6c and U7: the sample-chain screens, their API additions and the walkthrough (`apps/web/src/screens/{chain,portal}`, `apps/api/src/{records,views,chain/steps.ts}`, `apps/web/e2e/walkthrough.spec.ts`)

The shared contract holds for every item below unless it says otherwise: every read is a View, every change is a Command from an event handler, the server computes every verdict, eligibility, step and hash, and the browser prints them.

- **`record.audit` reads as a person reads it.** It returns the record's entries and every descendant record's (by `record.parent_id`, so a Test's trail shows its Recorded Values), the rows filed under their versions (a value's typed text, a turned-down proposal, a stored verdict) and the signature rows, which the capture trigger files under no record and the view finds by their key. Each entry names the person with username and role, the record by its kind's label, each field by name with old -> new as text, and the Reason for Change in words; stored bytes, hashes of content columns and internal ids never print, and a person column prints the name. No migration was needed: the value's text is reached through its versions, so `recorded_value_version` keeps `version_id` as its record column. The panel gained filters on person, action and Lab date beside search and sort. Contract changed: `AuditEntryDto` is the readable shape; the one caller outside the panel (the dev bench) now reads `record.values`.
- **The field register names its fields.** `FieldSpec` gained `label`, and `fieldLabel(spec, subject)` prints "P1 weight", "P1/NDMA result", "Run Check S/N at LOQ standard". The value kind's label is "P1 weight on Test RD-S-…", which the prompt, the standing, the trail and the gate reasons all use. A View's `read` receives the kind register as a fourth argument so views can print labels; it still reads only through its READ ONLY handle.
- **`valuesUnder` moved to `records/values.ts`**, beside `record.values`, `valueDto` and `shownValues`, because it reads only the Records tables and the core views need it without the chain.
- **What the signer sees.** `signing.prepare` lists each record's own Recorded Values with who recorded each version and when, and the attestation's label and values (every checklist tick and verdict confirmation, with who made it). A `ref` value prints its Equipment's code, the only thing a ref field names today. The web's `LISTERS` gained `test@1` (each Run Version's id and hash, rule 13, and each Section's Reportable Result against its limit as written), `run@1` (instrument and Run Checks, with the True Copy as a source file) and `test_report@1` (each Test Version).
- **`signing.standing` carries the record's label, its Lab code and each signature's statement**, so `signaturesOf` no longer takes them from the screen or the contract copy.
- **The data class is configuration.** `LIMS_DATA_CLASS` is read at boot (default `fictional`); `real` refuses to start because #34 requires live anchoring and anchoring is not built. Every session answer carries `dataClass`, and the header, sign-in and lock screens print the banner from it.
- **A sign-in for several Lab or Customer grants asks which one.** After a correct password and code the server answers the new refusal kind `choose-place` with the Labs and Customers the grants span; the sign-in screen lists them and the next attempt, with the next code (the first step is spent), names the one chosen. This closes U3/U4's gap "the client has no picker", which blocked the demo's Customer User, who acts for two Customers.
- **The step model is the server's** (`chain/steps.ts`): Accepted, Received, Assigned, Run, Performed, Reviewed, Reported. The first step not done is current; it reads Blocked with every reason in words when something stops its next act: a failing Run Check (naming that the Deviation workflow is not built, so no Run Check Failure Deviation ID exists), an unrecorded Run Check, unverified values, pending changes, a Run changed after signature, a variability failure, a Hold on the step, or a rejection at Acceptance with its reason. The queue and every Test screen print it, and the rail refuses the blocked act with the same words (rule 15).
- **The judgement the Test screen prints is the live judgement of the current values** (`judgementDto`): grouped by Section, each Preparation's result and the Reportable Result at full precision (labelled, cut at 10 decimals with an ellipsis, never rounded, by the new domain `fullPrecision`), beside the value rounded once and the limit as written, with the share of the limit per Preparation and for the mean. While Performed does not stand on the current version every verdict reads Provisional and Conforms never shows; once it stands the live judgement is the signed one, since a changed value would unsign the version, and the stored `section_verdict` rows remain the record reports use.
- **The assignment view answers for every Analyst.** `AssignmentDto.eligible` became `candidates`, each with the gate's answer and its reasons in words; the screen offers only the eligible and lists the others refused.
- **The demo seed's cast changed.** Ann also holds Reviewer, with Reviewed Authorisations on both Methods, and Bob also holds Analyst with no Performed Authorisation, still eight people. The demo can then show the assignment gate refusing an Analyst and the Reviewed signing refusing a Reviewer who performed the work (decision 19). The demo-exception list is unchanged.
- **The PDF's Lab-local time** is formatted from `en-US` parts, which name US zones by their abbreviation (EDT, EST) as rule 9 asks; `en-GB` printed "GMT-4".
- **Screens and routes.** Routes take `:id` segments (`/tests/:id`, `/review/run/:id`, `/review/test/:id`, `/reports/:id`); navigation is still a page load. Staff land on the queue; a Customer User's session lands on the portal (a new `customer` audience); the Admin's person form picks the Lab from the new company-scope View `admin.labs`. The rail gained Sign out (`session.logout`). Commit buttons in the reading plane take the light surface; they were styled for the bench only.
- **QA's verdict confirmations are filed under the Test's label and Section** (`verdictSubject`, "Test RD-S-…/T1, FDA Section"), not the Test's id, so the release prompt says which verdict each confirmation is for. The web matches the same subject; the walkthrough pins the seam.
- **A reload keeps the View's data on screen** (`useView`): reading the same query again leaves the last answer in place until the new one arrives, so saving one value no longer remounts the fields around it mid-entry. A new query, a lock or a switch of person still starts from nothing (rule 1).
- **Two commands from one press.** Creating the typed Run sends `run.create` and then, on its receipt, `run.linkTest`, each with its own commit key. A failure between them leaves an unlinked Run that the Analyst can see and link; the design has no single command for both.
- **The walkthrough** (`pnpm --filter @lims/web e2e` runs it after the session spec, from its own Playwright config) seeds only reference data and people through the real commands (`apps/api/test/e2e-chain-server.ts`) and drives every chain step through the UI, each person at their own browser context. The Vite dev server now forwards the file door (`/files`) as well as `/api`.

### Spec gaps found by U6c and U7

- What "Provisional" covers before a conditional Decision Rule exists (decision 29 ties it to guarded acceptance). Assumed: every verdict on a version that Performed does not stand on reads Provisional.
- How many digits a full-precision value prints (rule 22 says "labelled as such"). Assumed: up to 10 decimals, cut with an ellipsis, never rounded.
- The rounding of the share of the limit per Preparation (decision 29 gives it for the mean). Assumed the mean's: one decimal, half away from zero, display only.
- The Decision Rule in the Section heading (rule 22): the Specification stores none yet, so the heading prints the Jurisdiction, Specification version and Rule Set only.
- The steps a Test's step bar shows and which blockers belong to which step (rule 15 lists blockers, not steps). Assumed the seven above.
- Which values a second person signs Verified in one group: assumed every unverified value on the Test and its Run, with any pending change.
- Whether a Reviewer who performed the work may open a Review record at all; the refusal comes at signing, before credentials.
- The time zone a Customer's portal prints: a Customer session has no Lab, so the browser's.
- A Sample's receipt is not in the Test's Audit Trail: the `sample` table is registered with no record column (decision 13 names the record's trail, not the Sample's).
- Choosing a Lab or Customer at sign-in spends the first code; whether the choice should come before the code (decision 22 says one at a time, nothing about when).

## Open questions and risks

- **Recorded Value as a glossary term.** Should "Recorded Value" enter `CONTEXT.md` ("One typed or chosen value on a signable record, with who recorded it and when; the unit of Verified signing and Critical Data Change")? Or does an existing term fit that I missed?
- **Reason for a workflow transition.** Decision 13 says a status change needs a picklist reason. Is the workflow action itself (for example "Received") an acceptable picklist entry, as this design assumes with `reason: { kind: 'action' }`? Or must a person pick a reason for ordinary transitions?
- **Weights without a balance.** The slice types Preparation weights from a printout with no balance recorded. Rule 23's hard limits (smallest net weight, balance In use, before-use Check) can't be evaluated. Should the skeleton add the balance as a Recorded Value on each Preparation and log Refused Entries, or record this as a spec gap on the map?
- **Run Check values and decision 38.** Do typed Run Check values follow the Unconfirmed Value retype rule (which decision 38 scopes to readings and Check values), or only the Verified-per-value rule used here?
- **Who approves a result correction after Performed.** Decision 13 says the Reviewer signs Approved, and decision 19 lists Approved as a QA meaning. This design lets a Reviewer with a Reviewed Authorisation on the Method sign Approved on a value version. Confirm, or name the Authorisation it needs.
- **Released SoD reach.** Does "never someone who performed or reviewed any Test in it" include the signers of the Runs feeding those Tests? This design says yes, which is the stricter reading.
- **Company chain contention.** Every login and signing locks the company chain head. That is fine at demo scale, and it becomes a bottleneck with three QC Labs. When they join, should auth events move to per-Lab chains?
- **Risk: `jsonb::text` inside `append_audit`.** The trigger builds entry text with `jsonb_build_object(...)::text`. That is deterministic today, and it is safe because the bytes are stored and never rebuilt. A reviewer might still prefer an explicit fixed-order concatenation.
- **Risk: the scope plugin.** A Kysely AST transformer that misses one node type (a subquery in a CTE, say) leaks a Lab. The seam test must include CTEs, subqueries, joins and `selectFrom` of a view, and the type split carries most of the load.

## Next implementation step

Write `sql/10` and `sql/20` as real migrations and make test-plan items 1 to 9 pass against PostgreSQL 18 as `lims_app`, before any TypeScript beyond `packages/db/audited.ts`. Those are the one-way doors, and everything else is replaceable.
