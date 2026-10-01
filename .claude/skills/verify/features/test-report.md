# Test Report

Releasing a Test creates its Test Report, `RD-R0000n`. The report shows the Customer, the Sample, the Method, the Result as entered and the three Signatures, each with the SHA-256 of the signed Record Version. QA can recompute both Audit Trail hash chains from the report page with `Verify Audit Trail`.

## Sub-features

- `report-open` opens the report from the Test page's `RD-R0000n` link.
- `report-content` shows the Result exactly as written (`0.0300`, not `0.03`) and the rows `Performed Ana Ferreira`, `Reviewed Rui Tanaka` and `Released Quinn Adeyemi`.
- `verify-audit-trail` recomputes the Lab and company chains and reports them consistent.
- `verify-qa-only` offers `Verify Audit Trail` only to QA. Any other Lab role sees the report with only `Sign out` in the rail, and the status line `Nothing for you to commit here.`

## How to get to it (user POV)

- Open a `Reported` Test, then the `RD-R0000n` link in its details.
- Open `#/tests/<test id>/report` directly.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A `Reported` Test: `node .claude/skills/verify/scripts/chain.ts Reported`, which screenshots the report as `06-test-report.png` and then signs out.

- **Open.** Sign in as `quinn.qa`, open the Test and click `getByRole('link', { name: /^RD-R\d{5}$/ })`. The heading `Test Report RD-R0000n` is visible.
- **Content.** `getByRole('cell', { name: '0.0300', exact: true })` is visible, and for each Signature `getByRole('row', { name: /^Performed Ana Ferreira/ })` is visible (and the same for Reviewed and Released).
- **Verify.** Press `Verify Audit Trail`. `steps.log` shows `POST /api/audit/verify -> 200`. The status line reads `Recomputed at <YYYY-MM-DD hh:mm:ss> UTC: Lab chain internally consistent, company chain internally consistent. Not anchored off-server (demo).`
- **Not QA.** Sign in as `rui.reviewer` and open the same report. The rail holds only `Sign out`, and the status line reads `Nothing for you to commit here.`
- **Proof.** Screenshot the report and the status line. Run `select number from lims.test_report`, and `select meaning, record_table from lims.signature order by signed_at desc limit 3`: `Released` is on `test_report`, `Reviewed` and `Performed` on `test`.

## Gotchas

- Opening `#/tests/<id>/report` for a Test that is not `Reported` shows `this Test has no released Test Report` on the page (HTTP 404).
- `POST /api/audit/verify` refuses anyone but QA (403). Check that the button is missing for another role, rather than calling the endpoint.
- `Print` opens the browser's print dialog, which blocks the headless page. Do not press it.
