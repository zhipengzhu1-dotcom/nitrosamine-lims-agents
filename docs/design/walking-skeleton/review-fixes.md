# Compliance review of the core: findings and dispositions

The `part11-expert`, `iso17025-expert` and `usp-expert` reviewed `origin/main..9f5db9f` (`packages/`, `apps/api/`, and the web session and signing code). Deploy packaging was reviewed separately, and its fixes are in `deploy/`. Each finding below has one disposition:

- **Fix**: built and tested in the fix units.
- **Refuse**: the feature is outside the skeleton, so the server refuses with the domain's `notBuilt` reason and writes a `spec_gap` row, instead of letting it through.
- **Exception**: a demo exception the owner signs at go-live, with its lapse condition, listed in `deploy/README.md` step 5.
- **Map**: a question for the owner, recorded on the map when #24 closes.

## Units

The fixes run as six small units in three waves, each in its own worktree, each reviewing its own diff with the experts that apply before it reports (`BUILDER.md`, "Size and delegation"). Units in a wave touch disjoint files. The Unit column in the table below names the unit.

| Wave | Unit | Fixes | Migrations |
|---|---|---|---|
| 1 | **S1** database guards | 2, 17, 20, 21, and a per-service table allowlist (S2's review) | 0060–0064 |
| 1 | **S2** identity and pipeline | 3, 18, 19, 22, 23, 27 | none |
| 1 | **C3** reference data | 7, 9, 10, 13 (schema and acceptance), 14, 15, 16 | 0070–0074 |
| 2 | **C1** results integrity | 1, 6 (calculation), 8, 11, 12, 25, 26, 30–33 | 0080–0084 |
| 2 | **C2** writer rules, failure holds and the trail | 4, 5, 6 (unit check on record and change), 28, 29 | 0090–0094 |
| 3 | **C4** the report PDF | 24, 13 (printing the Decision Rule and limit source) | none |

Every unit appends its database guards to `packages/db/scripts/mutants.ts`.

## Fix

| # | Finding | Source | Unit | What is done |
|---|---|---|---|---|
| 1 | A Test with no Run linked can be Performed, Reviewed and Released | usp 2, iso 1 | C1 | `loadTest` counts a missing Run; Performed, Reviewed and Released refuse without one; a chain test proves it |
| 2 | The release lock is bypassed by approving or rejecting a version of a locked record | part11 G1 | S1 | `signature_guard` raises LR001 for Verified or Approved on a locked record or its parent; a BEFORE INSERT trigger on `version_rejection` requires a pending, unlocked target; `releasedGate` refuses while any cited value has a pending change; mutants for each |
| 3 | `commit_outcome.input_hash` is an unsalted SHA-256 of the password and TOTP | part11 G2 | S2 | HMAC-SHA256 with a server key over the input with credentials removed, plus a keyed verifier for the credentials so a corrected retry still runs |
| 4 | Anyone in the Lab may write any Recorded Value, including another person's checklist ticks and QA's verdict confirmations; values change under Tests in any state | part11 G3, iso 2 | C2 | each field spec names its writer and the parent states it may be written in: Review fields only by the reviewer and never after a signature cites the Review; Test fields only by the assignee while In Progress; Run fields only by the acquirer while the Run is open. The gates count only ticks and confirmations authored by the signer |
| 5 | A failing Run Check or Preparation can be corrected into a pass with nothing on the record | iso 3 | C2 | the `spec_gap` row carries `record_id`; the same settle opens a Hold (source `deviation-workflow`) on the Test or Run that blocks Performed; nothing can release it until the Deviation module exists, so the work stays halted |
| 6 | Units are not checked; dilution and concentration may be zero or negative | usp 3, part11 G6 | C1, C2 | a value whose unit differs from the field spec's unit is refused, and so is a change of unit; `calculatePreparation` refuses a dilution volume ≤ 0 and a negative concentration |
| 7 | The AI-derived limit is typed and never checked against the Acceptable Intake and maximum daily dose | usp 1 | C3 | the Specification command computes AI ÷ MDD exactly and refuses a version whose limit differs from it truncated to the limit's written decimals; `basis` is required on a nitrosamine line |
| 8 | The Reportable Result averages however many Preparations exist | usp 5 | C1 | the Method's Preparation count is exact: `preparation.create` refuses beyond it and `loadTest` flags any other count |
| 9 | An in-house Method is adopted as `verified` | usp 6 | C3 | the Adoption's Approved check allows `verified` and `verified-basic-compendial` only for a compendial basis, never `verified-basic-compendial` with nitrosamine Analytes; the seed adopts the LC-MS/MS Method as `validated-here` |
| 10 | The S/N Run Check cites `<621>` without the Method's S/N settings | usp 4 | C3 | the seeded criterion cites the Method version, which is the right basis for an in-house Method |
| 11 | A Run Check verdict does not record its Calculation Version | usp 8 | C1 | the Run's canonical content carries the calculation version, the value compared and the bound for each check |
| 12 | Preparation weights record no balance | usp 7, iso 5 | C1 | each Preparation records a required `prep.balance` equipment reference, checked In use at Test Performed like the Run's instrument, and carried in the Test's content |
| 13 | The report states conformity with no Decision Rule and no limit source | iso 4 | C3, C4 | a Decision Rule per Section (simple acceptance with its wording) is part of the Specification version the Customer accepts; the PDF prints it and each line's limit source |
| 14 | The Lab Manager doubling as QA signs more than its purpose | iso 6, part11 point 5 | C3 | the seed signs Specifications as the QA person; the server refuses a Released Authorisation to anyone holding Lab Manager in the same Lab |
| 15 | Review Checklist items differ from decision 20 §7 | iso 7 | C3 | items aligned with §7 for typed entry, and a test pins each version's items |
| 16 | A Training Record at level Demonstrated counts without a Training Run; Authorisations run past 12 months | iso 8 | C3 | Demonstrated refuses as not built; a Method Authorisation's validity is capped at 12 months; seed dates fixed |
| 17 | The Customer write guard admits more than the design claims | iso 9, part11 G9 | S1 | `customer_own` allows only `record` rows of kind `test`, a `sample` Expected with no number or receipt, a `test` Requested with no pins, number or assignee, and a `report_download` naming the context's person; a mutant for each |
| 18 | Re-enrolment keeps the old identity check | part11 G4 | S2 | `identity.reenrol` clears the identity-check columns, so signing stays off until the Admin records a new check; `--handover` refuses unless the data class is `fictional` |
| 19 | `svc:seed` stays a permanent all-role identity | part11 G7 | S2 | the seed revokes its own grant when it finishes; `holdsRole` checks a per-service allowlist of commands instead of granting every role |
| 20 | Re-proposing a rejected value records nothing | part11 G8 | S1 | `seal` compares against the latest non-rejected version |
| 21 | The database can't prove a signing re-authenticated | part11 point 1 | S1 | `lims.sign` requires a `totp_step_used` row for the signer with purpose `signing`, written in the same transaction |
| 22 | An unmapped error after re-authentication rolls back the used TOTP step | part11 point 3 | S2 | the survivors are written in a `finally`, so a thrown error keeps the step used |
| 23 | Seed sessions look like a bench PC | part11 point 6 | S2 | the seed signs in on workstation `seed-script` |
| 24 | The PDF lists Preparations from live facts, not the sealed bytes, and throws on a non-Latin name | usp, iso 7.8.2.1 | C4 | the PDF renders only from the sealed report content, with an embedded Unicode font |
| 25 | `section_verdict` is written from a second load, not the sealed body | usp | C1 | written from the sealed body, with `rounding` and `usp_claim` columns |
| 26 | A decimal schema accepts `010` and `00.30`, which crash later | usp | C1 | the zod schemas refine with `parseWritten` |
| 27 | A stale version is detected only after credentials are consumed | part11 point 2 | S2 | the version check runs before re-authentication |
| 28 | After a proposal is turned down, the Audit Trail shows the rejected value as the next change's old value | iso 7.5.2, part11 §11.10(e) (screen review) | C2 | `trail.ts` restores the last effective text on a rejection; a test covers change, rejection, change |
| 29 | A Sample's receipt is in no trail a Reviewer or QA sees | part11 DI Q7, iso 7.4 (screen review) | C2 | the Test's trail includes its Sample's entries, labelled "Sample receipt" |
| 30 | A Section heading names one rounding rule for lines rounded by different rules | usp GN 7.20 (screen review) | C1 | rounding is carried and printed per line |
| 31 | The step bar shows a Run Check the server can't judge, or a Hold on an earlier step, as current while the server refuses | usp `<621>`, iso 7.10.1 (screen review) | C1 | the step's reasons come from the domain gate's own reasons, so screen and server agree; the three unjudgeable kinds get words |
| 32 | Each Preparation row reads "Conforms", which can contradict the Reportable Result | usp GN 7.20, interpretation (screen review) | C1 | the column reads "Individual vs limit (for information)" |
| 33 | The step model falls back to the unit ppm when it can't find the Specification line | usp (screen review) | C1 | it refuses instead of inventing a unit |

The Audit Trail showing a Test's descendants and a value's own text (part11 G5), and the prompt showing an attestation's body (part11 point 2, G3), are in the chain-screens unit.

## Exception (the owner signs these at go-live)

| Finding | Source | Lapses when |
|---|---|---|
| Equipment is registered straight to In use, with no qualification step | iso 5 | the equipment module is built |
| No measurement uncertainty on the report, so conformity near a limit is stated without U | iso 10 | the Uncertainty Evaluation is built |
| Acceptance doesn't check the LOQ against the limit, because the Adoption holds no LOQ yet (ADR 0004 copies it from a signed Method Report) | iso 11 | Method Reports and Adoption scope are built |
| Review Checklists are code constants, not QA-approved documents | iso 7 | the document vault is built |
| The Lab Manager also holds QA so a second QA can approve the first QA's Authorisations | iso 6, part11 point 5 | a second QA person joins and re-signs |
| Seed signatures were made by the seed script for fictional people, and one person holds all demo accounts after handover | part11 point 6 | before any real data |
| Balance printouts are not attached; the weight is Verified against the Run's True Copy only | usp 7 | the balance import or printout capture is built |
| A net weight is not checked against its balance's smallest net weight, because the Equipment stub holds none (USP `<41>`, found by the USP review of C1) | usp | the equipment module records a smallest net weight per balance |

## Map (questions for the owner, recorded when #24 closes)

- How many digits an AI-derived limit is stated to (usp, unclear): `0.3` is more lenient than `0.30` under GN 7.20.
- Whether a Method may omit a variability limit (usp, unclear).
- Recording one Run Check value per injection, so a second bracketing CCV can fail (usp).
- Whether the same QA person may draft and approve a Specification (part11, interpretation).
- Deactivating an account, and whether `account.username` may ever change (part11 C1/C7, unclear).
- Whether the Admin handing over an enrolment link needs the person to show a live code (part11 C6, unclear).
- Storage location, custody and receipt condition for Samples (iso 7.4, procedural).
- Whether a signature's statement is stored with it, so a later rewording never changes what an old signature shows (part11 §11.50(b), interpretation, screen review).
- Whether a correct password and code that opens no session (a place still to choose, or no role there) belongs in the login log (part11 A11d §11.9, unclear, screen review).
- Whether the submit screen shows the Customer the Specification version and Decision Rule each Test will be judged by (iso 7.1.3, unclear, screen review).
