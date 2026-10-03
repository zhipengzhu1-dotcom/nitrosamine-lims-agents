# System Incidents

The LIMS opens a System Incident when it fails (the person is shown a reference), when QA's Verify chain finds a break, or when sign-in looks attacked. Admin and QA of any Lab see the open ones at `Incidents` in the nav. QA answers once whether the incident could have affected results or records; on a chain-verify incident the answer is Yes. The Admin records the immediate and corrective actions once each, signs Acknowledged over all three, and closes the incident, which then leaves the list. The database allows only Open, Acknowledged, Closed in that order and never changes a Closed incident.

## Sub-features

- `incident-list` shows the open System Incidents, newest first, to Admin and QA; every other role is refused.
- `impact-answer` records QA's Yes or No; a second answer, a No on a chain-verify incident, and an answer by any other role are refused.
- `actions` records the Admin's immediate and corrective actions, once each.
- `acknowledge` signs Acknowledged through the signing function once the answer and both actions are recorded, and moves the incident to Acknowledged.
- `close` moves an Acknowledged incident to Closed; a close before any of the four is refused, naming what is missing.
- `breaks-in-range` lists, on a chain-verify incident, every break inside its range as the chain reads now (`Entry`, `Kind`, `Last entry`) in the region `Breaks in this range`, and says whether they are still the breaks the incident recorded. An incident on another Lab's chain is refused there. A `More` incident needs more than 100 breaks on one chain: change entries behind the chain on the scratch database with `session_replication_role = replica`, then press `Verify chain`.

## How to get to it (user POV)

- Sign in as `quinn.qa` or `ada.admin` and open `Incidents` in the nav. Each incident is a link named by its 8-character reference; it opens beside the list, with `Close` back to the list.
- The rail offers the one step the signed-in person may take next: `Answer impact` for QA; `Record immediate action`, `Record corrective action`, `Acknowledge` and `Close` for the Admin, in that order.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.
- An open System Incident. The quickest is an unexpected failure: add a probe constraint to the instance database (`alter table lims.sample add constraint probe check (description not like '%PROBE%')`), then submit a Test as `cora.customer` whose description holds `PROBE`. The rail reads `Not finished: ... reference <ref>`, and that reference names the incident. Drop the constraint afterwards.

- **Answer.** As `quinn.qa`, open `Incidents`, press the incident's link, then the rail's `Answer impact`. The sheet's field `Could this have affected results or records?` offers `Yes` and `No`. Press the sheet's `Answer impact`. The rail reads `QA's answer is recorded in the Audit Trail.` and `QA's answer` under `Impact and actions` shows the answer with who recorded it. The rail then offers no step.
- **Actions.** As `ada.admin`, open the incident. Press `Record immediate action`, fill `Immediate action`, press the sheet's button; the same for `Record corrective action` and `Corrective action`.
- **Acknowledge.** Press `Acknowledge`. The sheet `Sign Acknowledged` lists the incident, QA's answer and both actions under `What you are signing`, then `Meaning`, `Record Version` and `SHA-256`. Fill `User ID` and `Password` and press `Sign as Acknowledged`. The heading's Status reads `Acknowledged` and `Acknowledged` in the facts names the signer.
- **Close.** Press `Close` (`exact: true`). The Status reads `Closed` and the incident leaves the list.
- **Proof.** `select i.state, i.impact_answer, i.immediate_action, i.corrective_action, s.meaning, s.role from lims.system_incident i left join lims.record_version v on v.record_table = 'system_incident' and v.record_id = i.id left join lims.signature s on s.lab_id = v.lab_id and s.record_version_id = v.id where i.reference = :'reference'`.

## Gotchas

- `v.sign` is typed for `Performed`, `Reviewed` and `Released`; fill `/User ID/` and `/Password/` and press `Sign as Acknowledged` by hand.
- The incident's Record Version shows the version a signing from this Lab would bind, so it reads `1` before any Signature exists.
- The rail keeps the last answer's text until the next step; use the absence of `.rbtn--commit` to see that no step is offered.
