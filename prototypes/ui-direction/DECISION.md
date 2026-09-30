## Resolution

Decided with the owner after a four-way arena of throwaway prototypes, all built from one brief and one fictional dataset. The owner inspected them, rated the two Opus results best, and chose to merge them with **Bench Rail** as the base. The Part 11, ISO/IEC 17025 and USP expert agents reviewed the merged direction and this text. Their gaps are closed by the rules below, and two open questions became new tickets.

The prototypes, rationales, click-through reports and the comparison page source are on the `prototype/ui-direction` branch under `prototypes/ui-direction/`. The merged direction is `candidates/chosen/`; its `RATIONALE.md` holds the design tokens and the component list. The owner can flip between all five at full size on the [comparison page](https://claude.ai/artifact/99wmmecXf6B28UQdUdvLE7), which is private to the owner until shared.

### The direction: Bench Rail, with four parts of "Ledger, bottom rail"

- **Reading and acting are split by reach.** Records read densely in the upper plane: 13–14 px text and 50 px two-line rows, so 15 queue rows fit at 1920×1080 and 9 at 1366×768. Every action that commits something sits in one dark rail along the bottom edge, at glove size:
  - 56 px buttons and fields;
  - 64 px keypad keys;
  - 92 px tiles on the lock screen.
- **The rail is the same on every screen.**
  - Left: who is signed in (name, native-script name, role, username, sign-in time, idle lock).
  - Middle: what the next action acts on, and a receipt after each commit, such as "Recorded in the audit trail at 10:40 EDT. Audited, not signed."
  - Right: the primary button, named for the next commit, then Switch user and Lock.
- **Status reads as a word, then a glyph, then colour.** Colour is never the only signal.
  - A Test's state carries a position track and its time in that state.
  - A Hold is its own tag, never a state, and shows its kind.
  - A Deviation tag shows its Kind and Risk Level, filled more as the risk rises.
  - GxP Class is a badge. Overdue and At risk each have a glyph and a stated rule.
  - The header names the workstation, and each Test shows a step bar.
- **Pencil, ink and signature blue.**
  - Imported values are drafts in pencil (graphite with a dashed underline) until the Analyst signs Performed. Signing turns them into ink.
  - Saved records that are audited but never signed, such as readings, are ink from the moment they save.
  - Signature blue is used for Electronic Signatures and nothing else.
- **Signature prompt.** It is a sheet that rises from the rail, with what is being signed first:
  - the record and its Record Version;
  - the full SHA-256, with the first 8 characters highlighted;
  - the values;
  - the source files;
  - what signing will do.

  Then comes who is signing, with the meaning and its fixed statement. The user ID and password are typed at every signing and every sign-in, followed by a fresh code or a passkey as the second factor (#13). The attempts left before lockout stay in view. Cancel and Escape always close the sheet. The final button names the act, for example "Sign failed Check as Performed". Any change before signing makes a new Record Version, and the signature binds to the hash of the version shown.
- **Shared PC.**
  - Lock hides everything.
  - Switch user locks at once, and takeover needs the next person's credentials.
  - The person signed in changes only through a sign-in: never through the address bar, a reload, a new tab, a deep link, or Back and Forward.
  - Signatures record the signer's real role.
- **Entry with gloves.**
  - 56 px fields with the unit inside and the limits printed under them.
  - A calculator-style keypad; the touch keyboard stays down.
  - A reading or Check value outside its limits, or outside its plausibility range, must be typed twice.
  - What confirming a failing value will do is stated before it is confirmed.
  - Each entry saves to the server as it is made, attributed to its author with server time (ADR 0001). Times are never typed.
- **Scale.** The queue has a pipeline of state counts, filters (Overdue, At risk, Holds, Deviation, GxP Class, Method, Customer), a workload panel for all 20 Analysts, "Assign next Ready Test", and keyboard shortcuts at desks.

### Rules the build must follow

These come from the compliance review. Each one binds [Prototype the walking skeleton on main](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) and every later screen.

**Sessions and sign-in**
1. Lock, Switch user and the idle lock are states of the server session, and the client reports each one at once.
   - The server refuses every request on a locked session until its owner re-authenticates in full.
   - A takeover ends the previous session on the server.
   - Every page load asks the server first, and shows the lock or sign-in screen unless the session is unlocked.
   - A deep link opens its screen only after sign-in. No route creates or changes anything.
   - On lock, record views unmount and cached record data is dropped.
   - Lock, unlock, idle lock and takeover go to the access log.
2. The prototype's printed credentials, "Fill" buttons and simulated key touch are prototype-only.
   - The React SignaturePrompt and LockScreen have no fill path and no simulated authenticator.
   - No endpoint ever returns a password, a TOTP secret or a current code.
   - Passkeys are real WebAuthn with `userVerification: "required"`.
   - Any aid for the public demo sits outside those components, behind a server-side demo flag, and is named in the demo-exception record of #13.
   - A build check fails if the production bundle contains the demo module.
3. On shared bench PCs, a passkey is a roaming authenticator with its own user verification: a FIDO2 key with a PIN or fingerprint, or a phone over hybrid. It is never a platform authenticator on the PC's Windows account, so the bench copy drops "Windows Hello". Bench browsers run with password saving and autofill turned off by policy, recorded with the workstation configuration.
4. The keypad types into the code field only, never into the password (interpretation of draft Annex 11 §11.4).
5. "Who is signing" shows the server's eligibility answer before any credentials are asked for:
   - the Authorisation's meaning, scope and valid-until date;
   - for a Check, the Training Record on the plan's SOP version.

   A signer who isn't eligible is refused there, with the reason.
6. Every failed sign-in or signing is refused and logged by the server, including a user ID that isn't the session's. That last case is alerted but counts toward neither account's lockout, since no password was tested (interpretation). The lockout message says that the Admin and QA were alerted.
7. Acknowledging an alarm opens the signature prompt with the meaning Acknowledged, and the comment appears in the manifest (#13, #15).
8. Group signing lists every record with its version and hash. A TOTP code already used shows "wait for the next code".
9. A receipt appears only after the server confirms the commit, and carries the server's time. The time zone and its abbreviation are derived from the IANA zone at each instant.

**Signatures and records**

10. Every screen that shows a signature uses a SignatureLine: the meaning, full name, username, role, and lab-local time with the zone. Tapping it opens the full SignatureBlock. No signature detail lives only in a hover title.
11. SignatureBlock has "UNSIGNED — changed after signature" and "SIGNATURE INVALID" states (#13).
    - The server computes the canonical hash.
    - The signing request carries the version and hash the prompt showed, and the server refuses it if the record changed after display.
12. Three components join the list for #24:
    - the inline Audit Trail panel from #13 (who with role, old → new value, reason, UTC and zone, searchable and sortable, with changes after first save highlighted);
    - a Critical Data Change dialog (a reason picklist with free text for Other, each old → new value, pending until a second person approves, per ADR 0001);
    - the SignatureLine.
13. Runs show their Run Version ID and SHA-256 with Performed and Reviewed lines. A Test's "What you are signing" list and its signed content include each Run Version's ID and hash (#20). A Check shows "Performed, awaiting Review" until its Reviewed signature, then shows the Reviewed line (#15).

**Status and gates**

14. No component shows a pass, OK or In use state it did not compute from data.
    - Failed and Missing are states, drawn with the fail glyph.
    - A summary line turns to the fail glyph and colour on any failure or missing value, and names the Deviation it opened.
15. Run Checks: each check shows, for each Analyte, the value, the criterion as written and its source (Method version, monograph or `<621>` with its version).
    - A Test's step bar marks the Run done only when the Run is signed Performed with every Run Check recorded and passing. Otherwise it reads "Blocked" with the Run Check Failure Deviation ID.
    - The same step model carries the other blockers already decided: unsigned Runs and an open OOS (#20), outside-stability Injections (#36), a variability failure (#29), and any Hold on the step. The rail refuses Sign Performed and gives the reason.
16. Flags come in two kinds (#20).
    - **Criterion failures** show "No Result from this Injection", with the investigation they opened and only the options the Method allows, and there is no Accept. They are:
      - ion ratio;
      - retention-time window;
      - calibrated range;
      - outside stability;
      - a failed Run Check.
    - **Advisory flags** are acknowledged with a comment at the Reviewer's step. They are:
      - outlier;
      - OOT;
      - trend;
      - Conditional Pass.
17. Holds and Deviations show wherever a Test is worked, with the same tags as the queue. The reason and the blocked step are readable without hovering. A Hold that blocks a step is that step's reason in the step bar and in the rail.
18. The box that states what confirming a failing value will do shows only the server's computed consequences: the Deviation Kind and Risk Level, the Holds with their count and Test IDs, and the Suspensions. Its text is never written in the UI.
19. A FitnessTag always prints its word and its reason or validity date as text. A compact form may shorten them but never hides them.
    - An unknown status renders "Status unknown" and blocks.
    - Records show the status at the time of use, plus the current status and its Deviation if it has changed since.
    - A Check shows each reference device it used, with its FitnessTag and certificate, and both go into the Check's signed content.
    - A reading form names its measuring device and that device's due date. A device that isn't In use can't be cited (#15): the screen says so and the reading is taken on a calibrated reference thermometer instead, so the unit stays monitored (interpretation, following #15's gate).

**Numbers**

20. Limits, tolerances, LOQ and LOD print exactly as their stored decimal strings, with the unit and the operator (NMT ≤, NLT ≥). They are never formatted from a number.
21. Weighing fields and weights take their unit and decimals from the Equipment record's readability for each range.
22. Results are grouped by Specification Section: Jurisdiction, Specification ID and version, and Decision Rule (#29).
    - Cells show the full-precision value, labelled as such.
    - Verdicts use the value rounded once by the Section's Rule Set, beside the limit as written.
    - Share of limit shows for each Preparation and for the mean.
    - Provisional verdicts say "Provisional" in word, glyph and colour, and "Conforms" never shows while any line is conditional.
    - Non-numeric results print their bound: "< LOQ (0.005 ppm)" and "Not detected (< 0.0015 ppm)", taken per Preparation from the pinned Method Adoption and multiplied by the dilution factor.
    - The result's basis (as is, dried or anhydrous) prints from the Specification, with the water or loss-on-drying result behind a dried or anhydrous basis: the Lab's own Test on a USP claim, or the Customer-supplied value, marked as such (#29).
23. Retype-to-confirm is for Checks and readings only. A hard limit refuses with its reason and offers no way to save:
    - a net weight below the smallest net weight;
    - a balance or pipette that is not In use;
    - a balance or pipette without today's passing before-use Check.
24. A balance Check shows:
    - the full-precision error, the value compared, and the limit as written;
    - the certified value exactly as the certificate states it;
    - any printed acceptance range, derived from the comparison rule so that both ends pass.

    The comparison rule itself is the new ticket below.

### Where the prototype is superseded

The prototype's import, flag, Run Check, limit and weighing flows follow a brief written before #20, #29 and #36 closed. Where the prototype differs from those decisions or from the rules above, the decisions and rules govern, and nothing should be copied from it. These are the known differences:
- the "Accept with a comment" option on the ion-ratio flag;
- Run Check and cross-check summaries styled as passing, and not gating signing;
- limits formatted from numbers;
- bare "< LOQ" and "Not detected";
- balance decimals taken from a UI table;
- consequence texts for Room, Excursion and DI water readings written in the UI, with the Risk Level Minor hard-coded;
- unsaved entries kept per person in the browser;
- lock and takeover handled only in the page, with deep links choosing the person;
- the demo credential aids;
- the passkey replacing the typed password;
- an alarm acknowledgement that isn't signed;
- signature details in hover titles.

### What the arena showed

- **Four directions, one brief.**

  | Direction | Built by | Checker (pass / partial / fail) |
  |---|---|---|
  | Bench Rail | Opus, with `emil-design-eng` and `frontend-design` | 18 / 1 / 1 |
  | Ledger, side rail | Fable, with the same skills | 17 / 2 / 1 |
  | Interlock | Sonnet, with the same skills | 17 / 3 / 0 |
  | Ledger, bottom rail | Opus, no skills (the control) | 16 / 3 / 1 |

  All four had a clean console and no horizontal overflow at 1366×768, and none had a target under 40 px. The merged direction passes its own 57 click-through checks.
- **They converged.**
  - All four separate reading from acting.
  - Three put the actions in a single glove-sized rail.
  - All draw imported values as drafts until signing.
  - All state the consequence before a failing value is confirmed.
- **Skills against the control.** The Opus control, built with no skills, reached the same layout as Opus with the design skills, and the owner rated both Opus results best. In this one run, the model mattered more than the skills. That is an inference from a single run.
- **The weak spot.** In every prototype, the address bar or Back and Forward could change who was signed in or undo a gate. Rule 1 closes that for the build.
- **Fairness.** Three of the builders opened the judge-only rubric, which the brief had left in their folder. One also saw which model built each direction. The rubric restated the brief, and the owner chose by inspection, not by rubric score.

### Handed on

- [Prototype the walking skeleton on main](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) builds the React 19 + TypeScript shell from the chosen tokens, the component list in `RATIONALE.md` (plus the three components in rule 12), and rules 1–24. Reading and Check entry wait for the two new tickets below: until both are decided, #24 shows them as rough screens that save nothing and make no pass or fail comparison.
- [Decide how Check and Run Check results are compared with their limits](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/37): the USP review's open rule, rounding to the limit's written decimals (General Notices 7.20) or not.
- [Decide what is recorded when a failing value is first typed](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/38): the Part 11 review's open question, which would amend #15 and ADR 0001.

### Compliance review

The three expert agents reviewed the merged prototype and this text. They re-reviewed the revision and confirmed every gap closed.

- **`part11-expert`.** The first pass found 8 gaps and 4 unclear rows; all 25 rows are met after the revision. They close through:
  - rule 1, server-side sessions (§11.10(d));
  - rule 2, demo aids kept out of the build (§11.200(a)(3));
  - rule 3, roaming authenticators on shared PCs (§11.200(a)(2));
  - the typed user ID and password at every signing (§11.200(a)(1), #13);
  - rule 7, a signed Acknowledged on alarms (draft Annex 11 §8.4);
  - rules 10 and 12, SignatureLine (draft Annex 11 §13.6);
  - rule 11, the unsigned and invalid states (§11.70);
  - rule 12, the Audit Trail panel and the Critical Data Change dialog;
  - rule 6, logged failures (§11.300(d));
  - entries saved as they are made (FDA DI Q12, ADR 0001), with the first-failing-value question sent to #38.
- **`iso17025-expert`.** The first pass found 6 gaps and 1 unclear row; all 19 applicable clauses are met after the revision. They close through rules 5, 13–20 and 22 and the list of where the prototype is superseded (6.2.6, 6.4.8, 6.5.1, 7.1.3, 7.2.1.7, 7.5.1, 7.7.3, 7.8.6.2, 7.10.1, 7.11.6).
- **`usp-expert`.** The first pass found 7 gaps and 3 unclear rows; all are met after the revision. They close through rules 14–16 and 19–24 (`<736>`, `<621>`, `<41>`, GN 6.40, 6.80.30, 7.10 and 7.20). The General Notices 7.20 comparison rule itself is in #37. Check frequency, reading limits and DI water limits are procedural, left to the lab's SOPs.
- **Interpretations the reviewers flagged.**
  - The keypad stays off the password field (draft Annex 11 §11.4).
  - A signing with a user ID that isn't the session's is logged and alerted, but not counted toward lockout.
  - A reading whose device isn't In use is taken on a calibrated reference thermometer instead.
- **For #24's own review.** If its result entry includes Preparation weights under rule 23's hard limits, refused values are logged until #38 decides.
