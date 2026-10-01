# Signing a Test: trial k rationale

Changed: `apps/web/src/{api.ts,rail.tsx,tests.tsx,app.css}` and the viewport meta in `apps/web/index.html`. CSS only, no dependency. `pnpm check` passes, and so does the e2e run through the locked script.

## What I built

**1. Press response.** Every `.rbtn` (the rail's commit button, Sign out, and the sheet's Cancel and Sign) shrinks to 0.97 scale and darkens slightly while pressed, over 160 ms with a strong ease-out. It uses `touch-action: manipulation` and has no tap highlight. Disabled buttons don't respond. While a commit is in flight, the whole sheet sits in a disabled `<fieldset>`: the password, the fields, Cancel and Sign are all inert, and Sign reads "Signing…" ("Recording…" for unsigned steps). The rail's direct-commit button (Receive, Verify) does the same.

**2. Sheet opens and closes.** The sheet now shares the plane's grid cell, bottom-aligned, under a rail with a higher z-index. It slides up out of the rail, where the commit button was, using `@starting-style` (340 ms, iOS-drawer curve). It slides back down into the rail to close (240 ms, quicker on exit). It never covers the top bar or the rail, at any rail height. While closing, the form is `inert` and the rail's commit button isn't rendered, so no live control is on screen. The button comes back after the sheet unmounts, with a small fade-in. Focus goes into the first field on open; on coarse pointers it doesn't, so the phone keyboard doesn't hide "What you are signing". Escape closes the sheet. On close, focus returns to the rail's commit button. The sheet keeps the action it opened for, so the closing frames never show the next step's content.

**3. After the server accepts.** `useApi().reload` now returns a promise that settles once the new server data is in state. `stepAction.run` awaits it, so a commit settles only once the page holds what changed. In one frame:
- The **Status** swaps instantly. `Status` remounts by key, and the word and glyph are final from the first frame. A tinted wash behind it holds, then fades over 1.8 s. The newly lit track square gives one ring pulse.
- The **new Signature row** settles in (fade plus 6 px drop, 360 ms), then its sig-tint fades over 2 s. A `useFresh` hook diffs the previous server answer against the new one. Only rows absent from the previous answer animate, and a first load animates nothing. If the new row is below the visible part of the plane, the plane scrolls just far enough to show it.
- The **rail note** rises in 8 px with a fade, and its green bar shows with it.

None of this can start on the press: it all hangs off the server's answer.

**4. After a refusal.** The sheet stays open. A red refusal box appears in the sheet's sticky footer, next to the buttons, and gives one short horizontal shake. The password clears and gets focus. It shows a red invalid border, and `aria-describedby` points at the refusal until the person types again. The rail note shows the same refusal with no motion at all, so no part of the success motion plays (no rise, no green bar, no Status or row accent, and no reload happens). The e2e's `role=status` text is unchanged.

**5. Phone (≤ 640 px).**
- The frame's column is pinned to `minmax(0, 1fr)`. Before, the grid grew to the widest min-content and the page laid out at 1046 px.
- Top bar: brand and "Fictional data only" on one row, the module nav as a horizontally scrolling 44 px strip below.
- The Test title and its Status stick to the top of the plane, so the Status and the new Signature row are on screen together after signing.
- Facts stay as a two-column `dl`, wrapping.
- Signatures become stacked label/value cards, so the hash wraps instead of forcing a 5-column table. The Audit Trail scrolls sideways inside its own box.
- Rail: name and Sign out (44 px) on the first row, the context or note on the second, and the commit button full width and 56 px on the third. Bottom padding respects the safe area.
- Sheet: one column. Its footer (refusal, Cancel, and Sign as a wide button) is `position: sticky` at the bottom of the sheet, so Sign stays reachable in the long Enter Result sheet.
- `viewport-fit=cover, interactive-widget=resizes-content` added.

Desktop keeps the Bench Rail layout. The visible changes there: inputs are 44 px tall with 16 px text (from 40 px and 15 px), nav links have a 44 px minimum width, and the sheet's footer is sticky, which only matters when the sheet scrolls.

**Reduced motion.** No transforms anywhere. The sheet fades (150 ms opacity), the note and row fade, and the refusal doesn't shake. The Status wash appears and disappears in one step (`step-end`) and the ring is a static outline. The reveal scroll is instant.

**Double press.** A ref guard (`inFlight`) sits in front of React state, and the fieldset is disabled. Checked in the browser: a double click on Sign plus five Enter presses in the password field sent one POST and made one Signature. A forced click during the close found no actionable control.

## Considered and rejected

- **Crossfading or morphing the Status word.** Forbidden, and wrong for a record anyway. I used an instant swap with an accent around it.
- **Optimistic Status or row, or starting the close on press.** That would show a signed state before the server confirmed it. The close starts only after the answer and after the reload lands.
- **Keyframe enter/exit for the sheet.** Keyframes restart from zero if interrupted. Transitions with `@starting-style` retarget, and their `transitionend` drives the unmount, with a 400 ms fallback timer in case it never fires.
- **Moving the sheet's Sign button into the rail on phone**, with buttons tied to the form by `form=`. It's closer to "every commit in the rail", but it would mean two sets of buttons or a desktop layout change. The sticky sheet footer sits directly above the rail and does the same job.
- **A scrim over the page behind the sheet.** It would hide the record being signed, and the Bench Rail direction keeps the records visible. The sheet's shadow is enough.
- **Showing the refusal only in the rail, as before.** On a phone the rail can sit under a tall sheet, away from the field that needs fixing. It now shows in both places, and the sheet's copy is beside the button.
- **A role=alert on the sheet's refusal.** The rail's `role=status` already announces it, so I used `aria-describedby` and focus on the password field instead of a double announcement.
- **Auto-focusing the password on phones.** It raises the keyboard over what's being signed. It's skipped on coarse pointers.
- **Scrolling the new row into view without a sticky title.** On a phone the Status would scroll away. The sticky title keeps both on screen.

## Noted, not changed (outside apps/web)

`packages/db/src/db.ts` ignores `LIMS_PGPORT`: it reads `LIMS_PG`, which defaults to port 54339, the main checkout's cluster. The task's command (`LIMS_DB=trial … scripts/dev.sh`) therefore runs the API against a `trial` database that was already seeded in the main checkout's Postgres, possibly another trial's. I ran the app, the gate and the e2e with `LIMS_PG=postgres://postgres@localhost:54359` so everything stayed on this worktree's own cluster.
