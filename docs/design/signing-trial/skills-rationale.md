# Signing a Test: rationale (trial m)

Changed files, all in `apps/web`: `src/rail.tsx`, `src/tests.tsx`, `src/api.ts`, `src/app.css`, `index.html`. No dependency. CSS transitions and keyframes do the motion. There is one Web Animations API (WAAPI) call, for the refusal shake.

## What I built

1. **Press response.** `.rbtn` scales to 0.97 and darkens slightly on `:active` (140 ms, strong ease-out). `touch-action: manipulation`, no tap highlight, and no text selection on a long press. Hover brightening applies only on devices with a fine pointer. Under reduced motion the darkening stays and the scale goes. A busy button shows a spinner and keeps its label. It never says "Signed" before the server answers.

2. **The sheet comes out of the rail and goes back into it.** The rail and the sheet now share one `.bench` stacking context. The rail sits in front, and the sheet hangs from the rail's top edge (`bottom: 100%`). Opening slides the sheet up from behind the rail: `@starting-style`, 340 ms, iOS drawer curve. Closing slides it back down (220 ms, ease-out), so whether you cancel or sign, it goes back where it came from. The sheet stays mounted while it closes, but it is `inert` from the first closing frame, so a closing sheet never leaves a live control. It shows a snapshot of the action it opened with, so its content never switches to the next step while it slides away. `max-height: calc(100dvh - top - 100%)` works because `100%` there is the rail's own height, so the sheet fits above a rail of any height (the phone rail has no fixed height). Esc closes it. On a fine pointer, the first field gets focus.

3. **After an accepted Signature.** `useApi.reload` now returns a promise that resolves once the reloaded Test is in state. `commit` keeps every control locked until both the POST and the reload have answered. Then the Status, the new Signatures row, the rail note and the sheet's close all land in the same moment. Each one starts only from the server's answer:
   - **Status.** The new word and glyph render at once, with no crossfade. A violet tint behind the Status holds, then fades (1.6 s), and the newly lit step pings once (ink when the Test is Reported). `useArrivals` marks a state as new only when it differs from what this component showed before. A page load never animates.
   - **Signatures row.** `useArrivals` again, keyed on the rows the server returned. A row the server returned settles in from 6 px above and holds a signature-blue tint that fades. If the row is off screen it scrolls into view (`block: 'nearest'`; smooth only when motion is allowed).
   - **Rail note.** The success text rises 6 px and fades in.

4. **Refusal.** The refusal appears inside the sheet, under the password field (`role="alert"`, red bar). The field is cleared, marked `aria-invalid`, refocused and shaken once with WAAPI (skipped under reduced motion). The sheet stays open with its entered values. The rail note shows the same refusal with no motion, because rising in is the success motion. No Status tint, row or ping can run, because nothing was reloaded. My check script confirms there are zero `.row--new` and `.status--fresh` elements after a refusal.

5. **Phone (≤ 640 px).** The frame's column is `minmax(0, 1fr)`. Before, the content's min-content width stretched the page to 781 px. The top bar takes two rows: the brand and the "Fictional data only" badge, then a nav that scrolls sideways with 44 px targets. The Test title and Status stick to the top of the page, so the Status accent stays in view while the page scrolls to the new row. Facts wrap. Each Signature becomes a stacked card (Meaning and signer, then Time, Record and SHA-256 with inline labels). The Audit Trail scrolls sideways inside its own box. The rail becomes a grid: name and a 44 px Sign out, then the note, then a full-width 56 px commit button. Safe-area padding is added, with `viewport-fit=cover` and `theme-color`. The sheet shows one column, and its Cancel and Sign buttons sit in a sticky foot that is always reachable. Inputs are 44 px tall with 16 px text everywhere. Links in the page get a 44 px hit area from a pseudo-element, without changing the layout. Desktop keeps the Bench Rail layout, and its screenshots match the old ones except for the motion.

## Inertness: how the rules hold

- A ref guard (`inFlight`) plus `disabled` buttons and `readOnly` inputs from the first press. The inputs are `readOnly` rather than `disabled`, so the password keeps focus and the phone keyboard stays up for a retry.
- No sheet button comes back after success until the reload has landed, so the old step's button never shows again for a moment.
- Verified with Playwright against the running app:
  - A double click, plus a click on the Sign button's spot during the closing animation, plus five more clicks there: exactly one Reviewed Signature, and no refusal.
  - Enter pressed three times in the password field: one Signature.
  - A wrong password, then a retry by keyboard: signs.
  - Under reduced motion, the sheet has no transform and only fades in and out.

## Considered and rejected

- **Morphing the commit button into the sheet** (shared-element). It needs JavaScript layout measurement and fights the rule that a closing animation leaves no live control. Sliding from behind the rail already shows the origin.
- **Optimistic Status or row on press.** Forbidden. The Signing… state is shown only as a spinner on a still-labelled, locked button.
- **Crossfading the Status word, or animating the track squares' fill.** Old and new would both be visible. I used an accent behind a word that is final from the first frame.
- **A scrim behind the sheet on desktop.** It would dim the record you are signing, which you may need to read while signing. On a phone the sheet already covers the page.
- **Drag-to-dismiss with a grab handle.** Not asked for. It needs pointer-tracking JavaScript, and a handle that doesn't drag would be a false affordance.
- **Showing the refusal only in the rail.** The rail sits below the sheet's Sign button, far from the field you retype. The refusal now appears in both places, because the end-to-end test reads the rail and the person reads the field.
- **Spring physics.** CSS only and no dependency, so I used the strong ease-out and drawer curves instead. The transitions can be interrupted (cancel and reopen mid-slide retargets smoothly).

## Checks

- `pnpm check`: passes.
- `e2e-locked.sh`: 1 passed.
- Screenshots at 1440 × 900 and 390 × 844, mid-motion and settled, are in `shots/`. The driver scripts are `look.mjs` and `check.mjs`.

Note: I ran the dev server and the end-to-end test with `LIMS_PG=postgres://postgres@localhost:54369`, because Node reads `LIMS_PG` and ignores `LIMS_PGPORT`. Without it, the API used the shared 54339 cluster while `pg.sh` used 54369.

## Not verified

Real-device behaviour: iOS keyboard focus after a refusal, the safe-area insets, and how the press feels under a finger. I checked those only in Chromium's mobile emulation.
