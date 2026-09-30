# Bench Rail

**Axis: split every screen by reach.** The record reads densely above. Every action you commit sits in one glove-sized rail along the bottom edge, next to the name of the person signed in.

On a bench all-in-one the bottom edge is nearest the gloved hand. Tapping there doesn't cover the data you're reading, and you don't have to lift your arm to the top of the screen. The rail is the same on all four screens. Its left end shows who is signed in, its middle says what the next action will act on, its primary button names that action, and Switch user and Lock sit at its right end. The rest of the design follows from keeping reading and acting apart.

Run it: open `index.html` through any static server with `data.js` two levels up. The deep links are `#queue`, `#assign`, `#test`, `#imported`, `#sign`, `#checks` and `#check-fail`. `node candidates/c1/flows.mjs` (run from `ui-direction`) drives every click path with real mouse, keyboard and keypad input and checks 47 assertions. It writes screenshots to `shots/c1/flows/`.

## Dense data against glove-sized targets

- **Two planes, two sizes.** The reading plane uses 13–14 px text, 50 px two-line table rows and 30 px injection rows. The rail and every entry control use 56 px targets. The Lab Manager sees 15 queue rows at 1920×1080 and 9 at 1366×768 with nothing overflowing.
- **All commits happen in the rail.** Assign, Upload TargetLynx export, Save flag decision, Sign Performed, Save reading, Sign failed Check and Acknowledge alarm all live there. The rail's primary button is always the *next* commit, and its label says what it does. When it can't be pressed yet it shows a dashed outline, and tapping it answers in the rail with the reason, such as "Tick the 2 remaining checklist items first".
- **The system answers in the rail too.** Receipts ("T26-04176 assigned to Zhou Ling. Recorded in the audit trail at 10:40 EDT (14:40 UTC). Audited, not signed.") replace the rail's context line for a few seconds, next to where the hand just acted. Floating toasts were tried first. At 1366 they covered the Performed checklist, which is the very next step, so they were removed.
- **Inside the reading plane, targets are whole rows or tiles**, never inline links. The Hold reason and Deviation details appear in a detail band when a row is selected (and as a hover tip at a desk), so there are no tiny popover triggers. `shoot.mjs` reports 0 targets under 40 px on all 14 loads.
- **Entry at the bench** uses 56 px fields with 26 px digits, the unit inside the field and the limits printed under it. A 64 px keypad sits beside the rail. It works like a calculator: it always acts at the end of the value, wherever the glove touched the field. Reading fields use `inputmode="none"`, so the Windows touch keyboard doesn't rise over the rail. A physical keyboard still types normally.
- **Desk users keep density and keys.** In the queue, `/` searches, the arrow keys move between rows, Enter selects, `A` assigns and Escape clears.

## Status: a word, then a glyph, then colour

Every status is a word with its own glyph shape, so colour is only the third signal.

| What | How it reads |
| --- | --- |
| Test state | The state name, plus an 8-cell track showing its position on Requested → Reported, plus "for 9 d" in that state. The track is neutral ink because a state is neither good nor bad. The side exits (Rejected, Cancelled, Invalidated) get a hatched red track. |
| Hold | An amber tag with a pause glyph: "1 Hold". It sits beside the state and never replaces it. The reason, the steps it blocks, its date and who releases it are in the row's detail band and the hover tip. |
| Deviation | A red-outlined tag with a triangle glyph and the ID. The Risk Level tag fills more as severity rises: Minor is outlined, Major is tinted, Critical is solid. The Kind and state are written out. |
| GxP Class | GMP is an ink-outlined tag. Non-GMP is a grey-filled tag, so the exception looks different. Both carry the word. |
| Overdue | A solid red clock, "Overdue 8 d" with the original date, and a red edge on the row. |
| At risk | An outline amber clock, "Due tomorrow" / "Due Fri", "At risk", and an amber edge on the row. The rule is stated on screen: due within 2 business days and not yet Submitted for Review (14 Tests). Requested and Accepted Tests say "Not set yet, 10 business days from Ready", because their turnaround clock hasn't started. |
| Fitness Status | In use: green check circle. Quarantined: amber hatched square. Suspended: red bar. Expired: red hourglass. Retired: grey slashed circle. Each always comes with its reason, or with its next Check date or expiry when In use. |
| Check status | Done (check), Due (empty circle), Due soon (clock), Overdue (solid clock), Blocked (bar), Not used today (dash), and the missed-reading Alarm (solid red bell). A failed Check reads "Done, failed" in red, never as a green Done. |
| Draft, record, signature | **Pencil:** draft values are graphite with a dashed underline, under a "Draft values, not yet Results" tag. **Ink:** records are solid. **Signature blue** (#1C3D96) is used for Electronic Signatures and nothing else. Signing is the only thing that turns pencil into ink, and it is the one moment that animates: values transition to ink row by row. |

## The signature prompt

- **It rises out of the rail as a bottom sheet** and leaves the record visible above it. Its footer is a rail in the same place as always, with the signer's identity at the left and Cancel beside the Sign button.
- **What is being signed** comes first:
  - the record, and the Record Version in large type;
  - the full SHA-256 in 8-character groups, with the first 8 highlighted because they are what the signature block keeps;
  - the Reportable Results still in pencil, and how the flag was handled;
  - the source file and its hash;
  - a plain list of what signing does: the drafts become Results, the Test moves to Submitted for Review, and the signature shows as unsigned if this version changes.
- **Who is signing:** the signer's name at 24 px with role and username, then the Signature Meaning in signature blue with its fixed statement.
- **Re-authentication in full.** Being signed in doesn't count. The user ID, password and 6-digit code are all required. A different user ID is refused with "Only Priya Raman, who is signed in, can sign here". That doesn't count as a credential attempt, and nothing is signed. Wrong credentials say how many attempts are left before lockout. The count is always visible, turns red at 2 or fewer, and the account locks after five failures. Every error ends "Nothing has been signed."
- **Passkey** is the alternative, and it takes three deliberate steps: choose Passkey, press Sign, touch the key. The key touch is a clearly labelled demo button.
- **The final button names the act.** It reads "Sign as Performed", or "Sign failed Check as Performed" in red when signing will open a Deviation. Cancel and Escape always close the prompt. Clicking the scrim does nothing, so typed credentials aren't lost by accident.
- **Afterwards:** the values turn to ink, the Test shows Submitted for Review, and the signature block appears with printed name, native name, username, role, meaning and statement, UTC and lab time with the zone, the Record Version and the first 8 characters of the hash. The balance verification uses the same component.

## Shared PC: identity, lock and takeover

- **Identity** sits at the left end of the rail on every screen: monogram, name at 20 px, native name, role, username, sign-in time, and "Locks after 15 min idle". In the last minute that becomes a live countdown ("Locking in 0:42. Touch anywhere to stay").
- **Lock and Switch user** are 56 px buttons at the rail's right end. Switch user locks at once, so nobody can use the session while the next person signs in.
- **The lock screen** hides the frame completely. It shows whose session is locked and why (manual, 15 minutes idle, or handover), a large clock with UTC, and 92 px tiles for the people who use this PC plus "Someone else". Takeover takes one tap on a tile, then either password and code or a passkey. The passkey is the glove-friendly path. Taking over ends the previous session, and their unsaved entries stay as their drafts. The same attempts count and lockout apply here.
- **The persona only changes through Switch user.** Deep links set who is signed in. The top navigation keeps the same person, and other roles see honest read-only states. For example, the Lab Manager on the Test sees "Priya Raman is assigned. Only the assigned Analyst imports and signs", and an Analyst sees "Only a Lab Manager assigns Tests".

## Alternatives considered and rejected

1. **Actions at the top or beside the content** (the desktop convention). On a bench all-in-one this needs an arm lift and covers the data with the hand. Actions inside dense tables would also force small targets in the reading plane.
2. **Big touch everywhere** (a tablet mode with 64 px rows and cards). 327 open Tests at 64 px means seven rows a screen, and results tables lose their comparisons. Keeping reading dense and moving acting to the rail keeps both.
3. **A dark control-room theme.** Bright, even lab light favours a light, paper-like reading surface. The only dark surface is the rail, the "bench", which makes the reach zone obvious.
4. **A step-by-step wizard for the bench flow.** It hides the record while you act on it. The task column plus the rail keep the record visible and the next commit in the same place.
5. **Hold-to-sign.** Re-authentication already prevents accidental signing. A hold gesture is slow in gloves and awkward for keyboard users.
6. **Floating toasts.** Rejected during iteration, as described above.

## Design tokens (`tokens.css`)

**Colour roles**

| Role | Hex |
| --- | --- |
| Canvas / sheet / sheet-2 | #ECEEF1 / #FFFFFF / #F5F6F8 |
| Hairline / strong line / control edge (3.7:1) | #D5D9DF / #B7BEC8 / #7D8591 |
| Ink / ink-2 / ink-3 | #1A1E24 (16.7:1) / #434A54 / #5C636E (6.1:1) |
| Pencil, drafts only | #646B76 (5.4:1) |
| Bench rail / raised / line | #1D212A / #2A303C / #414858 |
| Text on bench / secondary | #F3F4F6 / #B3B9C4 (8.2:1) |
| Glove violet, action on sheet / on bench / hover | #5B3FD9 (white 6.7:1) / #7657F5 (white 4.7:1) / #6A4AEE |
| Action text / tint / line | #4A2FC4 / #EFEBFE / #B9AAF5 |
| Focus ring on sheet / on bench | #5B3FD9 / #CDBFFF |
| Signature | #1C3D96 (9.7:1) on #EAF0FB, line #9DB2E3 |
| OK: In use, Done, pass | #17724A (5.9:1) on #E3F3EA |
| Warn: Hold, at risk, Due soon, Quarantined | #8A5300 (6.3:1) on #FFF1D6, line #E6C37A |
| Bad: overdue, fail, Suspended, Expired, Blocked, Major | #B3261E (6.5:1) on #FCE8E5, line #ECA69E; solid #B3261E for Critical and Alarm |
| Idle: Retired, Not used today | #5C636E on #EEF0F3 |

**Type.** Atkinson Hyperlegible Next, built by the Braille Institute to tell similar characters apart. It has a slashed zero, tabular figures and weights 400–800, which suits standing, gloved reading of IDs like T26-04175. Atkinson Hyperlegible Mono is used only for hashes, file and dataset paths, raw injection names and usernames. The scale is 12 / 13 / 14 / 16 / 20 / 24 px, plus 26 px for typed readings.

**Spacing.** 4 / 8 / 12 / 16 / 24 / 32 / 48 px.

**Targets**

| Use | Size |
| --- | --- |
| Desk controls (filters, search, small buttons) | 40 px |
| Rows and workload tiles | 44–50 px |
| Glove targets (rail buttons, entry fields, options, checklist, list items) | 56 px |
| Keypad keys | 64 px (60 px under 1500 px wide) |
| Lock tiles | 92 px |
| Frame | top bar 48 px, rail 76 px with a 12 px bottom margin |

**Radii.** Tag 4, control 8, glove button 10, sheet 12 px. Radius grows with the size of the thing.

**Motion**
- Curves: ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; drawer `cubic-bezier(0.32, 0.72, 0, 1)`.
- Press: scale 0.97 over 120 ms.
- Sheets: 260 ms in, 180 ms out. Assignment slides from the right; the signature prompt rises from the rail.
- Pencil to ink: 420 ms, with a 30 ms stagger per row.
- Receipt: 700 ms background fade. Signature stamp: 260 ms. Lock screen: 160 ms fade.
- No motion on filtering, row selection, keypad entry or navigation, which happen tens of times a day.
- Reduced motion keeps opacity changes and drops every transform.

**Component vocabulary for the React build:**
- Rail (IdentityPlate, RailContext with receipts, RailActions, SessionButtons)
- Status tags (StateTag with Track, HoldTag, DeviationTag, RiskTag, GxpTag, FitnessTag, DueCell, CheckStatus)
- SignaturePrompt (Manifest, SignerCard, MeaningCard, Credentials, PasskeyPanel) and SignatureBlock
- LockScreen with UserTiles
- NumericField, Keypad, ConsequenceBox and ConfirmRetype
- Draft/Ink value

## Known gaps

**Built but simulated**
- The passkey is simulated by a labelled demo button; there is no WebAuthn. The "Fill demo credentials" buttons exist only for the demo.
- Record hashes:
  - Record Version 2 uses the server's hash from the data.
  - Record Version 1 is the SHA-256 of the draft's content, computed in the browser.
  - New Check records are hashed the same way.
  - The uploaded TXT is hashed for real in the browser and matches the data. Dropping a different file at a desk is refused.
- Assignment eligibility for Tests other than T26-04176 mirrors the server rule in the browser. The rule checks the Training Record on the Method version, the one on RD-SOP-0004 v6, and a current Performed Authorisation.

**Not built, or partial**
- Pipette gravimetric Checks and pH calibration entry; their panels say so.
- Only T26-04175 has a workspace. Other Tests show their details in the queue's detail band.
- A failed balance Check reports "Holds on 14 Tests" from the data, but no Tests in the queue actually gain a Hold, because the data doesn't say which ones cited BAL-04.
- "Request a Reinjection" blocks signing, but there is no follow-up import.
- There is no Audit Trail viewer. Entries are kept in memory in `App.S.audit`.
- State resets on reload, because deep links are the source of truth.

**Assumptions this prototype makes**
- The browser runs in kiosk or full screen on the bench PCs. Otherwise the Windows taskbar sits under the rail; the rail keeps a 12 px bottom margin for that case.
- Passwords are typed on a physical keyboard, or the passkey is used instead.
- Each balance's display unit (g for BAL-04 and BAL-05, mg for BAL-01 and BAL-02) is a UI choice so the Analyst types exactly what the balance shows.
- The at-risk rule is this prototype's definition.

**Not yet tested:** real touch hardware, and screen readers beyond labels, landmarks, live regions and focus order.
