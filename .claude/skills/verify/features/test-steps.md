# Take a Test through its steps

Each role takes one step from the rail on the Test page: Receive, then Assign, Enter Result, Review and Release. The last three are signed: the person re-enters their password on the signature sheet, and the server writes a Signature with its meaning. The step registry decides who may take which step from which state. The rail offers only that step, and the server refuses anything else.

## Sub-features

- `receive` lets the Sample Custodian move the Test from `Requested` to `Ready`.
- `assign` lets the Lab Manager choose an Analyst and move the Test from `Ready` to `Assigned`.
- `assign-untrained` refuses an Analyst with no Training Record for the Method.
- `enter-result` lets the assigned Analyst enter the Result and sign `Performed`, which moves the Test to `Submitted For Review`.
- `review` lets a Reviewer sign `Reviewed`, which moves the Test to `Reviewed`.
- `review-bad-password` refuses a wrong signing password, and nothing is signed.
- `release` lets QA sign `Released`, which moves the Test to `Reported` and creates the Test Report.
- `rail-offers-only-next` shows a person with no step to take only `Sign out`.

## How to get to it (user POV)

- Open a Test from the worklist by its `RD-S0000n` link, as the role that takes the next step, and press the one step button in the rail.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A Test in the state that the step starts from: `node .claude/skills/verify/scripts/chain.ts <State before the step>`.

- **Whole chain.** Run `node .claude/skills/verify/scripts/chain.ts Reported`. It screenshots each state (`01-requested.png` to `06-test-report.png`). It saves `test.tsv` with state `Reported`, `signatures.tsv` with `Performed` and `Reviewed` on `test` and `Released` on `test_report`, and `audit-trail.tsv` with one entry for each step.
- **Assign untrained.** On a `Ready` Test, sign in as `lena.manager`, press `Assign`, choose `Theo Brandt` and press `Assign`. The status line reads `Refused: the assignee must be an Analyst in this Lab with a Training Record for the Method.` and the `h1` still says `Ready`.
- **Bad signing password.** On a `Submitted For Review` Test, sign in as `rui.reviewer`, press `Review` and run `v.sign('Reviewed', 'not-the-password')`. The status line reads `Refused: the credentials are not valid. Nothing has been signed.` After `page.reload()`, the `h1` still says `Submitted For Review`.
- **Only the next step.** On an `Assigned` Test, sign in as `rui.reviewer` or `quinn.qa`. `getByRole('contentinfo').getByRole('button')` holds only `Sign out`.
- **Proof of a refusal.** Count `lims.signature` rows and `lims.audit_entry` rows before and after the refused press. Both counts are unchanged.

## Gotchas

- The rail button and the submit button on the step form share a name for `Assign`, and the signing steps' sheets use `Sign as <Meaning>`. Press the rail button first, then the form's button.
- Only the Analyst who was assigned can enter the Result. The Analyst who performed the Test cannot review it, and QA cannot release a Test they performed or reviewed. The demo accounts each hold one role, so these guards need a person with two roles. That cannot be reached without writing to the database, so report it as not reachable.
- Two rows in `lims.audit_entry` for one `assign` is expected: the step writes the assignee and then the state.
- A press that loses a race gets `Refused: the Test has moved on; reload it.` (HTTP 409). Drive one browser at a time.
