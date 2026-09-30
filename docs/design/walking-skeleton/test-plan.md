# What to test first

The order is by how expensive the design is to change. The database-level one-way doors come first, then the pure rules, then the pipeline, then the chain end to end. Each test names the defect it catches. Everything in part A runs against a real PostgreSQL 18 in CI, as `lims_app`, never as a superuser (except to simulate tampering).

## A. The database refuses what the design says it refuses

1. **Insert-only holds.** As `lims_app`, run UPDATE, DELETE and TRUNCATE on `audit_entry`, `signature`, `record_version`, `recorded_value_version` and `auth_event`. Each must fail with LA008 or a privilege error. The defect this catches is a grant or a trigger forgotten on one table. The grant-audit query runs in the same job.
2. **No context, no write.** An INSERT into `test` with no `lims.ctx` fails LA001. A context missing a reason fails LA002. A context with `reason_code = 'other'` and no text fails LA003. A context naming a role the person doesn't hold fails LA004.
3. **Capture is complete.** One UPDATE of two columns on `test` writes exactly one audit entry. That entry has both `[old, new]` pairs, the release, the session and a DB-clock time. A no-op UPDATE writes nothing.
4. **Chains under concurrency.** 50 concurrent audited transactions across two Labs and the company give gapless `seq` per ledger. Every `prev_hash` links, `at` never decreases within a ledger, and there is no deadlock. Then a superuser edits one `entry_bytes`, and `verify_chain` reports the first break at that seq.
5. **The signature binds to stored bytes.** Inserting a `signature` whose `content_hash` differs from its version's stored hash fails on the foreign key. Changing a version's `content` is impossible (item 1), so no signature can point at content it didn't see. A signature whose signer isn't the audit context's person fails LS000, and a version's `created_by` is always the context's person, whatever the app passed.
6. **Lab scoping in the database.** Writing a `test` row with `lab_id` of Lab B while `acting_lab_id` is Lab A fails LA006. Writing to a ledger not declared in the context fails LA005.
7. **ADR 0001 in SQL.**
   - A second version of a critical Recorded Value is pending, so `effective_version` still returns v1.
   - The proposer's own Verified signature on it fails LS001, and the typist's Verified on any version fails LS002.
   - Another person's Verified makes v2 effective.
   - The same flow for a non-critical value (`run.sequence`) makes v2 effective at once.
8. **Release lock.** After a Released signature and its `record_lock` rows, a new version of the Test, of any of its Recorded Values, or of the report is refused (LR001). An UPDATE of the Test's pinned Specification column is refused (LR002).
9. **Admin exclusivity.** Granting Admin to an Analyst fails LI001, and so does granting Analyst to an Admin.

## B. The pure rules

10. **Verdict golden vectors (ADR 0006, GN 7.20, decision 29).**
    - 0.0549 against NMT 0.05 conforms, and against NMT 0.050 it doesn't.
    - An exact +0.105 % rounds to 0.11 (half away from zero).
    - 0.105 under half-even rounds to 0.10.
    - An instrument-rounded 79.5 against NLT 80 fails and is never rounded to 80.
    - A criterion coarser than the export decimals returns `criterion-coarser-than-export`.
    - Recovery 80.0–120.0 at 79.96, 79.95 and 120.04.
    - A trailing-zero limit.
    - A mean of three Preparations that doesn't terminate in decimal, rounded once.
    Each vector is a row in one table the USP expert can read.
11. **Gates as truth tables.** For `assignmentGate`, each of the four decision 19 conditions is missing alone and then all together. It must return every reason, and `eligibleAnalysts` must agree with the gate on every row. `releasedGate` gets the same treatment for each SoD rule.
12. **Machines.** Every event is tried from every state for every actor. Only the table's cells succeed, and no transition targets a state outside the type.
13. **Canonical bytes.** The type forbids numbers (a compile-fail test). Key order is stable and the output matches RFC 8785 vectors for strings.

## C. The pipeline

14. **Commit once.**
    - Two concurrent requests with one key give one effect. The second waits and then returns the first receipt with `replayed: true`.
    - The same key with a different input returns `commit-key-reused`.
    - A refused signing retried with its key returns the same refusal, and the failure count moves by one, not two.
    - If the process is killed between the command's writes and COMMIT, the retry with the same key runs once and succeeds.
15. **GET never writes.** Every registered View is run while `pg_stat_xact` counters are captured, and no row may be inserted or updated. A View body that tries an UPDATE fails with 25006. A test enumerates the Fastify routes: every non-GET route is under `/api/commands/` or is one of the three fixed endpoints.
16. **Scope seam.** A company-scope handle naming `test` throws `ScopeViolation`, which is the test ADR 0002 asks for. A Lab A view never returns Lab B rows, seeded in both Labs. A customer handle can name only `portal_*` views.
17. **Signing refusals.**
    - A typed user ID that isn't the session's returns `wrong-user`, writes an alert, and leaves both people's counts unchanged.
    - Five failures mixing login and signing lock the account, and an alert is written.
    - A reused TOTP step returns "Wait for the next code".
    - A hash the prompt showed but that is no longer the version to sign returns `stale-version`.
    - Reviewed without its checklist attestation is refused.
18. **Idle lock.** With a session whose last activity was 16 minutes ago, `GET /api/session` returns `locked` and a View returns 423, even though the sweeper hasn't run. Polling a View every 10 seconds for 16 minutes doesn't prevent the lock.

## D. The walking skeleton, end to end

19. **API-level chain.**
    - The seeded people drive one Submission through every step in `ticket-24`: submit, accept, receive (then Ready), assign, start, record typed Run values, Verified group signing, Run Performed and Reviewed, Test Performed, review checklist and Reviewed, report draft, QA Released, and download.
    - Assertions: the downloaded PDF's SHA-256 equals `report_issue.pdf_sha256`. `verify_chain` is intact for both ledgers. Every Test carries its Run Version's id and hash. Every signature standing is `signed`.
20. **The UNSIGNED path.** After Run Performed, a Critical Data Change is proposed on one Run Check value, and the Reviewer approves it. The Run's Performed signature then shows `changed-after-signature`. The Test's version, which cites the old Run Version, stops standing too, and the Test's Performed gate refuses until the Run is signed again.
21. **The not-built path.** A failing Run Check value saves. Run Performed is refused with "Deviation workflow not built in the skeleton", and one `spec_gap` row is written.
22. **Browser (Playwright, after 19–21 pass).** Deep link before sign-in. Lock unmounts records and clears the cache. Takeover ends the other tab's session. A double tap on "Sign … as Performed" during the sheet's closing animation leaves one signature row.
