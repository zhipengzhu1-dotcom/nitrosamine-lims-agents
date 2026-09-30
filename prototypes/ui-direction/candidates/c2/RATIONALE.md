# Ledger and Rail

**Axis: reading and acting never share a surface.** Every screen is a dense ledger (the record, read at 13 px in 40 px rows) beside a fixed rail where every action that changes a record lives at glove size (56 px controls, 64 px signature button), stacked in the order the work happens, with the primary action pinned to the bottom. The rail is tinted nitrile-blue because it is the part of the screen that gloved hands touch.

Files: `index.html`, `app.css` (tokens and components), `app.js` (state, routing, screens). Vanilla JS, no build, data from `../../data.js`, never edited. Routes: `#queue`, `#assign`, `#test`, `#imported`, `#sign`, `#checks`, `#check-fail`.

## Dense data against glove-sized targets

The tension is resolved by declaring two densities and never mixing them:

- **Ledger density.** Tables at 13 px with 12 px second lines, tabular numerals, one continuous white surface with hairline rules, no cards. Nothing in the ledger changes a record. The only taps in it are *selection* (a queue row, a Check row), and a selectable row is at least 40 px tall on the desk queue and 56 px on the bench Checks list; two-line cells (Test over Sample, Product and Lot over Customer, state over time-in-state) spend that height on information instead of padding.
- **Rail density.** 16 px type; 56 px inputs with 24 px values and the unit beside them; 48 px checkbox rows; 56 px buttons; the signing button at 64 px. The rail is sticky, scrolls on its own, and pins the primary action and the statement of consequence in a footer, so the thing the person came to do is never below the fold. A numeric keypad (46 px keys) lives in the rail footer for readings and weighings; it opens by default on tall screens and folds behind "Show keypad" at 768 px so the confirm field stays visible.
- The queue is a desk screen, so it keeps desk density (40 px rows, 40 px filter controls) but still meets the 40 px floor everywhere, which lets a Lab Manager use it at a bench PC.

At 1366×768 the queue shows the state counts, seven filters, search and ten rows plus the 20-Analyst workload; at 1920×1080, seventeen rows. The harness reports no horizontal overflow and no target under 40 px on any route at either size.

## The status system

Status is always word + glyph + place; colour is the third signal, never the only one.

- **Test state** is the word in its own column, with an 8-segment lifecycle track beneath it (Requested to Reported) filled to the current state, and the time in state. A row's position in the flow reads at a glance without reading the word.
- **Holds** are separate from state: a pause-glyph pill ("2 Holds") in its own column, reasons on hover and in full in the rail panel (kind, reason, what it blocks, when opened, who releases it). A held Test keeps its state word.
- **GxP Class** is a solid ink tag for GMP and an outlined tag for non-GMP: distinguished by fill, not hue, so it survives any colour deficiency.
- **Fitness Status** is the word with a glyph (check for In use, barred circle for Suspended, triangle for Expired or Quarantined, dash for Retired) and the reason in text right after it, wherever equipment, a Pack or a Solution is cited: Preparations, the Run, Solutions, Check rows.
- **Due dates** show the date and then "Overdue 6 d", "Due today", "Due in 2 d" or "in 8 d", counted in business days; overdue is red with the triangle, at risk (within two business days) is amber with the half-circle.
- **Deviations** show their ID with the triangle, coloured by Risk Level (Minor neutral, Major amber, Critical red); the rail panel adds kind, state, title, Investigator and due date.
- **Check status** words (Done, Due, Due soon, Overdue, Blocked, Not used today) each have their own glyph.
- **Draft against confirmed** is the one place a texture is used: draft values sit on a hatched warm tint with a "Draft" tag; after the Performed signature the hatch goes, the tag turns to "Confirmed by your Performed signature", and the signature block appears under the Results heading.

The same components and words appear on every screen, and every name is a glossary term.

## The signature prompt

A centred modal (modals keep centre origin) that answers, in order, who, what meaning, what record, what changes, then asks for credentials:

- **Who.** The signed-in person's name at 26 px with username, role and Lab, in a plate at the top. The typed user ID must match; a mismatch is refused with a sentence naming the signed-in person and does not consume an attempt.
- **Meaning and statement.** "Performed" and its fixed statement in quotes, straight from `signatureMeanings`.
- **Record.** Record name, Record Version in bold, and the full SHA-256 in monospace grouped by eight; for a balance Check the hash is computed from the typed readings with WebCrypto while the dialog opens.
- **What changes.** A plain sentence: the Test moves to Submitted for Review, 24 draft injections and 6 Reportable Results become the person's results.
- **Credentials.** User ID, password, and a fresh authenticator code in three 56 px fields; a passkey button explains when none is registered. The Sign button stays disabled until all three are filled, so Enter cannot sign an empty form; Cancel and Escape sign nothing. Wrong credentials show "Wrong password or code. N attempts left before the account locks."; the fifth failure locks the account, disables the form and says an Admin must unlock it. The same prompt signs the balance verification.
- **Afterwards.** The signature block manifests on the record (240 ms ease-out) with printed name, username, role, meaning and statement, UTC and lab-local time with zone, Record Version and the first 8 hash characters; the rail turns into a "Signed Performed" summary whose only action is "Lock this PC".

## The shared-PC design

- **Identity.** The signed-in person is the largest text in the chrome: name at 17 px bold (with native name where one exists) in a plate at the top left of every screen, with role, username, Lab and the idle countdown ("locks in 14:59") ticking every second. Persona changes between screens are a real switch of user, not a role toggle.
- **Lock.** A Lock button on every screen and an automatic lock after 15 idle minutes. The lock screen is opaque: a locked PC shows nobody's records. Unlock needs the same person's credentials.
- **Takeover.** "Switch user" from the top bar, from the lock screen, or automatically when a navigation needs a different person: the previous session is closed and the screen says "Anything they had not saved is not carried over"; typed-but-unsaved Check values are discarded on switch. The next person picks their name from large tiles (or types a user ID), enters password and code, and lands on the screen they asked for. Failed logins count towards the same five-failure lock.

## Alternatives considered and rejected

1. **Side navigation with a card grid.** The default admin layout. Rejected because 768 px of height is the scarce resource at the bench, a sidebar wastes 200 px of width the queue needs, and cards fragment a record that is better read as one ledger.
2. **Actions inline in the data** (assign buttons in rows, editable cells, popovers on flags). Rejected because it forces every cell to be a 44 px target, which halves the rows per screen, and because a gloved hand next to a dense table mis-taps. Selection is the only in-data tap; everything else moves to the rail.
3. **A dark, high-contrast theme for the bench.** Rejected because the lighting is bright and even, where a dark UI reads as glare and reflections; light paper with true ink and one blue holds up better under lab lighting and prints the same way it reads.
4. **Hold-to-sign or a drag-to-confirm slider instead of retyping credentials.** Rejected because Part 11 wants the full re-authentication anyway; the safeguard against accidental signing is the empty-form rule and Cancel, not a gesture.
5. **An always-open on-screen keypad.** Rejected at 768 px because it pushed the confirm field and the consequence below the fold; it is collapsible and open by default only on tall screens.

## Design tokens

Colour roles (all text colours meet WCAG AA on the surfaces they sit on):

| Role | Hex | Used for |
| --- | --- | --- |
| paper | #FFFFFF | ledger surfaces, dialogs |
| paper-2 | #F5F7FA | table heads, quiet fills |
| floor | #E8ECF2 | page background |
| rail | #E4EBF8 | the action rail (nitrile tint), line #C6D3EE |
| ink | #16213A | text, GMP tag fill, lock screen |
| ink-2 | #47526A | secondary text (the rail's secondary text) |
| ink-3 | #66718A | tertiary text on white only |
| rule / rule-2 | #C7CFDB / #E1E6EE | borders, fine rules |
| act | #2B4FC2 | primary actions, focus, selection (act-2 #22409F hover, tint #DBE4FA) |
| ok | #0B7A4B on #DBF2E5 | In use, Pass, Done, Confirmed |
| warn | #9A4A00 on #FFEED2 | at risk, Due soon, Expedited, Quarantined, Major, flags |
| bad | #B3261E on #FBE1DE | Overdue, Fail, Suspended, Expired, Blocked, Critical, errors |
| hold | #6236B0 on #ECE4F9, line #C9B6EA | Holds |
| draft | #7A4E00 on #FFF5DB + 135° hatch, line #E6CC8F | draft values |

Type: Atkinson Hyperlegible Next 400/500/700 for everything (unambiguous 0/O and 1/l/I at arm's length), Atkinson Hyperlegible Mono for hashes, file names and paths only. Tabular lining numerals throughout; the true minus sign for negatives. Scale (size/line): 12/16, 13/18 (ledger), 14/20 (body), 16/24 (rail), 17/20 (identity), 20/26 (screen title), 22/28 (Test ID in the rail), 24/32 (rail input values), 26/32 (signer name, lock title).

Spacing: 4, 6, 8, 10, 12, 14, 16, 20, 24 px; ledger padding 16/20, rail padding 16, table cells 4/6 (queue) and 4/8 (dense tables).

Targets: 40 px floor (queue rows, filters, sort headers, quiet buttons), 44 px (tabs, nav, picks), 46 px keypad keys, 48 px (checkbox rows, alarm button), 56 px (Check rows, rail inputs and buttons, lock tiles), 64 px (Sign Performed, Save and sign).

Radii by hierarchy: 4 px tags, 6 px controls, 10 px panels, 14 px dialogs.

Motion: press feedback `scale(.98)` at 120 ms (100 ms on keys); dialogs enter with opacity + `scale(.98)` over 180 ms `cubic-bezier(.23,1,.32,1)` via `@starting-style`; the signature block manifests over 240 ms; toasts translate 8 px over 200 ms as transitions, not keyframes; draft-to-confirmed background fades over 300 ms; selection, filtering, keyboard actions and rail swaps do not animate. Hover styles are gated behind `(hover: hover) and (pointer: fine)`; reduced motion keeps opacity fades and drops movement.

## Known gaps

- The idle lock is real (15 minutes) but not shortened for the demo; the countdown shows it working.
- A failed balance Check reports the 14 Holds it places but does not mark those Tests in the queue (the data does not say which they are).
- Eligibility for Tests other than the focus Test is computed in the browser from the same rule the server applies; the real build asks the server.
- Pipette gravimetric verification and pH calibration are described, not entered; passkeys are explained, not implemented; "Someone else" can only sign in with one of the three demo credential sets.
- The queue re-renders its 327 rows on every filter change, which is instant here; a React build should virtualise past a few thousand rows.
- No editing of saved values, so Reason for Change and Critical Data Change are not shown.
- The dialog focus trap is a light one (Tab wraps, Escape cancels); the lock screen deliberately cannot be dismissed with Escape.
