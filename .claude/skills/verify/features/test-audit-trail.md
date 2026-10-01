# Test Audit Trail

Every Test page ends with its Audit Trail: one row for each change to the Test's records. Each row shows the sequence number, the database time in UTC, who made the change (`person:<username>`), their role, the reason (the step name), the record and the change (`field: before → after` for an update, `field=value` for an insert). The rows are written by database triggers, so every step through the UI must leave them.

## Sub-features

- `trail-rows` adds the step's rows to the table after each step.
- `trail-attribution` names the person who signed in and their role, never a service.
- `trail-change` shows the state change, such as `state: Requested → Ready`.

## How to get to it (user POV)

- Open any Test from the worklist and scroll to the `Audit Trail` heading.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A Test in any state: `node .claude/skills/verify/scripts/chain.ts <State>`.

- **Before.** Open the Test as the role that takes its next step. Screenshot the `Audit Trail` table, and count `page.locator('table.audit tbody tr')`.
- **Act.** Take the step from the rail, and wait for the status line to read `now <State>`.
- **After.** The table has new rows. The last ones name `person:<username>`, the role and the step as the reason. One of them shows `state: <old> → <new>`.
- **Proof.** Run `select chain, seq, at, actor, role, reason, table_name, op from lims.audit_entry order by at desc limit 5`, and compare it with the table. `chain.ts` saves the Test's whole trail as `audit-trail.tsv`.

## Gotchas

- `seq` counts within one chain, and the Lab chain and the company chain number independently. Gaps in one Test's rows are other records' entries, such as the Sample's `received_at`.
- The `at` column comes from the database clock. Do not compare it with the browser's or the scenario's clock.
- `table.audit` is the one CSS handle in this map. The table has no accessible name; use the `Audit Trail` heading to scroll to it.
