# Record Versions and unsigned Signatures

Every Test and Test Report keeps Record Versions: the database writes a new one whenever the record's canonical content changes (its Sample, Method, Customer, Result or Test Report), with the SHA-256 of that content. A Signature binds to the Record Version it was given on. Once the record has a later version, every screen shows that Signature as `unsigned` beside its meaning, so a stale approval is visible. A Test page shows the Test's current Record Version and hash under `Record Version`.

## Sub-features

- `version-on-test` shows `Record Version` with its number and hash in the Test's details. A Test is at version 1 after Submit, 2 after Receive and 3 after Enter Result; Review and Release add none, because the Test's content does not change.
- `signature-binds-version` shows each Signature's `Record Version` column: `Performed` and `Reviewed` on the Test's version 3, `Released` on the Test Report's version 1.
- `unsigned-after-change` marks every Signature `unsigned` once its record has a later version, on the Test page and on the Test Report, and the Test's `Record Version` moves on.

## How to get to it (user POV)

- Open any Test: the `Record Version` row is in its details, and the Signatures table has a `Record Version` column.
- The slice has no step that changes a signed record. A change arrives from a later module (a Critical Data Change, phase 3) or from a service identity through the audited seam.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A `Reported` Test: `node .claude/skills/verify/scripts/chain.ts Reported`.

- **Version.** Sign in as `quinn.qa` and open the Test. `page.locator('dt:text-is("Record Version") + dd')` contains `3 ·` and a 64-character hex hash. No row matches `getByRole('row', { name: /unsigned/ })`.
- **Change behind the chain.** Run, against the instance's database (`.verify/instance/env` names it), in one transaction: `select set_config('lims.actor', 'svc:verify', true), set_config('lims.role', 'system', true), set_config('lims.reason', 'Change a signed Result (verify)', true); update lims.result set value = '0.0380' where test_id = '<id>';` For example `scripts/pg.sh psql --single-transaction -d <database> -f change.sql`.
- **Unsigned.** Reload the Test page. `Record Version` now contains `4 ·` with another hash, and `getByRole('row', { name: /unsigned/ })` has count 3 (`Performed`, `Reviewed` and `Released`). Open the report: the three Signature rows carry `unsigned` there too.
- **Proof.** Screenshot the Test page and the report. Run `select record_table, version, canonical_form, encode(content_hash, 'hex') from lims.record_version order by record_table, version`: the Test has versions 1 to 4 and the Test Report 1 and 2, all in canonical form 1. `Verify Audit Trail` still reports both chains consistent, and the Audit Trail table shows `INSERT record_version` rows under `svc:verify`.

## Gotchas

- Changing a Result needs the superuser: `lims_app` can only insert Results. psql through `scripts/pg.sh` connects as `postgres`.
- `set_config(..., true)` is transaction-local: without `--single-transaction` (or `begin`/`commit`) the update runs with no audit context and the database refuses it with `LA001`.
- Changing the value back to `0.0300` gives version 5 with version 3's hash; the Signatures stay `unsigned`, because they bind to a version, not to a hash.
