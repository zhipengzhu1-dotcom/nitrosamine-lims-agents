# Blind UX evaluation of versions A, B, C, D (evaluator 1)

Evaluated in the order C, A, D, B, on desktop (1360 × 900, Test RD-S00001) and phone (Playwright `iPhone 14` profile in Chromium, 390 × 664, Test RD-S00002). Everything below comes from driving the running pages. No source, history or tickets were read.

## Ranking

1. **D**
2. **A**
3. **B and C, tied** (nominal order C, then B)

D and A behave as one design. B and C behave as another design. Inside each pair the differences are tiny.

| Pair | Size of difference to a user |
|---|---|
| D vs A | Small. Escape closes the sheet at once in D and over 240 ms in A. Nothing else a user would notice. |
| B vs C | Not perceptible. Indistinguishable in use. |
| A or D vs B or C | Small to moderate. Different close behaviour, focus handling, refusal placement, busy state, press feedback. |

## Method

- `step.mjs <ver> <device> <ana|rui|quinn>` runs one signed step. `lib.mjs` injects a recorder that samples the page every animation frame: the status in the title, the Signatures rows, the rail note, the sheet position and opacity, button states, focus, `document.getAnimations()` with timings and keyframes, DOM mutations, and fetch timings. A CDP screencast saves frames around each moment.
- `probe.mjs` is a second pass that signs nothing: press feedback, focus ring, what a finished Test offers.
- Per version and device: `<ver>-<device>/*.timeline.json` (raw), `<ver>-<device>.digest.txt` (readable timeline, t = 0 at the click or submit), `<ver>-<device>/*.frames/` (frames named by ms), `*.sheet.png` (contact sheets), numbered screenshots, `*.measure.json` (control sizes), and `<ver>-<device>-<step>.log`.
- Comparison images: `cmp-success-title-desktop.png`, `cmp-success-rail-desktop.png`, `cmp-closing-after-success-desktop.png`, `cmp-phone-success.png`, `cmp-phone-rm-success.png`, `cmp-phone-A-1.png`, `cmp-phone-A-2.png`, `cmp-phone-B-1.png`, `cmp-phone-B-2.png`, `cmp-final-title.png`.
- How the six signings per version were spent:
  - Desktop Performed: 600 ms artificial network delay, press-and-hold then a second click 3 ms after the first.
  - Desktop Reviewed: wrong password, then the correct one submitted with the Enter key.
  - Desktop Released: reduced motion.
  - Phone Performed: two taps about 18 ms apart, normal network.
  - Phone Reviewed: wrong password, then a tap.
  - Phone Released: reduced motion.
- Before the first signing on each device: Cancel with a press on the Sign button 70 ms later, Cancel with a press on the rail button 70 ms later, and on desktop keyboard open (Enter on the rail button) and Escape.

## How the pairs were established

- Static screenshots are pixel-identical within each pair apart from timestamps, hashes and audit numbers (`pixdiff.py`: sheet empty, sheet filled, busy, review sheet, refused, release sheet, press crops).
- Control sizes and positions are identical within each pair, except the Test Report link in A vs D (`*.measure.json`).
- Normalised timelines (`dnorm.py`) differ within each pair only as listed here.

**B vs C, all differences found**
- The rail's success note fades in (opacity 0 to 1 over 260 ms, plus the 6 px rise) in B. In C it only rises 6 px and is fully legible from the first frame.
- Under reduced motion B fades the note in over 160 ms. C shows it at once.

**D vs A, all differences found**
- Escape: D removes the sheet in the same frame (1 ms, no animation, rail button back with no fade). A animates 240 ms, the same as Cancel. Evidence: `D-desktop.digest.txt` and `A-desktop.digest.txt`, section `close-escape`.
- Test Report link on the released Test: 77.8 × 44.2 px in D, 77.8 × 42.2 px in A.

## Measurements shared by all four

| Item | Result |
|---|---|
| Sheet open | Slides up from the rail, 340 ms, `cubic-bezier(0.32, 0.72, 0, 1)`. First field focused about 15 ms after the click on desktop, so typing can start during the slide. |
| Keyboard open (Enter on the rail button) | Animated, the same 340 ms, in all four. |
| Double press on Sign | One POST in every run (desktop with 600 ms delay, phone with two taps 18 ms apart). One Signatures row. |
| Change before the server answers | None. With the 600 ms delay the title status, Result, Signatures row and rail note all changed in the same frame, 12 to 15 ms after the response ended. No in-between status was ever shown. |
| Press on the sheet while it closes | Dead. The sheet is `inert` 2 ms after Cancel. A press on the Sign position 70 ms later hit the page behind and did nothing. |
| Refusal | 401, sheet stays open, password cleared and focused, red field border, red rail note "Refused: the credentials are not valid. Nothing has been signed." No success animation ran. Status and Signatures unchanged. Retyping and signing worked with no extra step on desktop. |
| Phone layout | No horizontal page scroll (scrollWidth 390 = clientWidth 390). Nav strip and Audit Trail table scroll inside their own containers. All inputs 16 px font, 44 px tall. Cancel 95 × 56, Sign 251 to 263 × 56, rail main button 358 to 366 × 56, Sign out 90 × 44. |
| Phone sheet | Does not focus a field on open (no keyboard pop). Cancel and Sign stay pinned at the sheet's bottom while the content scrolls. |
| After signing on phone | The page scrolls so the new Signatures row is in view under the pinned title and status (`cmp-phone-success.png`). |
| Focus ring | 2 px solid purple outline, 2 px offset, on buttons. |
| Reduced motion | No movement. Sheet cross-fades (150 to 160 ms). New row fades in. Status wash and row tint switch in steps. Spinner becomes a pulsing dot (B, C). Result equally clear. During the cross-fade the sheet text ghosts over the page text for about 150 ms (`cmp-phone-rm-success.png`). |
| Below 44 px in all four | Test links in the Tests list are 52 × 35 px. |

## Per version and device

### C, desktop (`C-desktop/`)

1. **Confidence.** Status chip gets a lavender wash and ring for 1.6 s. The newly filled step square pings (ring, 900 ms, starts 120 ms late). New Signatures row rises 6 px and fades in over 280 ms, tinted for 1.8 s. Rail note with a green bar appears at full contrast in the first frame. Evidence: `cmp-success-title-desktop.png`, `cmp-success-rail-desktop.png`, `07-after-sign-ana.png`.
2. **Sheet.** Close is 220 ms, `cubic-bezier(0.23, 1, 0.32, 1)`. The rail's main button is back 2 ms after Cancel and works: pressing it 77 ms into the close reversed the sheet smoothly (`reopen-during-close.sheet.png`). Typed fields are cleared on Cancel (Analyte came back empty).
3. **Refusal.** Message sits directly under the password field as a red bar with `role=alert` (14 px bold, rgb(179, 38, 30) on rgb(252, 232, 229)). The input shakes ±6 px for 360 ms. The message fades in over 160 ms. Red border stays while retyping. Evidence: `12-refused.png`.
4. **Press and busy.** Hover brightens 1.08. Press scales to 0.97 with no darkening. Busy: label kept, spinner added, Sign at 0.85 opacity, Cancel at 0.6, both disabled, password read-only, wait cursor. The button grows by the spinner's width (`06-busy.png`).
6. **Keyboard and reduced motion.** Escape animates 220 ms. After Cancel or Escape, focus drops to `body`, not back to the rail button. Under reduced motion with a mouse, pressing a button changes nothing beyond the hover brightening.
7. **Defects.** Focus lost on close. Test Report link is 77.8 × 17 px.

### C, phone (`C-phone/`)

5. **Phone.** 16 px gutters. Enter Result sheet content is 1272 px in a 472 px window. On the Review sheet the password field is below the fold at open (`cmp-phone-B-2.png`, the B image is pixel-identical to C here).
3. **Refusal.** The inline message (y 563 to 619) and the focused password field are covered by the pinned action bar and the rail. Only the rail note is visible. Typing still lands in the field. Evidence: `C-phone/12-refused.png`.
1, 2, 4. As desktop. Close ran 183 ms. A tap gives brightness 0.94 and scale 0.97 (brightness only under reduced motion).

### B, desktop and phone (`B-desktop/`, `B-phone/`)

Same as C on every point, with the two note-fade differences listed above. Evidence: `B-desktop.digest.txt` against `C-desktop.digest.txt`.

### A, desktop (`A-desktop/`)

1. **Confidence.** Status chip wash for 1.8 s. The current step square scales to 1.35 with a ring at once (700 ms). New row cells rise 6 px and fade in over 360 ms, tinted for 2 s. Rail note fades in over 320 ms, so it is blank for one frame and dim for about 150 ms. A grey ring stays on the current step square.
2. **Sheet.** Close is 240 ms, `cubic-bezier(0.32, 0.72, 0, 1)`. The rail's main button is absent until the close ends (258 ms), then fades and scales in over 160 ms. A press on its position 74 ms after Cancel landed on the rail text and did nothing: the sheet did not reopen. Typed fields are kept after Cancel and Escape (Analyte came back as "NDMA").
3. **Refusal.** Message is a red box in the sheet's footer at the bottom left, about 700 px from the password field, and it shakes ±6 px for 360 ms. No `role=alert` in the sheet (the rail note is a `role=status`). The red border clears as soon as you type. Evidence: `12-refused.png`.
4. **Press and busy.** No hover change. Press scales to 0.97 and darkens to 0.92; the darkening remains under reduced motion. Busy: label becomes "Signing…", both buttons at 0.6 opacity, wait cursor, fieldset disabled. The Sign button shrinks from 183 px to about 113 px, so Cancel jumps right (`06-busy.png`).
6. **Keyboard.** Escape animates 240 ms. Focus returns to the rail button after Cancel and Escape.
7. **Defects.** Dropped press during the close. Busy-label width jump. Test Report link 42.2 px tall.

### A, phone (`A-phone/`)

5. **Phone.** 12 px gutters. Enter Result sheet content is 1204 px in a 480 px window. On the Review sheet the password label and the top edge of the field show at open. The fieldset legend sits on the card's top border on the Enter Result sheet (`cmp-phone-A-1.png`).
3. **Refusal.** The refusal box is in the pinned footer above the buttons, so it is always visible, as is the rail note. The password field is hidden under the footer but focused (`cmp-phone-A-2.png`).
1, 2, 4. As desktop. Signatures show as label and value rows, taller than B and C.

### D, desktop and phone (`D-desktop/`, `D-phone/`)

Same as A on every point, except Escape is instant and the Test Report link is 44.2 px tall.

## Why this order

- **D first.** Only version where Escape is instant. Shares A's strengths.
- **A second.** Focus returns to the rail button after the sheet closes. On phone the refusal is readable inside the sheet. A press always darkens the button, with or without motion. Typed result fields survive an accidental Cancel.
- **B and C third.** They have the better close (rail button back at once, close can be reversed), the better busy state (spinner, stable label), a hover cue, and the refusal placed next to the field on desktop with `role=alert`. They lose on keyboard focus (dropped to `body` on every close), on phone refusal (the in-sheet message is hidden), on press acknowledgement under reduced motion with a mouse, and on the 17 px Test Report link.

The gap between the two designs is not large. A reader who weights the pointer-only desktop experience most could reasonably put B and C first.

## Defects a user would hit

| Version | Defect | Evidence |
|---|---|---|
| B, C | After Cancel or Escape, keyboard focus goes to `body`. A keyboard user must tab from the top of the page to reach the rail button again. | `C-desktop.digest.txt`, `close-escape` and `close-cancel`: `s.focus body` |
| B, C | Phone: after a refusal the in-sheet message and the password field are covered by the pinned action bar. | `C-phone/12-refused.png`, `B-phone/12-refused.png` |
| B, C | Test Report link is 17 px tall. | `C-phone/final-page.measure.json` |
| B, C | Reduced motion with a mouse: no visible change on press. | `C-desktop-quinn.log`, `[press release-rm]` |
| A, D | The rail's main button is missing for about 260 ms after Cancel, and a press there is dropped. | `A-desktop.digest.txt`, `reopen-during-close` |
| A, D | Busy label swap shrinks the Sign button and shifts Cancel. | `A-desktop/06-busy.png` |
| A, D | Phone: after a refusal the password field is under the footer (the message itself is visible). | `A-phone/12-refused.png` |
| A, D | Phone: fieldset legend overlaps the card border on the Enter Result sheet. | `cmp-phone-A-1.png` |
| A, B, C | Escape animates (220 to 240 ms). | `close-escape` in each digest |
| All | Keyboard open animates (340 ms). | `open-keyboard` in each digest |
| All | Tests list links are 35 px tall. | `*/list.measure.json` |
| All | Reduced motion: sheet text ghosts over the page for about 150 ms as it fades. | `cmp-phone-rm-success.png` |

## Measured versus inferred, and not tested

**Measured:** animation durations, easings and keyframes; event, response and DOM-change times; control sizes and fonts; focus targets; POST counts; pixel equality of screenshots; frames viewed for success, refusal, busy, close and reduced motion.

**Inferred:**
- How the motion feels. Judged from frames and timings, not felt.
- That the B vs C note fade is imperceptible.
- That keeping typed fields after Cancel (A, D) is a benefit. Whether the kept draft could surface for another Test or user was not testable.
- Phone refusal: Chromium emulation has no on-screen keyboard. On a real iPhone the keyboard may scroll the focused field into view.

**Not tested:**
- Real WebKit or iOS Safari (not installed), real touch, gloves, tablet width.
- Touch-and-hold pressed state. Emulated touch-hold did not set `:active` in any version; only the flash on tap was seen.
- Network failure or timeout during signing; Escape or Cancel during the busy state; Tab order and focus trapping inside the sheet; screen-reader output.
- Each signing could run once per Test, so each variation has one sample per version and device. No Test other than RD-S00001 and RD-S00002 was touched. Both are now Reported in every version.
- Each account received two wrong-password attempts per version (one per device).
