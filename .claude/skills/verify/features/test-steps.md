# Take a Test through its steps

Each role takes one step from the rail on the Test page: Receive, then Assign, Enter Result, Review and Release. The last three are signed: the signature sheet shows what is signed, the Signature Meaning with the signature statement, the signer's eligibility and the Record Version with its full SHA-256, then the person types their user ID and password, and the database's signing function writes a Signature with its meaning. The step registry decides who may take which step from which state. The rail offers only that step, and the server refuses anything else.

## Sub-features

- `receive` lets the Sample Custodian move the Test from `Requested` to `Ready`.
- `assign` lets the Lab Manager choose an Analyst and move the Test from `Ready` to `Assigned`.
- `assign-untrained` refuses an Analyst with no Training Record for the Method.
- `enter-result` lets the assigned Analyst enter the Result and sign `Performed`, which moves the Test to `Submitted For Review`.
- `review` lets a Reviewer sign `Reviewed`, which moves the Test to `Reviewed`.
- `signature-sheet` shows, before the credential fields, the record lines under `What you are signing`, the `Meaning` card with the signature statement and its version, `Eligibility` (`<name> may sign <Meaning> as <Role> in <Lab>`), `Record Version` and the 64-character `SHA-256`, then the fields `User ID (type it to sign)` and `Password (type it again to sign)`.
- `review-bad-password` refuses a wrong signing password, or a user ID that is not the signed-in person's: nothing is signed, and the failed attempt is recorded as a `ReauthenticationFailed` Access Event.
- `review-record-changed` refuses a signing after the record changed behind the open sheet (`Refused: The Test changed since this screen loaded it. Read it again before signing. Nothing has been signed.`).
- `release` lets QA sign `Released`, which moves the Test to `Reported` and creates the Test Report.
- `rail-offers-only-next` shows a person with no step to take only `Sign out`.

## How to get to it (user POV)

- Open a Test from the worklist by its Sample number link (`/^RD-S-\d{4}-\d{6}$/`), as the role that takes the next step, and press the one step button in the rail.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A Test in the state that the step starts from: `node .claude/skills/verify/scripts/chain.ts <State before the step>`.

- **Whole chain.** Run `node .claude/skills/verify/scripts/chain.ts Reported`. It screenshots each state (`01-requested.png` to `06-test-report.png`). It saves `test.tsv` with state `Reported`, `signatures.tsv` with `Performed` and `Reviewed` on `test` version 3 and `Released` on `test_report` version 1, and `audit-trail.tsv` with the entries for the Test, its Sample, Result, Test Report and Signatures. A signed step writes several entries: the Test, the Result or Test Report, and the Signature.
- **Assign untrained.** On a `Ready` Test, sign in as `lena.manager`, press `Assign`, choose `Theo Brandt` and press `Assign`. The status line reads `Refused: The assignee must be an Analyst in this Lab with a Training Record for the Method.` and the `h1` still says `Ready`.
- **Bad signing password.** On a `Submitted For Review` Test, sign in as `rui.reviewer`, press `Review` and run `v.sign('Reviewed', 'not-the-password')`. The status line reads `Refused: The user ID or password is not valid. Nothing has been signed.` After `page.reload()`, the `h1` still says `Submitted For Review`, and the person is still signed in.
- **Only the next step.** On an `Assigned` Test, sign in as `rui.reviewer` or `quinn.qa`. `getByRole('contentinfo').getByRole('button')` holds only `Sign out`.
- **Proof of a refusal.** Count `lims.signature` and `lims.audit_entry` rows before and after the refused press. A refused assignment leaves both unchanged. A wrong signing password leaves `lims.signature` unchanged and adds two `lims.audit_entry` rows with reason `Failed authentication`: `table_name` `person`, which counts the failed attempt, and `table_name` `access_event` with kind `ReauthenticationFailed` and `failure_reason` `WrongPassword` (`WrongUserId` for a user ID that is not the signed-in person's).
- **Proof of a signing.** `select meaning, printed_name, username, role, statement_version, authenticator, app_release, reauthentication_id is not null as through_function from lims.signature`: every row names the signer as signed, statement version `1`, authenticator `Password`, the release (`development` under dev.sh) and `true`, because only `lims.sign` writes a Signature and only it fills `reauthentication_id`.
- **Record changed behind the sheet.** On a `Submitted For Review` Test, sign in as `rui.reviewer`, press `Review`, then change the record behind the chain as in [record-versions.md](./record-versions.md) (a superuser `update lims.result ...` in an audited transaction), and `v.sign('Reviewed')`. The status line reads `Refused: The Test changed since this screen loaded it. Read it again before signing. Nothing has been signed.` After `page.reload()` the Record Version row shows the new version, and `Review` signs.

## Gotchas

- `Assign` names both the rail button and the form's commit button, but the rail button hides while the form is open, so the name is never ambiguous. Signing steps commit with `Sign as <Meaning>`.
- The guards behind the rail cannot be reached from the UI with the seed. Only the assigned Analyst can enter the Result, but the rail hides the step from any other Analyst (such as `theo.untrained`). The Analyst who performed a Test cannot review it, and QA cannot release a Test they performed or reviewed, but those need one person with two roles, and every demo account holds one. Report these as not reachable, naming that prerequisite. The step registry tests cover them.
- Two rows in `lims.audit_entry` for one `assign` is expected: the step writes the state, then the assignee.
- A press from a stale page gets the registry's refusal, such as `Refused: The review step needs a Test in SubmittedForReview state, not Reviewed.` (HTTP 409). Only a true race gets `The Test has moved on. Reload it.` Drive one browser at a time.
