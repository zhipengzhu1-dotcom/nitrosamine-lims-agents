The change has **two blocking findings** (`touch-size`, `frequency`), so overall it is **blocking**. The other nine applicable rules are met. I read the builder's rationale as a set of claims and checked them against the code. They hold except for the Test Report link size below, which the rationale doesn't mention.

## Blocking verdicts

**blocking: `touch-size`, `apps/web/src/app.css:51`**
- **What the change does:** it enlarges the Test Report link on the Test page with `.facts a { display: inline-block; padding: 12px 0; margin: -12px 0; }`.
- **Why it still fails:** the text inherits `14px/1.3` from `app.css:11`. That makes the link 14 × 1.3 + 2 × 12 = **42.2 px tall**, under 44. I couldn't run a browser to measure it (the sandbox blocked the script), so this is the stylesheet arithmetic.
- **What the person at the bench sees:** after a Release, at 390 px, a thumb aimed at the report number can land just off it and nothing opens.
- **Smallest fix:** `padding: 13px 0; margin: -13px 0;` (44.2 px).

**blocking: `frequency`, `apps/web/src/rail.tsx:147`**
- **What happens:** Escape calls `close(false)`, which sets `.sheet--closing` and plays the 240 ms slide-down (`app.css:92`). When the sheet unmounts, the rail's commit button fades and scales back in (`app.css:85`).
- **Why it blocks:** closing with Escape is a keyboard-only path. Review-animations standard 2 and the project rule "keyboard paths … stay instant" both forbid animating it. The project rule does let the sheet animate when it is closed by pressing Cancel or after signing. Those paths are fine.
- **What the person at the bench sees:** after pressing Escape, the sheet takes a quarter-second to slide away, and the commit button fades back in, before they can act again.
- **Smallest fix:** in the Escape handler, set `afterClose.current = { clear: false }` and `setSheet(null)` directly instead of calling `close(false)`. Also skip the button's `@starting-style` on that path, for example with a `data-instant` attribute that sets its starting state to `opacity: 1; transform: none`.

**met: `early-motion`**
- `rail.tsx:173-176`: the note and the sheet's close start only after the POST is awaited and then `reload` (`api.ts:97,100`), so the page already holds the server's answer.
- `tests.tsx:74-79`: `useFresh` compares two server answers, and the first load marks nothing.
- The "Signing…" label is press feedback on the control itself, which the [precedence](#precedence) rules allow.
- The note's state word comes from the step registry (`rail.tsx:73`, unchanged text). The API reads the same registry.

**met: `status-legibility`**
- `tests.tsx:41`: `key={test.state}` swaps the old Status for the new one in a single render, so old and new never show together.
- `app.css:60-62`: the wash sits behind the word (`z-index: -1`), and the ring starts at `scale(1)`, so the word and glyph are final from the first frame.

**met: `unreturned-row`**: `tests.tsx:78,103`. Only Signature keys missing from the previous server answer get `row--fresh`.

**met: `failure-motion`**
- `rail.tsx:177-181`: a refusal triggers no reload, no close and no success class.
- `app.css:77`: `.note--bad` has no animation. The shake at `app.css:98-100` plays on refusals only.

**met: `live-control`**
- `rail.tsx:169`: a synchronous `inFlight` guard blocks a second press.
- `rail.tsx:201`: the whole sheet sits in a disabled `<fieldset>` while the commit is in flight.
- `rail.tsx:196`: the form is `inert` while it closes.
- `rail.tsx:258`: the rail's commit button isn't rendered while a sheet exists.
- `rail.tsx:147`: Escape does nothing while a commit is in flight.

**met: `reduced-motion`**: `app.css:122-135,183-186` and `tests.tsx:91-92`.
- All transforms are removed, including the shake and the ring.
- The sheet, note and row keep 150 ms opacity fades.
- The Status wash and row tint switch on and off with `step-end`, so status accents are instant.
- The scroll to a new row is instant.

**met: `layout-animation`**: only transform, opacity, filter, box-shadow and background-color are animated, and there is no `transition: all` (`app.css:61-68,76-81,90-92,99-100,112-114`).

**met: `mobile-native`**
- `app.css:106`: inputs and selects use 16 px text.
- No `:hover` rule exists anywhere in `apps/web/src`.
- `app.css:27`: the app shell uses `100dvh`.

**met: `status-component`**: `tests.tsx:41` and `tests.tsx:22` render through `Status`. The rail note at `rail.tsx:73` is a sentence, not a status display, and its text is unchanged.

**Not applicable:** `motion-library`. The change adds no dependency and touches no `package.json` or lockfile.

**For `part11-expert` (no verdict from me):** at phone width the Signatures table becomes stacked label/value cards (`app.css:151-157`, `tests.tsx:104-106`). That is now how a Signature's name, time and meaning appear on a phone.

## Advisory, for the owner; never blocking

| Before | After | Why |
| --- | --- | --- |
| `app.css:112` `row-in 0.36s var(--ease-out)` | `row-in 0.24s var(--ease-out)` | review-animations standard 4 / STANDARDS.md § Duration: UI animations stay under 300ms. Still plays only on a row the server returned. |
| `app.css:76` `note-in 0.32s var(--ease-out)` | `note-in 0.2s var(--ease-out)` | STANDARDS.md § Duration: a toast-like confirmation is a small surface, so 125–250ms. |
| `app.css:99` `refuse 0.36s ease-in-out` | `refuse 0.28s var(--ease-out)` | review-animations standard 4 (under 300ms). STANDARDS.md § Easing: built-in easings are too weak. |
| `app.css:62-68` ring pulse to `scale(1.35)` with an animated `box-shadow`, 0.7s | Delete the ring and keep the wash at `app.css:60-61` as the only accent | review-animations standard 10 (a professional dashboard stays crisp) and standard 7 (`box-shadow` is not transform or opacity). Remedial step 1 is to delete. |
| `app.css:81` `-webkit-tap-highlight-color: transparent` on `.rbtn` only | `html { -webkit-tap-highlight-color: transparent; }`, plus an `:active` style on `.top nav a` and `.facts a` | mobile-native §2: set it once globally, then give every tappable element its own `:active`. Nav links and the Test Report link still flash grey on tap. |
| `app.css:80` `.rbtn` without `user-select` | Add `user-select: none; -webkit-user-select: none;` to `.rbtn` | mobile-native §8: a long press on "Sign as Performed" selects the label. Control text shouldn't be selectable. |
| `index.html:5` `viewport-fit=cover`, but `env(safe-area-inset-*)` is applied only at ≤640px (`app.css:139,163`) | Apply `env(safe-area-inset-bottom)` to `.rail`, `-top` to `.top` and `-left`/`-right` to `.frame` outside the media query | mobile-native §7: on a phone in landscape (wider than 640px) the rail sits under the home indicator and the top bar under the notch. Needs a phone to confirm. |
| `app.css:17` `body { overflow: hidden }` with no overscroll rule | `html, body { overscroll-behavior: none; }` | mobile-native §6: stops the iOS rubber-band and Android pull-to-refresh on the page shell around the scrolling `.plane`. Needs a phone to confirm. |
| `index.html` has no `theme-color` | `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />` | mobile-native §10: makes the status bar match the white top bar (`--sheet`). |

```verdicts
blocking: touch-size
blocking: frequency
met: early-motion
met: status-legibility
met: unreturned-row
met: failure-motion
met: live-control
met: reduced-motion
met: layout-animation
met: mobile-native
met: status-component
advisory: duration
advisory: duration
advisory: duration
advisory: cohesion
advisory: tap-highlight
advisory: long-press
advisory: safe-area
advisory: overscroll
advisory: theme-color
overall: blocking
```