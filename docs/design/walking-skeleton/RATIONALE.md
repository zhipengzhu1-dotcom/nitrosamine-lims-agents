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
- **Branded ids live in `packages/db/src/ids.ts` for now**, with `COMPANY_LEDGER` and the `SERVICE` identities. When `packages/domain/ids.ts` lands, `db` imports from it and this file goes.
- **The scope plugin refuses raw SQL** as a root query and in FROM or JOIN position, aliased or not. The door functions are typed wrappers that run on the unscoped transaction held in a WeakMap keyed by the write handle, so the API never writes SQL text.
- **The chain link** is `head = sha256(prev_head || sha256(entry_bytes))`, and `entry_bytes` includes `prev_hash`, so each entry commits to its position. `verify_chain` checks entry k against entry k+1's `prev_hash` (or the head), which names a tampered entry at its own seq.
- **`session.acting_role` is dropped.** The role is chosen per command and carried by the context; the session holds the Lab or Customer it was opened for. **`account`** is included though not in the unit's list, because `lims.sign` needs the username.
- **Commit attribution** names the model that wrote the commits (Claude Fable 5.1), not the one the builder contract assumed.
- **`erasableSyntaxOnly`** is on in `packages/db`, so Node 24 can run any file in the package without a build step.

### Spec gaps found by U2

- Who registers an app release (decision 13 stores the release id on every entry; nothing says how a release comes to exist). Assumed: the API inserts its own id at boot.
- Whether a service identity may write any Lab's rows without acting in a Lab (decision 13 names service identities but not their reach). Assumed yes; LA006 exempts `svc:%`.
- Whether an Admin's session has a Lab. Assumed none, and Admin's context has no Lab.
- Which meanings approve a pending value version. The sketch's `Verified` or `Approved` is kept (decision 13 says Reviewer signs Approved after Performed).
- Turning down a proposal (`version_rejection`) is an audited, unsigned action like a Return (decision 13 does not say).
- Whether a transaction from an idle session (15 minutes) is refused in the database as well as with 423 at the API. Assumed yes.

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
