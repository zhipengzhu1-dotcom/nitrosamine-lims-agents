# Bench Rail (merged)

**Axis: split every screen by reach.** The record reads densely above. Every action you commit sits in one glove-sized rail along the bottom edge, next to the name of the person signed in.

On a bench all-in-one the bottom edge is nearest the gloved hand. Tapping there doesn't cover the data you're reading, and you don't have to lift your arm to the top of the screen. The rail is the same on all four screens. Its left end shows who is signed in, its middle says what the next action will act on, its primary button names that action, and Switch user and Lock sit at its right end.

This copy is Bench Rail with four parts of "Ledger, bottom rail" folded in and the findings of the independent check fixed. `candidates/c1/` keeps the original for comparison.

Run it: open `index.html` through any static server with `data.js` two levels up. The deep links are `#queue`, `#assign`, `#test`, `#imported`, `#sign`, `#checks` and `#check-fail`. `node candidates/chosen/flows.mjs` (run from `ui-direction`) drives every click path with real mouse, keyboard and keypad input and checks 57 assertions. It reads every expected value (hashes, limits, counts, IDs, credentials) from `data.js` at run time and writes screenshots to `shots/chosen/flows/`.

## Merged from Ledger, bottom rail

Each part was rebuilt in Bench Rail's tokens, components and words rather than pasted.

### 1. The workstation name in the header

**Joined.** "Bench PC RD-102-02" now sits in the top bar beside the lab clock, with a small monitor glyph drawn in Bench Rail's icon set. It belongs to the PC, not the person, so Switch user never changes it. The same name also appears in three other places:
- the lock screen's bar, with its room ("in RD-102 Preparation lab");
- the signer's line in the signature prompt ("on Bench PC RD-102-02");
- every audit entry.

**Replaced.** The lock screen used to say "bench PC RD-102-B2". Now the PC has one name everywhere.

**Left out.** Nothing else of c4's top bar. Bench Rail's tab navigation and "Fictional data" marker stay.

### 2. The step bar on the Test workspace

**Joined.** Six steps now sit under the Test's header: Preparations, Run, Import, Check drafts, Sign Performed and Review. Each is marked done, current or next. The bar uses the queue pipeline's grammar:
- current has a violet tint and a bottom bar;
- done has a green tick;
- next has a numbered outline.

Every step also carries a live note, such as "imported 09:58 EDT", "4 left" or "signed 10:40 EDT".

**Replaced.** The task panel's private numbering (1 flag, 2 checklist, 3 sign) and the rail's "Step 1 of 3" text are gone. The bar, the "Before you sign Performed" panel and the rail now read one step model (`benchSteps()` in `workspace.js`). They use the same numbers (4 Check drafts, 5 Sign Performed), the same names, and the same count ("4 left", then "3 left"). Each surface says the count once. The task panel shows only the current step in detail and the next one below it.

**Left out.** c4's fixed step notes ("flag and checklist"). The live count carries more, and it is the one number all three surfaces share.

### 3. Hold and Deviation kinds in queue rows

**Joined.** As in c4, Holds and Deviations each get their own column. The Hold chip has its kind underneath, from `tests[].holds[].kind` ("Equipment Deviation", "Failed Run check"; several are joined with commas). The Deviation chip has its Kind underneath, next to its Risk Level.

**Replaced.**
- The combined "Holds and Deviations" column is gone.
- To keep rows two lines high and the Method ID whole at 1366×768, the Class column is gone. The GxP tag moves next to the Test ID, and the service level moves next to the Sample.
- The workload column is 232 px at that width, and cell padding tightens there.
- The queue still shows 9 full rows at 1366×768 and 14 at 1920×1080.

**Left out.**
- c4's magenta Deviation and violet Hold colours; Bench Rail's status palette stays (amber Hold, red Deviation).
- c4's "Equipment · Major" text. The Risk Level is Bench Rail's existing Risk tag, whose fill weight shows severity, the same as in the detail band. There are no middle-dot strings.

### 4. The keypad beside the sign-in fields

**Joined.** The Checks keypad is now one shared component. It sits beside the user ID, password and code fields in the signature prompt:
- It types into whichever of the three fields has focus, like a calculator, always at the end of the value.
- Next walks from user ID to password to code, then to the Sign button.
- The keyboard still works.
- The code field uses `inputmode="none"` because the keypad covers it; the user ID and password keep the keyboard for letters.

All three are still entered for every signature. The demo button now fills only the password and code; the user ID is always typed.

**Left out.**
- c4's pad that only ever types into the code field; the brief asked for the focused field.
- c4's Clear key; backspace does the job.
- c4's keypad on the lock screen. The build needs the code keypad there, since sign-in always types the password and then a code or a roaming passkey (#23 rules 3–4).

## Fixed after the independent check

- **A draft never changes owner (prototype only).** In this prototype, the person leaving keeps their unsaved typing in page memory under their name, and the next person never sees or saves it. **Superseded for the build:** each entry saves to the server as it is made, attributed to its author with server time (ADR 0001, rules in #23's resolution). What is recorded when a failing value is first typed is decided in #38. Do not build a browser-side draft store.
- **A signature carries the signer's real role.** The prompt refuses a role the signer does not hold.
  - Performing a Check needs a Training Record on its Check Plan, which only the Analysts hold here. Anyone else sees Today's Checks read only, with that reason on screen and no inputs or Sign.
  - The top-bar navigation keeps these read-only states consistent everywhere.
- **The person changes only through Switch user.** Only the first load sets the person from a deep link.
  - A later hash edit, Back or Forward onto another person's screen locks the PC, preselects that person and asks for their credentials. After sign-in it opens the linked screen.
  - The same edit onto the same person's screen just navigates and keeps their work.
- **The failed BAL-04 Check places its Holds.** Signing it opens `focus.checkFail.consequence.deviationId` (DEV-26-0094) and puts an Equipment Deviation Hold on exactly the Tests in `consequence.testIds`. The queue's Holds and Deviation filters show them: "With open Holds" goes from 38 to 49, and filtering by DEV-26-0094 lists the 14. Other failing Checks never take that reserved ID.
- **The hash covers what was signed.** Record Version 1 is created at the Import. The flag decision and checklist are saved to the draft and audited. Sign Performed saves Record Version 2 with the draft, the typed comment and the checklist, and computes its SHA-256 in the browser from that content. The flows recompute it in Node and compare. The data's fixed `contentSha256` is no longer used.
- **Lower-severity findings.**
  - The Test record is a keyboard-focusable region.
  - No `aria-label` sits on a plain span or div.
  - A skip link lands on the current queue row.
  - Focus returns to the Sign button after Escape.
  - A stale "Not yet" disappears once its button is enabled, and an Assigned row keeps "Assigned by … Recorded in the audit trail" in the rail.
  - The workload results line explains active versus open.
  - Balance readings stop at the balance's own decimals.
  - Lock tiles put native names on their own line, and selects size to their value.
  - Glossary: Import (no "Upload"), results file and printed report, Preparation and Injection columns, Run Checks.
- **Hash navigation creates nothing.** A later `#sign` or `#imported` shows the Test as it stands and explains the gate in the rail ("Sign Performed is not open: Nothing is imported yet…").
- **Signed stays signed.** Back, Forward and hash edits never undo a signature, and an Import never re-opens once results exist or the Test is past In Progress.
- **A lock survives navigation.** Neither a lock nor an account lockout is cleared by any hash edit or Back and Forward. The fifth failed signing attempt locks the account and the PC, and the locked account cannot sign in again even with the right password.

## Dense data against glove-sized targets

- **Two planes, two sizes.** The reading plane uses 13–14 px text, 50 px two-line queue rows and 30 px Injection rows. The rail and every entry control use 56 px targets. `shoot.mjs` reports 0 targets under 40 px on all 14 loads.
- **All commits happen in the rail.** Assign, Import TargetLynx export, Save flag decision, Sign Performed, Save reading, Sign failed Check and Acknowledge alarm all live there. The primary button is always the next commit, named for what it does. When it can't be pressed it shows a dashed outline, and tapping it answers in the rail with the reason.
- **The system answers in the rail.** Receipts replace the rail's context line for a few seconds, next to where the hand just acted, and persistent states repeat what matters. Floating toasts were tried first; at 1366 they covered the next step.
- **Inside the reading plane, targets are whole rows or tiles**, never inline links. Hold reasons and Deviation details sit in a row's detail band and in hover tips.
- **Entry at the bench** uses 56 px fields with 26 px digits, the unit inside the field and the limits under it. One calculator-style keypad serves both the Checks and the signature prompt. Reading fields use `inputmode="none"` so the Windows touch keyboard never covers the rail.
- **Desk users keep density and keys.** `/` searches, arrows move, Enter selects, `A` assigns and Escape clears. Skip links reach the queue's current row and the rail.

## Status: a word, then a glyph, then colour

| What | How it reads |
| --- | --- |
| Test state | The state name, an 8-cell track for its position on Requested → Reported, and "for 9 d". Side exits get a hatched red track. |
| Hold | An amber "1 Hold" tag with a pause glyph, the Hold's kind underneath, and the reason in the detail band and hover tip. A Hold never replaces the state. |
| Deviation | A red-outlined tag with a triangle and the ID, and its Kind and Risk Level underneath. Risk Level fills more as severity rises: Minor outlined, Major tinted, Critical solid. |
| GxP Class | GMP is ink-outlined and non-GMP is grey-filled, beside the Test ID. |
| Overdue / at risk | A solid red clock with "Overdue 8 d" and a red row edge; an outline amber clock with "Due tomorrow" and an amber edge. At risk means due within 2 business days and not yet Submitted for Review. |
| Fitness Status | In use (check), Quarantined (hatched square), Suspended (bar), Expired (hourglass), Retired (slashed circle), always with its reason or next date. |
| Check status | Done, Due, Due soon, Overdue, Blocked, Not used today, and Alarm. A failed Check reads "Done, failed" in red. |
| Step on the Test | Done (green tick), current (violet, bottom bar), next (numbered outline), with one live count. |
| Draft, record, signature | Pencil (graphite, dashed underline, "Draft") becomes ink only by signing, and the one animation shows it. Signature blue #1C3D96 is used for Electronic Signatures and nothing else. |

## The signature prompt

- **It rises out of the rail as a bottom sheet** and keeps the record visible above. Its footer is a rail with the signer at the left and Cancel beside Sign.
- **What is signed** comes first:
  - the record, and the Record Version in large type;
  - the full SHA-256 in 8-character groups, with the first 8 highlighted;
  - the Reportable Results still in pencil, the flag decision with the comment quoted, and the Import;
  - the checklist;
  - a line saying the hash is computed from exactly that content;
  - what signing does.
- **Who signs:** name, username, the role they actually hold, Lab and workstation. Then the Signature Meaning in blue with its statement.
- **Re-authentication in full.** The user ID, password and code are typed or keyed every time. Another user ID is refused without costing an attempt. Wrong credentials show the attempts left, and the fifth failure locks the account and the PC. Every error ends "Nothing has been signed."
- **Passkey (prototype only).** Here it replaces the typed password and the key touch is a labelled demo button. **Superseded for the build:** the user ID and password are always typed, and a roaming passkey is only the second factor, in place of the code (#13, #23 rules 2–3).
- **The final button names the act.** It reads "Sign as Performed", or "Sign failed Check as Performed" in red. Cancel and Escape close the prompt and return focus to the button that opened it. Clicking the scrim does nothing.

## Shared PC: identity, lock and takeover

- **Identity** sits at the rail's left end on every screen, with the idle countdown in the last minute. **The workstation** is named in the top bar and on the lock screen.
- **Lock and Switch user** are 56 px buttons at the rail's right end. The lock screen hides everything and says why it is locked: manual, 15 minutes idle, handover, a link to someone else's screen, or an account lockout. It offers 92 px tiles, then the typed password and a code or a roaming passkey as the second factor (#23 rules 1–3).
- **Takeover** ends the previous session on the server (#23 rule 1). In the prototype each person's unsaved typing stays theirs in page memory; the build saves every entry as it is made instead (ADR 0001, #38).
- **The person only changes through a sign-in.** See the fixes above.

## Alternatives considered and rejected

1. **Actions at the top or beside the content.** They need an arm lift and put the hand over the data.
2. **Big touch everywhere.** At 64 px rows, 327 Tests show seven rows a screen, and results lose their comparisons.
3. **A dark control-room theme.** Bright lab light favours a light reading surface. Only the rail is dark.
4. **A wizard for the bench flow.** It hides the record while you act. The step bar now gives the wizard's orientation without taking the record away.
5. **Hold-to-sign.** It is slow in gloves and awkward for keyboard users, and re-authentication already prevents accidents.
6. **Floating toasts.** They covered the next step at 1366.

## Design tokens (`tokens.css`)

The colours, type, spacing, radii and motion are unchanged from the original.

**Colour roles**

| Role | Hex |
| --- | --- |
| Canvas / sheet / sheet-2 | #ECEEF1 / #FFFFFF / #F5F6F8 |
| Hairline / strong line / control edge | #D5D9DF / #B7BEC8 / #7D8591 |
| Ink / ink-2 / ink-3 / pencil | #1A1E24 / #434A54 / #5C636E / #646B76 |
| Bench rail / raised / line / text / secondary | #1D212A / #2A303C / #414858 / #F3F4F6 / #B3B9C4 |
| Glove violet on sheet / on bench / hover / text / tint / line | #5B3FD9 / #7657F5 / #6A4AEE / #4A2FC4 / #EFEBFE / #B9AAF5 |
| Focus ring on sheet / on bench | #5B3FD9 / #CDBFFF |
| Signature | #1C3D96 on #EAF0FB, line #9DB2E3 |
| OK, warn, bad, idle | #17724A on #E3F3EA; #8A5300 on #FFF1D6; #B3261E on #FCE8E5 (solid #B3261E); #5C636E on #EEF0F3 |

**Type.** Atkinson Hyperlegible Next, with its slashed zero and tabular figures, at 12 / 13 / 14 / 16 / 20 / 24 px, plus 26 px for typed readings. Atkinson Hyperlegible Mono is used only for hashes, paths, raw Injection names and usernames.

**Spacing.** 4 / 8 / 12 / 16 / 24 / 32 / 48 px.

**Targets.** 40 px desk controls; 44–50 px rows and tiles; 56 px glove targets; 64 px Checks keys and 56 px sign keys; 92 px lock tiles. The frame is a 48 px top bar and a 76 px rail.

**Radii.** 4 / 8 / 10 / 12 px.

**Motion.**
- Press: scale 0.97 over 120 ms.
- Sheets: 260 ms in, 180 ms out.
- Pencil to ink: 420 ms with a 30 ms stagger.
- No motion on filtering, selection, keypad or navigation.
- Reduced motion keeps only opacity.

**Components for the React build**
- TopBar with WorkstationTag and LabClock
- Rail (IdentityPlate, RailContext with receipts, RailActions, SessionButtons)
- StepBar, reading one step model
- Status tags (StateTag with Track, HoldTag with kind, DeviationTag with Kind and RiskTag, GxpTag, FitnessTag, DueCell, CheckStatus)
- Keypad, shared by NumericField and Credentials
- SignaturePrompt and SignatureBlock
- LockScreen with UserTiles
- ConsequenceBox and ConfirmRetype
- Draft/Ink value

## Known gaps

- **Simulated.**
  - The passkey is a labelled demo button, with no WebAuthn.
  - The demo aids print the password and code.
  - Record hashes are computed in the browser as the server would.
- **Only T26-04175 has a workspace**, and only the focus Test's assignment uses the server's eligibility answer. Others mirror its rule in the browser.
- **Only the listed Tests get Holds.** Failing BAL-05 or other balances can't place Holds on specific Tests, because the data lists only BAL-04's, so the screen says so.
- **Not built:**
  - pipette gravimetric and pH entry;
  - a follow-up Import after "Request a Reinjection";
  - an Audit Trail viewer (entries are in `App.S.audit`).
- **No persistence.** A reload is a fresh first load: it resets state, including signatures and drafts, and sets the person from the link.
- **The lock screen has no keypad.** In the build, sign-in always types the user ID and password, then a code or a roaming passkey (#23 rules 1–4), so the code keypad belongs on the lock screen too.
- **Assumptions:**
  - kiosk or full-screen browsers on the bench PCs;
  - per-balance display units;
  - the at-risk rule as defined above;
  - the workstation name as fixed configuration.
- **Not yet tested** on real touch hardware or with a screen reader beyond labels, landmarks, live regions and focus order.
