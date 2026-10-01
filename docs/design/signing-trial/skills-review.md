I found one blocking issue. The rail note fades in from transparent, and that note states the Test's new status. The `Status` beside the title, the new Signatures row and the double-press guard all meet the rules.

**Blocking**

- `blocking: status-legibility`, at `apps/web/src/app.css:81-82` with `rail.tsx:88` and `rail.tsx:249`.
  - **What's wrong:** after the server accepts a Signature, the rail note reads "Review recorded in the Audit Trail. The Test is now Reviewed." The `note-in` animation starts it at `opacity: 0`. The reduced-motion branch at `app.css:140` also starts it at opacity 0, as a 160 ms fade. So in the first frame you see a blank rail where the new status word should be, and the word ghosts in over 260 ms (160 ms with reduced motion). The `Status` beside the title is readable from the first frame, so the two disagree.
  - **Smallest fix:** change the keyframe to `@keyframes note-in { from { transform: translateY(6px); } }` so the note only rises. Under `prefers-reduced-motion: reduce`, set `.note-text--ok { animation: none; }`.

**Met**

- `met: early-motion`. The note and the sheet's close are set only after `await take.run(...)` (`rail.tsx:178-180`). That call waits for both the POST and the reload (`rail.tsx:86-87`, `api.ts` `reload`). The Status and row accents come from the server's data through `useArrivals` (`rail.tsx:47-58`, `tests.tsx:71`). The first render marks nothing as new, and `TestPage` is keyed by id (`main.tsx:47`), so opening another Test never animates. Pressing only shows a spinner and dims the still-labelled button (`rail.tsx:237-238`).
- `met: status-legibility (the Status component)`. The word and squares render at once. Only a background and box-shadow tint and a ping outside the square fade (`app.css:61-64`, `rail.tsx:60-63`). Nothing crossfades.
- `met: unreturned-row`. A row gets `row--new` only if its key was absent from the server's previous list (`tests.tsx:71,80-82`).
- `met: failure-motion`. A refusal never closes the sheet or reloads (`rail.tsx:181-184`). The rail note gets `note-text--bad`, which has no animation (`app.css:81` animates only `--ok`). The refusal motions are a 160 ms fade on the message and a shake (`app.css:107-108`, `rail.tsx:161`), and neither is used on success.
- `met: live-control`.
  - The `inFlight` ref guard is set before the first await (`rail.tsx:173-175`).
  - From the first press, buttons are disabled (`rail.tsx:236-237,252`), inputs are read-only and selects are disabled (`rail.tsx:224,266,280`), and Escape is blocked (`rail.tsx:152`).
  - Everything stays locked until the reload lands.
  - The closing sheet is `inert` from its first frame (`rail.tsx:197`). React 19.3 renders a boolean `inert` (`apps/web/package.json`).
  - The rail button that appears afterwards belongs to the next step and only opens a sheet.
- `met: reduced-motion` (`app.css:133-144`, `rail.tsx:161`, `app.css:129-131`).
  - Movement is removed: the press scale, the sheet's slide, the row's rise, the shake, the ping and smooth scrolling.
  - Short fades remain: 160 ms on the sheet, row and note, and an opacity pulse in place of the rotating spinner.
  - The Status and row tints switch on and off instantly with `steps(1, end)`.
- `met: layout-animation`. Only transform, opacity, filter, visibility, background and box-shadow are animated (`app.css:61-69,81-82,87,100-101`).
- `met: touch-size`.
  - `.rbtn` is 56 px tall with a 44 px minimum width (`app.css:84`), and the rail commit button stays 56 px at full width on a phone (`app.css:174`).
  - Sign out is 44 px tall on a phone (`app.css:175`).
  - Phone nav links are 44 × 44 (`app.css:152-153`), and links in the page get a 44 px hit area (`app.css:41`).
  - Inputs are 44 px tall with 16 px text (`app.css:117`).
  - One note: on the worklist, rows are about 31 px apart, so the 44 px link hit areas overlap and the lower link wins the overlap.
- `met: mobile-native`. Input text is 16 px (`app.css:117`). The only hover rule is gated (`app.css:91`). Heights use `100dvh` (`app.css:29,97`).
- `met: frequency`. The change animates no typed-entry grid and no bulk queue work. The only keyboard triggers (Enter, Escape) act on the signature sheet, which the project rules list as an animated occasional surface. Advisory row 1 covers the stricter reading.
- `met: status-component`. Status is still rendered only through `Status` (`rail.tsx:56-67`, `tests.tsx:22,40`). The note's plain-text "The Test is now <State>" (`rail.tsx:88`) was there before and this diff doesn't change it; the owner may want to look at it.

**Not applicable:** `motion-library`, because the change adds no dependency.

**Advisory, for the owner; never blocking**

| Before | After | Why |
| --- | --- | --- |
| `rail.tsx:152`: Escape calls `setOpen(false)`, which plays the 220 ms slide (`app.css:100`) | When Escape closes the sheet, close it instantly (a `data-instant` flag with `transition-duration: 0ms`), with `inert` still applied in the first frame | review-animations standard 2 and STANDARDS: "Never animate keyboard-initiated actions". The project rules list the sheet's exit as animated, so this is your call |
| `app.css:62`: `step-ping 900ms … 120ms`; `app.css:61`: `status-accent 1600ms`; `app.css:67`: `row-tint 1800ms` | Ping at ≤300 ms `var(--ease-out)` with no delay. Either say in the CSS comment why the tints hold, or shorten them | review-animations standard 4, STANDARDS § Duration: "UI animations stay under 300ms". Standard 10 says a professional dashboard stays crisp. All three are confirmed-state accents, so precedence allows them |
| `rail.tsx:161`: shake `duration: 360` | `duration: 280` | review-animations standard 4: sub-300 ms UI |
| `app.css:63,69`: keyframes animate `background` and `box-shadow` | Put the tint on a `::before` layer and fade its `opacity` | emil-design-eng § "Only animate transform and opacity". This is paint work, not layout, which is why it doesn't block |
| `app.css:107-108`: `.refusal { animation: fade-in 160ms ease }` | `fade-in 160ms var(--ease-out)`. Keep it a pure fade, so it never looks like the success rise | STANDARDS § Easing: built-in easings are too weak for an entering element |
| `app.css:19`: `body { overflow: hidden }` with no root `overscroll-behavior` | `html, body { overscroll-behavior: none; }` | mobile-native §6: on Android, pulling down on the rail or top bar can trigger pull-to-refresh in the middle of signing |
| `index.html:5` adds `viewport-fit=cover`, but `app.css:150,72` pad only the top and bottom insets | `padding-inline: max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right))` on `.top`, `.plane` and `.rail` | mobile-native §7: with `cover`, a phone in landscape puts the brand and the rail's name under the notch. This change introduced that |
| `index.html:5` viewport; `rail.tsx:224` password input | Add `interactive-widget=resizes-content` and `enterKeyHint="go"` | mobile-native Baseline and §4: on Android the keyboard otherwise covers the sheet's sticky Sign button, and the return key doesn't say what it does |
| `rail.tsx:160`: focus after a refusal; `app.css:72,150`: safe-area insets (rationale: "checked only in Chromium's mobile emulation") | Test on a real iPhone and Android phone by LAN IP: keyboard after a refusal, insets, press feel | mobile-native Hard Rule 5 and §11: none of these show up in emulation |

**Other lanes:** `part11-expert` should check that the phone's stacked Signature card still shows each signature's signer name, date and time, and meaning.

```verdicts
blocking: status-legibility
met: early-motion
met: unreturned-row
met: failure-motion
met: live-control
met: reduced-motion
met: layout-animation
met: touch-size
met: mobile-native
met: frequency
met: status-component
advisory: frequency
advisory: duration
advisory: duration
advisory: gpu
advisory: easing
advisory: overscroll
advisory: safe-area
advisory: keyboard
advisory: hardware
overall: blocking
```