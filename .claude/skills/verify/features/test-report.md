# Test Report

Releasing a Test creates its Test Report, `RD-R-YYYY-00000n`. The report shows the Customer, the Sample, the Method, the Result as entered and the three Signatures, each with the SHA-256 of the signed Record Version. QA recomputes both Audit Trail hash chains from the Test page's Audit Trail panel with `Verify chain` (see [Test Audit Trail](./test-audit-trail.md)).

## Sub-features

- `report-open` opens the report from the Test page's `RD-R-YYYY-00000n` link.
- `report-content` shows the Result exactly as written (`0.0300`, not `0.03`) and the rows `Performed Ana Ferreira`, `Reviewed Rui Tanaka` and `Released Quinn Adeyemi`.
- `report-rail-idle` shows the report with only `Sign out` in the rail, and the status line `Nothing for you to commit here.`, for every role.

## How to get to it (user POV)

- Open a `Reported` Test, then the `RD-R-YYYY-00000n` link in its details.
- Open `#/tests/<test id>/report` directly.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A `Reported` Test: `node .claude/skills/verify/scripts/chain.ts Reported`, which screenshots the report as `06-test-report.png` and then signs out.

- **Open.** Sign in as `quinn.qa`, open the Test and click `getByRole('link', { name: /^RD-R-\d{4}-\d{6}$/ })`. The heading `Test Report RD-R-YYYY-00000n` is visible.
- **Content.** `getByRole('cell', { name: '0.0300', exact: true })` is visible, and for each Signature `getByRole('row', { name: /^Performed Ana Ferreira/ })` is visible (and the same for Reviewed and Released).
- **Not QA.** Sign in as `rui.reviewer` and open the same report. The rail holds only `Sign out`, and the status line reads `Nothing for you to commit here.`
- **Proof.** Screenshot the report and the status line. Run `select number from lims.test_report`, and `select s.meaning, v.record_table, v.version from lims.signature s join lims.record_version v on v.id = s.record_version_id order by s.signed_at desc limit 3`: `Released` is on `test_report` version 1, `Reviewed` and `Performed` on `test` version 3.

## Gotchas

- Opening `#/tests/<id>/report` for a Test that is not `Reported` shows `this Test has no released Test Report` on the page (HTTP 404).
- `Verify chain` moved to the Test page's Audit Trail panel; the report page's rail has no action.
- `Print` opens the browser's print dialog, which blocks the headless page. Do not press it.
