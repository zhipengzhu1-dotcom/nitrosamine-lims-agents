# Test Audit Trail

Every Test page that a Lab person opens ends with its Audit Trail: one time-ordered list of every change to the Test, its Sample, Result, Test Report and Signatures, with the Submission's entry from the company chain. A Customer sees no Audit Trail. Each entry shows its chain (`Lab chain` or `Company chain`), its sequence number, the database time in UTC and, on the Lab chain, in the Lab's zone, who made the change by their printed name and role, what they created or changed, the reason (the step name), and each field by its glossary name with the old and new value. A referenced record (a person, a Method, a Sample) shows by its label as it stood at the entry's time and links to its own trail at `#/trails/<table>/<id>`. A long value is collapsed and expands in place. `Raw entry N` opens the stored entry with its hashes. The list is searchable and sortable, and an entry that changed a saved value after first save is tinted red. QA has `Verify chain` in the panel.

## Sub-features

- `trail-entries` adds the step's entries to the list after each step, on the right chain.
- `trail-attribution` names the person who signed in by their printed name and role, never a service, and keeps the name they had at the time.
- `trail-change` shows `State` with `<old> → <new>`, and for `receive` the Sample's `Received` with the stored time.
- `trail-search-sort` filters the list by any shown word and orders it oldest or newest first.
- `trail-long-values` collapses a value longer than 48 characters, such as the signed Record Version, behind a summary that expands in place.
- `trail-raw` opens the stored entry (`Raw entry N`) in a dialog with its `old_row`, `new_row`, `prev_hash` and `hash`.
- `trail-record-link` opens a cited record's own trail from a link in an entry.
- `trail-verify` lets QA recompute both chains and reads `intact through entry N` for each.
- `trail-customer-hidden` shows a Customer the Test without the Audit Trail, and `/api/tests/<id>/trail` refuses a Customer with 403 `role`.

## How to get to it (user POV)

- Open any Test from the worklist as a Lab person and scroll to the `Audit Trail` heading. The panel is `getByRole('region', { name: 'Audit Trail' })` and each entry a `listitem` whose text starts with its chain and `#<seq>`.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- A Test in any state: `node .claude/skills/verify/scripts/chain.ts <State>`.

- **Before.** Open the Test as the role that takes its next step. Screenshot the panel and count `trail.getByRole('listitem')`.
- **Act.** Take the step from the rail, and wait for the status line to read `now <State>`.
- **After.** The panel has new entries without a reload, tinted for a moment (`entry--fresh`). The last ones name the person's printed name, their role in words (`Lab Manager`) and the step as the reason. One of them shows `State` with `<old> → <new>`. For `receive` there are two: the Test with `State Requested → Ready` and the Sample with `Received`.
- **Search.** Fill `Search the trail` with a printed name and count the entries; clear it and the count returns. Choose `Newest first` in `Order` and the first entry is the latest.
- **Long value and raw.** On a Test past Enter Result, the Signature entry holds `details.long`; click its `summary` and the signed Record Version shows in full. Press `Raw entry N`; the `dialog` shows the stored entry with a 64-hex `hash`. `Close` it.
- **Verify.** As `quinn.qa`, press `Verify chain` in the panel. `steps.log` shows `POST /api/audit/verify -> 200`, and `.verdict` reads `Recomputed at <YYYY-MM-DD hh:mm:ss> UTC: Lab chain intact through entry N; Company chain intact through entry M. Not anchored off-server (demo).` N equals `select max(seq) from lims.audit_entry where chain = (select lab_id::text from lims.test limit 1)` (the seed has more than one Lab).
- **Break.** To see a break, alter one Lab-chain entry as the database owner, the only way a break can happen: pipe `begin; set local session_replication_role = replica; update lims.audit_entry set reason = 'x' where chain = '<lab id>' and seq = <n>; commit;` into `scripts/pg.sh psql -d <DB from .verify/instance/env> -v ON_ERROR_STOP=1`. This is the one write a scenario makes outside the rail, because it simulates tampering. Press `Verify chain`; `.verdict` reads `Lab chain entry <n> fails to verify; intact through entry <n-1>; recorded as System Incident <8 characters>`. Press it again: the same reference, and `select reference, chain, first_failure from lims.system_incident where kind = 'ChainVerifyFailure'` still holds one row, requested by `quinn.qa`, with its `audit_entry` on the company chain as `svc:incident`.
- **Customer.** Sign in as `cora.customer` and open the Test. `getByRole('region', { name: 'Audit Trail' })` has a count of 0.
- **Proof.** Run `select chain, seq, at, actor, role, reason, table_name, op from lims.audit_entry order by at desc limit 5`, and compare it with the raw entries. `chain.ts` saves the Test's whole trail as `audit-trail.tsv`.

## Gotchas

- The company chain numbers its own `seq`, so `#` is unique only within a chain. Gaps in `#` are other Tests' and Samples' entries.
- `assign` writes two Test entries in one transaction: `State Ready → Assigned`, then `Analyst none → <name>`.
- The `at` column comes from the database clock. Do not compare it with the browser's or the scenario's clock. The Lab-zone time is the same instant in `America/New_York` (the seeded Lab's zone).
- The hash in the dialog is over the stored bytes, so a renamed person still shows their old name in old entries; that is the record, not a bug.
