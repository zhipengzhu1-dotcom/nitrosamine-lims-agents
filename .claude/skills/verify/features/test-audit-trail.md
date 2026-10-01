# Test Audit Trail

Every Test page that a Lab person opens ends with its Audit Trail, one row for each change to the Test, its Sample, Result, Test Report and Signatures. A Customer sees no Audit Trail. Each row shows the sequence number, the database time in UTC, who made the change (`person:<username>`), their role, the reason (the step name), the record and the change (`field: before → after` for an update, `field=value` for an insert). The rows are written by database triggers, so every step through the UI must leave them.

## Sub-features

- `trail-rows` adds the step's rows to the table after each step.
- `trail-attribution` names the person who signed in and their role, never a service.
- `trail-change` shows the state change, such as `state: Requested → Ready`, and the Sample's `received_at: null → <time>` for `receive`.
- `trail-customer-hidden` shows a Customer the Test without the Audit Trail.

## How to get to it (user POV)

- Open any Test from the worklist as a Lab person and scroll to the `Audit Trail` heading.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A Test in any state: `node .claude/skills/verify/scripts/chain.ts <State>`.

- **Before.** Open the Test as the role that takes its next step. Screenshot the `Audit Trail` table, and count `page.locator('table.audit tbody tr')`.
- **Act.** Take the step from the rail, and wait for the status line to read `now <State>`.
- **After.** The table has new rows. The last ones name `person:<username>`, the role and the step as the reason. One of them shows `state: <old> → <new>`. For `receive` there are two: `test` with `state: Requested → Ready` and `sample` with `received_at: null → <time>`.
- **Customer.** Sign in as `cora.customer` and open the Test. `getByRole('heading', { name: 'Audit Trail' })` has a count of 0.
- **Proof.** Run `select chain, seq, at, actor, role, reason, table_name, op from lims.audit_entry order by at desc limit 5`, and compare it with the table. `chain.ts` saves the Test's whole trail as `audit-trail.tsv`.

## Gotchas

- The page shows only the Lab chain. The company chain (such as the `submission` insert) numbers its own `seq` and never appears here. Gaps in `#` are other Tests' and Samples' entries in the Lab chain.
- The `at` column comes from the database clock. Do not compare it with the browser's or the scenario's clock.
- `table.audit` is the one CSS handle in this map. The table has no accessible name; use the `Audit Trail` heading to scroll to it.
