# Interlock

**Name:** Interlock.

**Axis:** every consequential action sits behind one glove-size key that shows what still blocks it and what it will do, and the key stays unpowered until every condition is lit.

Everything else follows from that bet: dense reading in one gear, 64 px acting in another; pencil for drafts and ink for signed values; hazard tape for Holds; a ruler that puts every number next to its limit; a dark screen when the PC is locked.

## Try it

- Entry: `candidates/c3/index.html`. Classic scripts, no build; it reads `../../data.js`. The seven hash routes are exactly `#queue`, `#assign`, `#test`, `#imported`, `#sign`, `#checks`, `#check-fail`, and each renders its state on a fresh load, as the persona `data.js` names for it.
- Clicking through: Lab queue (Hannah Kowalski) → Assign next → Test workspace (Priya Raman: Upload, handle the flag, tick the checklist, Sign Performed) → Today's Checks (Kenji Watanabe: RD-102, then BAL-04). Changing screens to another person's screen opens the take-over flow, not a role toggle.
- Demo credentials, all fictional, are in the **Demo** popover on the top bar (also `data.js`): `praman`, `kwatanabe`, `hkowalski`, password `bench-demo-2026`, codes `314159`, `271828`, `161803`. The same popover has "Lock in 12 seconds", to watch the idle lock without waiting 15 minutes.
- Constraints: static files, vanilla JS, nothing external but Google Fonts; no `alert`, `confirm`, `prompt` or `window.open`; no `localStorage`; a light page background of its own, whatever the OS setting.
- Fonts: Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono from Google Fonts (chosen because I/l/1 and O/0 stay distinct at arm's length, and the mono has a slashed zero for IDs and hashes). They load without blocking first paint; the system stack in `tokens.css` covers until they arrive, and I looked at the screens on that fallback too.

## How dense data meets glove-sized targets: two gears

The rule is one sentence: **density lives in type and columns, never in hit areas.**

**Reading gear** (queue, Preparations, results, run checks). Type is 15 px with 13 px second lines, tables are two-line rows, and the numbers that matter are mono. But nothing you can touch is small: a queue row is about 47 px tall at 1366×768 (3 rem, and the two-line content sets the floor; about 59 px at 1080p, where the root font is larger), its Test ID is a button that fills the whole cell, the Hold cell is one button the size of the cell, the 20 workload columns are 44 px+ wide and 80 px tall, pipeline segments are 56 px, filters and toggles are 44 px, and the smallest control anywhere (the Assign button inside a row, "Show all 64", the Details toggles) is 40 px. `shoot.mjs` reports 0 targets under 40 px on all seven routes at both sizes. At 1366×768 the queue shows about nine of the 327 open Tests under a sticky header, thirteen at 1080p; the pipeline counts, the search and the filters are what make 327 workable, not scrolling.

**Acting gear** (assign, upload, handle a flag, enter a reading, sign, lock, take over). The moment someone acts, the screen changes gear: a sheet slides in from the right, or the signature dialog opens, and its controls are 64 px or more: keys, entry fields, toggle rows, the number pad (68 px keys), the dock keys, flag choices (72 px), checklist items (68 px). Entry numerals are 32 px mono. The one deliberate exception: the 20 Analyst rows in the assignment sheet are 40 px, so that all 20 fit on one screen at 1366×768; the key that commits the assignment is 64 px. Rules for this gear:

- Numbers never open the operating system's keyboard. Readings and weighings use an in-page number pad (7-8-9, ±, decimal, delete, clear, Next) and the fields are `inputmode="none"`, so a physical keyboard still types into them.
- Text that must be typed (user ID, password, code, a flag comment) sits in the upper half of its surface, because the Windows touch keyboard covers the lower part. The flag comment has three quick phrases as 44 px buttons.
- Choices are big buttons, not small radios: a flag decision, a checklist item, a Check tile (68 px, 84 px on tall screens, where the board grows to use the height), and an Analyst row (40 px, the exception above). Analyst rows and flag decisions are one tab stop with the arrow keys moving the choice, as native radios do.
- The next action is always one key in a fixed place: "Assign next Ready Test" beside the pipeline, "Next Check" beside the status filters, the dock at the bottom of the workspace.
- Top bar keys for the shared PC (Lock, Switch user) are 48 px and always visible.

## The status system

State, Holds, GxP Class and Fitness Status are four different things, so each has its own shape, and none relies on colour alone: every mark is glyph plus word (or a pattern), and text contrast is measured at 4.5:1 or better (3:1 for large text) on the seven routes plus lock, take-over, Hold popover and Test drawer at 1366×768 (the in-page check ignores the faint pencil shade behind draft values).

| What | How it reads | Colour |
| --- | --- | --- |
| **Test state** | Seven notches, lit up to the state, next to the word. The pipeline strip above the table is the same ramp: counts left to right, each a filter, with the overdue and Hold counts per state. Reported is all green; Rejected, Cancelled and Invalidated are hollow notches. In Progress, the state an Analyst works in, is the one blue notch. | Ink and blue |
| **Hold** | Hazard tape: a hatched amber-and-ink edge on the row, the badge "1 Hold", and the Hold kind under it. Tap for the reason, what it blocks, when it opened, who releases it, and the linked Deviation. It never changes the state chip, because a Hold is its own record. | Amber hatch |
| **GxP Class** | The exception is the loud one. GMP is an outlined chip; non-GMP is a solid ink chip. Expedited carries a bolt and bold amber text. | Ink |
| **Fitness Status** | Chip with a shape: In use (check in a circle), Quarantined (diamond), Suspended (pause), Expired (clock), Retired (minus in a circle), then the reason on the next line, always. In use says why it is fit ("next Check 2027-03-01", "9 d left"); the others give the server's reason ("Quarterly gravimetric Check overdue since 2026-09-26"). | Green, violet, amber, red, grey |
| **Overdue and at risk** | Overdue is a solid red chip with a triangle and the days ("Overdue 8 d"); the row also gets a red left edge and a faint red tint. Due today is solid amber; at risk (due within two days) is an outlined amber chip. | Red, amber |
| **Deviation** | A chip with the mono ID and a three-bar Risk Level glyph (one grey bar, two amber, three red). Kind, Risk Level and state are in the Hold popover; the Test drawer adds the investigator and due date. | Grey, amber, red |
| **Check status** | Done (check), Due (empty circle), Due soon (clock), Overdue (triangle), Blocked (lock plus hazard tape), Not used today (minus). The legend doubles as a filter with counts. | Green, blue, amber, red |

**Pencil until signed** is the second status system, for data rather than work. An imported value is graphite, dashed-underlined and on a faint pencil shade, under a banner that says it is not your Result yet, and the record's seal is grey and shaded, "Unsigned v2 e94edde3". When the Analyst signs Performed, the same numbers turn solid ink, the banner becomes the signature block, and the seal turns solid ink and says "Signed".

**The ruler** puts a number next to its limit wherever a limit exists. For a Reportable Result, LOQ and the illustrative limit sit at the same place on every row (log scale between them), so only the marker moves: NDMA at 0.0160 ppm sits well left of its limit tick and reads 5.3 % of it. While typing a reading, the acceptance window is shaded green and the typed value is a dot (in limits) or a red diamond (outside).

## The signature prompt

One prompt for every Electronic Signature (Performed on a Test, Performed on a balance verification). It is a centred dialog with a heavy ink border and an ink title bar, so it looks unlike the sheets ("stop and check"), and it stays below the top bar so the identity plate is still visible.

- **Who.** Large avatar, printed name (with the native-script name, for example 渡辺 健二), username, role, Lab, and "Signed in on this PC since 08:12 EDT". The line under it says the login session does not count.
- **What.** The Signature Meaning as a 44 px word, then its fixed statement in quotes. Below: the record, the Record Version, and the full SHA-256 in eight-character groups with the first eight highlighted, captioned "The first 8 characters will show in the signature block". Then what this signature covers (24 draft values with the file's hash, two Preparations, the Reportable Results, the flag decision) and, in a callout, what happens next ("the drafts become your Results and T26-04175 moves to Submitted for Review; a signature cannot be withdrawn").
- **Nothing signs by accident.** The user ID is typed, not prefilled, and must match the person signed in; a different ID is refused without spending an attempt on anyone's account. Password and a fresh code are typed, or the person uses a passkey. The Sign key is unpowered until all three fields have content, and pressing it early focuses the empty field. Cancel is the same height as Sign and sits beside it; Escape cancels; clicking the scrim does nothing.
- **Failure.** Wrong credentials shake the form once, clear the password and code, and say "4 attempts are left before praman is locked". Five failures in a row, counted together across login, unlock and signing, lock the account: the dialog turns into a lock notice and offers "Lock this PC" or "Take over as someone else".
- **After.** The dialog shows the signature block (printed name, username and role, Signature Meaning, UTC time, lab-local time with zone and offset, Record Version, first eight hash characters) and stamps it in. Closing it puts the same block on the record, the state chip becomes Submitted for Review, and the dock offers "Lock this PC" and "Switch user".

## Shared PC: identity, lock, take-over

- **Identity is the whitest thing on the screen.** A white plate on the ink bar: 40 px avatar, name in 15 px bold, role and username. A ring around the avatar drains over the 15 idle minutes; in the last minute the plate turns amber and reads "Locks in 0:12". Any touch, key press or mouse wheel resets it. The plate sits outside every sheet and dialog, so it is never covered; only the lock and take-over screens replace it. The nav tabs name the person each screen belongs to; that is a demo device, and a real build would let roles decide.
- **Lock.** Lock is one 48 px key, always visible. Locking, by key or by idle, turns the whole screen dark ink (a lit lab screen that goes dark is visible across the room), names the person, and asks for the password only. Anything open is closed so it cannot be read, and is kept as that person's draft: if they unlock, the entry sheet returns with what they typed. Credentials typed into a signature dialog are never kept.
- **Take-over.** "Switch user" (or "Take over this PC" on the lock screen) opens "Who is using this PC now?" with a tile for each person who used it today and the note "Priya Raman's session ends when someone signs in. Open entries stay with Priya as drafts; nobody else can open them." The new person signs in with password and a fresh code, or a passkey; their plate replaces hers, and a toast says whose session ended. If Priya signs in again later, her draft is waiting. "Stay signed in as Priya" cancels safely.
- **Sign-in has the same lockout as signing.** Five wrong attempts lock the account, and the sign-in form says so.

## Alternatives I considered and rejected

1. **A board of cards for the queue** (a column per state). It reads well for ten Tests and not for 327: cards cannot show Customer, Product and Lot, Method, GxP Class, due date, assignee, Holds and Deviations side by side, and sorting by due date is what a Lab Manager actually does. I kept the state ramp as the pipeline strip above one dense table.
2. **One gear: glove-size everything.** 64 px rows would show about six Tests at 1366×768 and turn the queue into paging. The two-gear rule keeps hit areas at 40–48 px in the reading gear (fine for a gloved fingertip on a row that spans the cell) and spends 64 px only where a mistake costs something.
3. **"Are you sure?" dialogs and warning toasts for consequential actions.** People dismiss them by reflex. Instead the key states its preconditions as lamps beside it and stays unpowered until they are lit; pressing it early nudges the first open condition. The consequence is written before the commit ("Opens an Equipment Deviation for BAL-04. Suspends BAL-04. Puts a Hold on 14 Tests").
4. **A role dropdown or hidden persona toggle** for the changing user. It would put someone's session under someone else's name. The persona change is a visible sign-in on the shared PC.
5. **A dark theme for the whole app.** The lab is brightly and evenly lit and screens glare; ink is used only for structure, and full dark only for the locked screen so a locked PC is unmistakable.
6. **A software keyboard inside the page.** Text goes through the operating system's keyboard, which staff already know; only numbers get an in-page pad.

## Design tokens

All sizes are `rem`; the root is 16 px and 18 px from 1700 px wide, so the 1080p bench PC gets larger type and targets, not more empty space.

**Color roles**

| Role | Token | Hex |
| --- | --- | --- |
| Page, "instrument housing" | `--housing` | `#E6ECEF` |
| Content surface | `--paper` | `#FFFFFF` |
| Quiet panel, stripe | `--paper-2` | `#F3F6F8` |
| Pressed, unpowered | `--paper-3` | `#E9EEF1` |
| Hairline | `--rule` | `#CDD6DC` |
| Control border (3:1 on every surface) | `--rule-2` | `#6B7E8B` |
| Text, structure, primary key | `--ink` | `#0F2230` |
| Secondary text | `--ink-2` | `#3A4E5C` |
| Tertiary text | `--ink-3` | `#4F6270` |
| Draft values, "pencil" | `--pencil` / `--pencil-line` | `#556674` / `#8494A0` |
| Key hover, press | `--key-hover` / `--key-press` | `#1C3649` / `#0A1822` |
| Focus, selection, current step | `--accent` / ink / tint | `#2340C8` / `#1B32A4` / `#E6EBFC` |
| Focus ring on dark | `--focus-dark` | `#FFD24A` |
| Hazard tape (only hatched against ink) | `--tape` | `#F0B000` |

**Status colors** (text on tint, solid fill, icon where different)

| Status | Text | Tint | Solid | Used for |
| --- | --- | --- | --- | --- |
| go | `#14653B` | `#DDF1E4` | `#1A7A46` | In use, Done, pass |
| watch | `#6B4100` | `#FFEDBF` | `#E3A100` (icon `#9A6200`) | Suspended, Hold, due today, at risk |
| stop | `#A4141E` | `#FBE3E1` | `#C4222C` | Expired, Overdue, fail, Blocked |
| iso | `#56308B` | `#ECE4F7` | `#7645BE` | Quarantined |
| dead | `#43535E` | `#E2E8EC` | `#6C7E8A` | Retired, Closed, Not used today |
| info | `#1B32A4` | `#E6EBFC` | `#2340C8` | Due, current step |
| overdue row | | `#FDF1F0` | | tint behind an overdue row |

**Type** (Atkinson Hyperlegible Next for text, Atkinson Hyperlegible Mono for IDs, hashes and values; tabular figures)

| Step | Size | Used for |
| --- | --- | --- |
| xs | 12 px | captions, never smaller |
| s | 13 px | second lines in dense tables |
| m | 15 px | reading gear body |
| l | 18 px | acting gear labels, keys |
| xl | 24 px | screen and sheet titles |
| 2xl | 32 px | entry numerals |
| display | 30 px, 44 px | Test ID in the header; Signature Meaning |

Weights 400, 500, 600, 700. Line height 1.15 for headings and numerals, 1.35 for text. No all caps; letter-spacing only on the six-digit code.

**Space.** A 4 px base: 4, 8, 12, 16, 24, 32, 48 (`--s-1` to `--s-12`), with 2, 6 and 10 px half-steps inside dense components.

**Target sizes.** Reading gear 40 px minimum, 44 px standard (`--t-read`), queue rows 3 rem (about 47 px at 1366×768). Acting gear 64 px (`--t-act`), pad keys 68 px. Top bar 56 px, with 48 px keys.

**Radii.** 4 px tags and chips, 8 px reading-gear controls, 12 px keys and panels, 16 px sheets and dialogs, full round for avatars and lamps.

**Motion** (transform and opacity only; no `transition: all`; nothing animates on a keyboard-initiated row move)

| What | Timing |
| --- | --- |
| Press feedback on keys, tiles, segments | 90 to 120 ms, scale 0.94 to 0.985, ease-out `cubic-bezier(0.23, 1, 0.32, 1)` |
| Sheet in / out | 240 ms / 140 ms, 24 px from the right plus opacity, `cubic-bezier(0.32, 0.72, 0, 1)` |
| Signature dialog in | 240 ms, from 0.985 scale and 8 px up, transform origin at its top edge |
| Popover | 150 ms from 0.96, origin at its trigger |
| Toast in / out | 200 ms / 140 ms |
| Lock screen | 180 ms fade |
| Import arrives | one moment: rows rise 8 px over 260 ms, 40 ms apart |
| Signature stamp | 320 ms, from 1.04 scale |
| Wrong credentials | 260 ms shake; unpowered key nudge 700 ms |

`prefers-reduced-motion` removes the slide and the press scale and cuts the keyframe animations to nothing; the opacity fades stay. Hover effects are only for `(hover: hover) and (pointer: fine)`. The idle ring is the one continuous element, and it is information, not decoration.

## Parts that graft well

- **The interlock key** (unpowered dashed key, named conditions as lamps, the consequence line, and the nudge on an early press) works in any layout, and it is the smallest way to get "handle each flag first" and "type it again" right.
- **Pencil until signed**: draft values, an "Unsigned" seal, and a signature block that replaces the draft banner.
- **The queue head**: pipeline strip with per-state overdue and Hold counts, then the 20-column workload strip that doubles as the assignee filter.
- **The plate with the idle ring and the dark lock screen**, plus the take-over note about drafts.
- **The ruler**, for readings and for the Reportable Result against LOQ and the limit.
- **Hazard tape for Holds**, because it cannot be confused with any state.

## Known gaps

What I did not confirm:

- **Click-throughs at 1920×1080.** My last complete run of the click-through script, `verify/flows.mjs`, passed 152 checks at 1366×768 (queue filters, assignment, upload, flag, signing, wrong credentials, lockout, cancel, lock, unlock, take-over, idle lock, readings, retype-to-confirm, failed balance verification, draft restore, keyboard, contrast, overflow). The 1920×1080 run stalled and was stopped, and I did not find why (the script has unbounded waits, so I suspect it, not the page, but that is unproven). At 1920×1080 only the seven deep-link loads were checked, by `shoot.mjs`: no errors, no overflow, 0 targets under 40 px. After that last complete run I made two changes and ran only `shoot.mjs` again: the web-font stylesheet no longer blocks first paint, and the reduced-motion overrides were added (CSS only).
- **Not exercised by any script:** the passkey path on the take-over screen (the passkey path on the signature dialog was), "Unlock every account" and "Reset the demo", browser back and forward across screens of different people (a hashchange from outside acts like a deep link and switches the demo person without asking), opening `index.html` straight from disk instead of a static server, and the reduced-motion styles.
- **Not tested on real hardware.** Headless Chrome on macOS only: no Windows, no Edge, no touchscreen, no gloves, no Windows touch keyboard. The 15-minute idle timer is real; the Demo popover shortens it.

What is simulated or assumed:

- The file upload is an in-page picker for the two files of the Run; nothing is read. Passkey, second factor and the Audit Trail are simulated: the codes are the fixed demo codes and are reusable, and "recorded in the Audit Trail" is a message, not a store. Time is server time from `meta.now`, running on from page load; nothing persists across a reload.
- **Assignment for Tests other than the focus Test** applies the same rules client-side from the training and Authorisation records (including the prerequisite Document); for T26-04176 the server's `assignEligibility` is used as given.
- **After the failed BAL-04 verification,** the 14 Holds are placed on 14 open Tests that are In Progress or Submitted for Review, chosen by ID, because the data does not say which Tests cited which balance. They appear in the Lab queue as "Equipment Deviation" Holds. The new Deviation is DEV-26-0094, Major, Open; a Room Deviation is Minor. Consequences for a Room and for DI water beyond the brief's two rules (a Room Deviation; an Equipment Deviation) are my assumption.
- "At risk" means due within two calendar days, and overdue and time in state count calendar days, though the lab's turnaround targets are in business days.

What is not built:

- The quarterly gravimetric entry for pipettes and the pH buffer verification (their tiles open a read-only view).
- Take-over lists the three demo people; typing a user ID for anyone else is not built.
- Reassigning a Test, Reviewer and QA screens, Reports, a fuller view of closed Tests (the "Closed" toggle only adds them to the table), saved filters, and a keyboard map beyond "/" for search and the arrow keys in the table and the Analyst list.
- Quarantined and Retired chips are styled but no sample data uses them, so nothing shows them.
- The queue's Hold cell shows the first linked Deviation only (the popover and the drawer show all); the table is not virtualised (327 rows re-render in about 8 ms; the 1,276 rows of the Closed view were not timed).
- Below about 1330 px wide the top bar drops the demo button and the nav sub-labels. Nothing under 1366×768 was designed.

Files: `index.html`, `css/` (tokens, base, shell, queue, workspace, checks, overlays), `js/` (lib, model, ui, session, overlay, queue, workspace, checks, sign, app), and `verify/flows.mjs`, the click-through script above (needs Chrome, takes several minutes, not needed to review the prototype). Its screenshots of signing, lockout, assignment, readings, the failed check, lock and take-over are in `shots/c3/flows/`.
