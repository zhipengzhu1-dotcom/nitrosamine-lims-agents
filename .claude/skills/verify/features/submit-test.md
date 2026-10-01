# Submit a Test request

A Customer User submits a Sample for a Method. This creates a Submission with one Sample and one Test in the `Requested` state, and the new Sample number appears in the Customer's worklist.

## Sub-features

- `submit-form` opens the Submit form with the `Method` and `Sample description` fields.
- `submit-commit` creates the Test as `Requested`, and the rail reports it.
- `submit-role` offers the `Submit` button only to the Customer role.

## How to get to it (user POV)

- Sign in as `cora.customer` and press `Submit` in the rail on the Tests worklist.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.

- **Open form.** Run `v.signIn('cora.customer')`, then press `Submit`. The fields `Method` and `Sample description` appear.
- **Fill.** Choose the method with `getByLabel('Method').selectOption({ index: 1 })`, and fill `Sample description` with fictional text.
- **Commit.** Press `Submit` again. `steps.log` shows `POST /api/steps/submit -> 200`, and the status line says `now Requested`. A row with `Requested` and a new link matching `/^RD-S\d{5}$/` appears.
- **Role.** Sign in as `ana.analyst`. The rail on the worklist has only `Sign out`.
- **Proof.** Run `select s.number, t.state from lims.test t join lims.sample s on s.id = t.sample_id order by s.number desc limit 1` and `select table_name, op from lims.audit_entry where reason = 'submit' order by at desc limit 3`, which shows `test`, `sample` and `submission`, all `INSERT`. The `submission` row is in the company chain, not the Lab chain. Or run `node .claude/skills/verify/scripts/chain.ts Requested`, which does all of this and saves the evidence.

## Gotchas

- The rail button and the form's commit button are both named `Submit`, but the rail button hides while the form is open, so only one is on screen at a time. Press it twice: once to open, once to commit.
- The `Method` select starts at `Choose…` (index 0) and fills only after `/api/lookups` answers. `selectOption` waits for the option; a read of the options at once can still find only `Choose…`.
- Never put real product or lot data in the description. All data is fictional.
