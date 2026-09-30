# Ledger & Rail

**Axis: reading and acting are separated.** Every screen is a dense, read-only *ledger*. Everything a hand acts on lives in one glove-sized graphite *rail* along the bottom of the screen, and the rail always carries the signed-in person's name.

On a standing, touch-screen all-in-one, the hand comes up from the bench. The bottom band is the shortest reach, and a hand touching it never covers the numbers being checked. A touch at the top of the screen puts the forearm across the data. Everything that confirms, saves, signs, locks or hands over happens in that band, in the same place on every screen. The screen above it is left free to be as dense as the data needs.

Files: `index.html` (shell and glyph sprite), `app.css` (tokens and components), `lib.js` (templating, lab clock, rounding, SHA-256), `ui.js` (status vocabulary, rail, sheets, keypad, signature prompt, lock screen), `screens.js` (queue, assignment, Test workspace, Checks), `app.js` (state, routes, events). Vanilla JS, no build step. Fonts come from Google Fonts.

## Dense data against glove-sized targets

- **Two registers, on purpose.** The ledger uses 13–14 px tabular text on hairline rules, with IDs and numbers in a monospace face. It has almost no controls. The rail and the sheets use 52–56 px buttons, 54–64 px keypad keys and 64 px person tiles. A nitrile-gloved fingertip touches 10–14 mm of screen, and 56 px is about 15 mm on a 23.8" 1080p all-in-one. The probe reports **0 targets under 40 px** on all 14 screenshots.
- **The queue row is one target.** Each open Test is a two-line, 44 px row carrying about 18 facts. None of them is a separate link. Tapping or clicking a row selects it. The rail then shows the Test's state, due date and every open Hold with its reason and blocked step, next to **Details** and **Assign** buttons. Arrow keys, Home/End and PageUp/PageDown move the selection. Enter assigns a Ready Test or opens Details.
- **Sheets rise out of the rail and keep its footer.** Assignment, upload, readings, balance verification and signing all open as sheets from the bottom. The footer stays a rail: the signer's name at the left, Cancel and the confirm button at the right, at the same height and position every time.
- **A keypad, not the OS keyboard.** Numeric fields use `inputmode="none"`, so the Windows touch keyboard doesn't cover the form. The app's own keypad types into the highlighted field, and a physical keyboard still works. Code fields have their own pad that only ever types into the code.
- **Bench tables stay reading surfaces.** The injections, run checks, Solutions and Preparations tables have no controls. The only controls on the imported workspace are the flag decision and the three checklist items, each 48–56 px.
- **The desk is still dense.** The queue shows 15 two-line rows at 1920×1080 and 9 at 1366×768. The state pipeline, the 20-Analyst workload band and every filter stay visible above the scrolling ledger.

## Status system

Every status is **a glyph shape + a word + a colour role**. Colour is never alone, and the same tags appear on every screen.

| Concept | How it reads |
|---|---|
| Test state | Eight pips show the position in Requested → … → Reported, followed by the state word (for example "Submitted for Review · ▮▮▮▮▮▮▯▯ 11 d 20 h"). The pipeline bar at the top of the queue uses the same pips with counts per state, and each segment is also a filter. Side exits draw hatched pips. |
| Hold | A violet pause glyph ‖ with "1 Hold" and its kind, always in its own column and never merged into the state. The reason and blocked step appear on demand: in the rail when the row is selected, in the Details sheet, and as a tooltip. |
| GxP Class | A solid neutral **GMP** tag. **non-GMP**, the exception, is a dashed teal outline so it stands out. |
| Fitness Status | In use ● green · Quarantined ◌ (dashed) amber · Suspended ⊘ red · Expired ⌛ red · Retired ⊖ neutral. The reason or basis is always written next to it ("Excursion since 29 Sep 08:06 (max −12.4 °C) · DEV-26-0093 · refuses new placements", "daily Check passed today 08:12 EDT"). |
| Overdue / at risk | "! Overdue 8 d" in red, plus a red bar on the row's left edge. "◷ At risk · due tomorrow" in amber, plus an amber edge bar. At risk means due within 2 business days and not yet Reviewed; the chip's tooltip says so. |
| Deviations | A magenta ▲ with the ID. Risk Level shows as fill weight: Minor is outlined, Major tinted, Critical solid. The Kind and Risk Level are written under the ID. |
| Checks | Done ✓ · Due ○ · Due soon ◑ · Overdue ! · Blocked ⊘ · Not used today −. A Check that was performed but failed says **"Done · failed"** in red, never a green Done. |
| Draft vs confirmed ("pencil and ink") | Imported values are *pencil*: a hatched background, dashed slate-blue border, slate-blue values and a "Draft · not your Result yet" tag. After the Performed signature they turn to *ink*: solid, with a double top rule, black values and "Results · signed Performed by Priya Raman". |

## The signature prompt

- **A full-height ceremony in two halves.** The left half is *what is signed*: the Signature Meaning in 34 px with its fixed statement in quotes; the record; the **Record Version** set large; and the full SHA-256 grouped by 8 characters with the first group highlighted, which is the same 8 characters the signature block prints. It also lists what the record contains and states the consequence ("the draft values become your Results and T26-04175 moves to Submitted for Review; a signature can never be withdrawn"). The right half is *who signs*: the printed name in 28 px with native script where the person has it, then username, role and Lab. The line "type all three again: being signed in does not count" sits above the user ID, password and 6-digit code fields.
- **Nothing is signed by accident.** Sign stays disabled until all three fields are filled. Enter moves from field to field and then to the Sign button, but never signs. There is no auto-submit on the sixth digit. Cancel is always in the rail, and from a balance Check it returns to the entry sheet with every value still typed.
- **Errors and lockout.** A user ID that isn't the signed-in person is refused by name: "Only Priya Raman (praman) can sign here; anyone else must lock the PC and sign in first". A wrong password or code is reported without saying which one was wrong. Every refusal shows the attempts left, and sign-in and signing share one counter. At the fifth failure the account locks and the PC shows the lockout screen.
- **After signing**, the signature block appears on the record: printed name, username, role, meaning, UTC and lab-local time with the zone, the Record Version and the first 8 characters of the hash. The Test moves to Submitted for Review and the drafts turn to ink.
- **One component.** Balance verifications use the same prompt, signing Performed on Record Version 1 of the Check with its own hash.
- **Passkeys.** The passkey path is shown but disabled, with the reason "No passkey is enrolled for praman on this PC". The slot exists, and gloved users would benefit most from it.

## Shared PC: identity, lock and takeover

- **Identity is the left end of the rail.** It shows a monogram, the printed name (and native name), role and username. It appears on every screen and inside every sheet's footer, so every action button sits on the same band as the name of the person it acts for. It never shrinks. The lab clock in the top bar shows EDT and UTC.
- **The idle clock is visible.** The ring around the monogram drains over 15 minutes, and the Lock button's second line reads "auto-locks in 15 min idle". In the final minute the identity block turns amber and the button counts down in seconds. At zero the PC locks.
- **Lock is one tap**, and it clears any typed password or code. The lock screen shows the locked person's name at 34 px, readable across the bench, with Unlock (password and code) or **Switch user**.
- **Takeover.** Switch user shows the recent people on this PC as 64 px tiles, plus "Someone else". The new person signs in with their own credentials. The previous session ends: anything unsigned stays saved under the previous person's name, and nothing is signed for them. A receipt names both people. Each person lands on their own home screen: the Lab Manager on the queue, Priya on her bench Test, Kenji on today's Checks.
- **Deep links.** Loading a deep link, or editing the hash in place, behaves as a completed sign-in by that screen's persona. It shows the same "X signed in on this PC; Y's session ended" receipt, so the persona change always reads as a user switch, never a role toggle.
- **Receipts.** Every audited action leaves a receipt bottom-left, above the signed-in name: assignment, flag decision, reading saved (with server time), alarm acknowledged, signature. Only one shows at a time, it auto-dismisses, and it never covers the acting side of the screen.

## Alternatives considered and rejected

1. **A per-user density toggle (compact for the desk, comfortable for the bench).** It hides a setting that moves things around on a shared PC, where the next person inherits it. Splitting reading from acting makes one layout work at the desk and at the bench.
2. **A kanban board by state for the queue.** It doesn't scale to 327 open Tests. It hides due dates, Holds and workload, and dragging with gloves is error-prone. The pipeline bar keeps the per-state view as counts and filters above a sortable ledger.
3. **A dark "instrument software" theme.** Bright, even lab lighting makes glossy all-in-one screens reflect, and the eye re-adapts at every glance between bench and screen. Light paper with a graphite rail keeps the strongest contrast exactly where the hand acts.
4. **Inline row actions and floating action buttons in the queue.** They scatter small targets across the reading area and invite accidental taps while scrolling. One row target plus the rail does the same job.
5. **A centred modal for signing.** It moves the confirm button to a different place in every dialog, and the gloved hand covers the dialog while signing. The rail-footed sheet keeps Sign where Sign always is.
6. **A left navigation sidebar.** It costs 80+ px of width at 1366, which the nine queue columns need. Navigation stays as 48 px tabs in the top bar, since it's used rarely compared with acting.

## Design tokens

**Colour roles** (every text/background pair used passes WCAG AA; the measured pairs range from 4.9:1, for the rail meta text during the idle warning, to 17.8:1)

| Role | Hex |
|---|---|
| Page (paper) / surface / surface-alt | `#EEF0EB` / `#FFFFFF` / `#F6F7F3` |
| Rule / rule-strong | `#D9DCD4` / `#B3B8AE` |
| Ink / ink-2 / ink-3 | `#15181C` / `#424951` / `#59616B` |
| Rail graphite / raised / rule / ink / ink-2 / button line | `#1C2026` / `#282E36` / `#3A424C` / `#FFFFFF` / `#C3CBD4` / `#8793A0` |
| Action / action pressed / action tint | `#1F57D6` / `#1745B0` / `#E4ECFB` |
| Danger button (failing save) | `#B42318` |
| OK (Done, pass, In use): ink / tint / line | `#17692F` / `#E0F1E4` / `#2E8B47` |
| Warn (at risk, Due soon, Quarantined): ink / tint / line | `#7A4B00` / `#FFF0C2` / `#C98A00` |
| Bad (overdue, fail, Suspended, Expired, Blocked): ink / tint / line | `#A5170D` / `#FCE3DE` / `#D0301F` |
| Hold: ink / tint / line | `#5A2D98` / `#EEE5FA` / `#7A4CC2` |
| Deviation: ink / tint / line | `#8E1450` / `#FBE3EE` / `#B81F6A` |
| Draft (pencil): ink / tint / line | `#274B7A` / `#EAF0F8` / `#6D8DB8` |
| non-GMP: ink / dashed line | `#0B5F6B` / `#1C8A99` |
| Neutral tag (Retired, Not used today, None) | `#E8EBE5` with ink-2 |
| Focus ring on paper / on graphite | `#1F57D6` / `#FFD166` (3 px) |
| Idle warning (identity block) | `#6B4A00` |
| Fictional data marker | `#FFF8E1` fill, `#C98A00` dashed border, `#7A4B00` text |

**Type.** Atkinson Hyperlegible Next for words and Atkinson Hyperlegible Mono for IDs, numbers and hashes; both keep 0/O, 1/l/I and B/8 apart at standing distance. Tabular numerals are on everywhere. Scale: 12 · 13 · 14 · 15 · 18 · 22 · 28 · 34 px; weights 400 and 700. Fallbacks: Segoe UI and Cascadia Mono/Consolas, then system CJK faces for native names.

**Spacing.** 4 · 8 · 12 · 16 · 24 · 32 px.

**Targets.** Desk minimum 40 px (filters, selects, chips; queue rows 44 px). Bench 52–56 px (rail and bench buttons, Analyst cards, gate rows, 84 px+ Check tiles). Keypad keys 54–64 px. Person tiles 64 px. Rail height 68 px (≤ 900 px tall screens) or 76 px.

**Radii.** Tag 4 · control 8 · card 10 · sheet 14.

**Motion.** 120 ms press and hover (scale .98). 200 ms sheet rise, `cubic-bezier(.2,.8,.2,1)`. A 1.6 s highlight on a newly assigned row. The idle ring moves 1 s linear per tick. All motion is off under `prefers-reduced-motion`.

**Components for the React build.** TopBar · Rail (IdentityBlock with idle ring, LockButton, RailContext, RailActions) · Sheet (with rail footer) · status tags (StateTag with Pips, HoldTag, GxpTag, FitnessTag, DueTag, DeviationTag, RiskTag, CheckTag, PassTag, DraftTag) · Ledger table · Keypad · NumericField (readout, limits gauge, limits text, commit-then-judge, RetypeConfirm) · ConsequencePanel · SignaturePrompt · SignatureBlock · LockScreen · Receipt.

## Known gaps

- **Record Version.** Handling the flag and ticking the checklist should save a new Record Version (3) and show that version's hash. The prompt shows the data's Record Version 2 and `contentSha256` as the server's answer.
- **Balance Check hash.** The Check record's hash is computed in the browser over its content, standing in for the server.
- **Deep links skip authentication.** Loading or editing a hash acts as that persona's completed sign-in, and editing the hash clears a lock screen. This is a demo affordance only.
- **Holds from a failed balance.** They are announced (14 Tests) but not attached to particular rows in the queue, because the data doesn't say which Tests used BAL-04.
- **Assignment for other Tests.** Eligibility for Ready Tests other than T26-04176 is computed in the browser with the generator's three rules.
- **Not built.** Entering pH-meter and pipette Checks; browsing the Deviations and Holds this session creates; a "Reinjection requested" path beyond blocking the signature.
- **The OS touch keyboard** still appears for the user ID, password and comment fields; only numeric fields are suppressed. Passkey sign-in is a disabled placeholder.
- **No persistence.** A reload returns to the deep link's state.
- **The lab clock** is the data's `now` plus elapsed time, with the UTC−4 offset from the data. There is no daylight-saving change.
- **Not yet tested** with a screen reader beyond semantic roles, on a real touchscreen, or with gloves. Google Fonts fall back to Segoe UI or the system font when offline.
