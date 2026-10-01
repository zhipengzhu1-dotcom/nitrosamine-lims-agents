# Blind UX evaluation: signing flow, versions A–D

Evaluated in the order B, D, A, C. The desktop pass used RD-S00006 at 1360×900. The phone pass used RD-S00007 with Playwright `devices['iPhone 14']` on Chromium. Each version ran the full flow: Enter Result → Performed (ana), Review with a wrong password then the right one (rui), Release under `reducedMotion: 'reduce'` (quinn).

## Method

- `pass.mjs` drives the flow. An in-page `requestAnimationFrame` monitor logs, on every frame, what a user sees: the title and status, the Signatures row count, the bottom-rail text, the sheet's position, opacity and transform, the sign button's label, disabled and aria-busy state, and the live-region text. Times are in ms from the press.
- `getAnimations()` was sampled at +15/80/200 ms (open and close) and at +15/100/300 ms and response+80/250 ms (sign), with keyframes.
- Screenshot bursts were taken every 40–50 ms (files `b-<moment>-<idx>-<t>ms.jpg`). Each context also recorded video (`video-*`).
- The POST sign requests were delayed on purpose: 1200 ms for Performed, 600 ms for the refusal and 800 ms for Release. This makes the busy state and any optimistic update visible. Review was signed with no delay.
- Every sign was a double press: two clicks or taps 70 ms apart on the sign button. The exception is the wrong-password press, which was single.
- The raw logs are `<V>-<device>.out`. The condensed ones are `<V>-<device>.sum.txt`. The evidence folders are `<V>-desktop/` and `<V>-phone/`.
- Comparison images: `cmp-busy.png`, `cmp-refused-B-left-D-right.png`, `cmp-phone-refused-B-top-D-bottom.png`, `cmp-escape-B-top-D-bottom.png`, `cmp-sheet-A-top-B-bottom.png`.
- `B-desktop-dry/` holds a rehearsal on RD-S00006 that only opened, cancelled and escaped the sheet, with nothing signed.

## Headline: two families

Normalised diffs of the summaries, plus pixel diffs of the static screens, show that the versions come in pairs.

- **A ≡ D** on phone: identical timelines, and the sheet and refusal screens are pixel-identical. On desktop they differ in exactly one thing: **Escape**. D closes instantly (sheet removed at 4–6 ms, no animation). A slides the sheet away in 240 ms, or fades it in 150 ms under reduced motion.
- **B ≡ C** in everything a user can see. The only measured difference is the bottom-rail note's entrance: B fades it in and slides it 6 px, while C slides it 6 px with no fade. Under reduced motion B fades the note in over 160 ms and C shows it at once. The sheet, refusal and release screens are pixel-identical (`B-*/r3-refused.png` vs `C-*/r3-refused.png`, diff bbox None).

The two families differ as follows.

| | B / C | A / D |
|---|---|---|
| Busy state | Label unchanged, spinner icon added, button `disabled` + `aria-busy=true`, Cancel dimmed | Label changes to "Signing…", button fades to 0.6 opacity (not `disabled`, no aria-busy) |
| Refusal placement | Message inserted under the password field, so the desktop sheet grows 46 px upward (top 355→309) | Message sits in the action row (desktop: left of Cancel; phone: just above the buttons), so the sheet keeps its size on desktop |
| Refusal motion | Password **input** shakes (WAAPI translateX −6/5/−3, 360 ms) and the message fades in over 160 ms | The **message** shakes (translateX −6/5/−3/2, 360 ms) |
| Closing | transform 220 ms `cubic-bezier(.23,1,.32,1)`, then hidden (`visibility`), and the sheet stays in the DOM | transform 240 ms `cubic-bezier(.32,.72,0,1)`, then removed from the DOM |
| Escape | Animated, the same 220 ms slide (160 ms fade under reduced motion) | D: instant. A: animated, 240 ms slide (150 ms fade under reduced motion) |
| Rail button during close | Rail action button comes back immediately, while the sheet is still sliding | Rail action button comes back when the sheet is gone (~300 ms) |
| Hover / press | Hover brightens (filter 1.08). Press: scale 0.97 | No hover change. Press: scale 0.97 + darken (0.92) |
| Live regions on refusal | Refusal text is announced in two regions (sheet + rail) | Once |

## Per point (desktop and phone; numbers are measured)

### 1. Confidence after signing (all four are equivalent)
- No version changes anything before the server answers. With the 1200 ms delay, the POST resolved at 1234–1243 ms and the status, Signatures row and rail note all changed at 1247–1262 ms, in the same frame. During the wait only the button changes (`*-*.sum.txt`, timeline `sign-performed-double-slow`).
- Then, in all four: the sheet slides away (220/240 ms), the status chip changes (e.g. "Assigned → Submitted For Review") with a highlight wash (B/C `status-accent` 1600 ms, A/D `wash` 1800 ms), the step pips ping or ring, the new Signatures row fades or slides in (B/C 280 ms, A/D 360 ms) and stays tinted for about 2 s, and the rail note reads "<Step> recorded in the Audit Trail. The Test is now <State>." The confirmation is unmistakable in all four (`<V>-desktop/m-sign.png` for B and D, and `cmp-busy.png` column 4).
- On phone, the page shows the Signatures card with the new row tinted (`<V>-phone/q3-after-sign.png`).
- Double press: every version sent exactly **one** POST per signing (network log in `.out`) and added exactly one Signatures row (sigRows 0→1→2→3).

### 2. The sheet
- Opening is identical in all four: it slides up from the bottom (translateY 100%→0, 340 ms, `cubic-bezier(.32,.72,0,1)`), settling at about 396 ms. The rail's action button disappears as the sheet arrives, so it reads as "the rail button became the sheet". The motion is quick enough but not instant.
- Cancel: B/C slide down in 220 ms and are hidden at 239–273 ms. A/D slide down in 240 ms and are removed at 308 ms.
- Pressing while it closes: in every version the sheet becomes `inert` at once. A hit-test at the Sign button's position 20 ms after Cancel or Escape returned the page beneath, never the sheet. So a stray second press cannot re-sign. It falls through to the page, which held nothing pressable at that spot in my runs.

### 3. Refusal
- All four answer a 401 with "Refused: the credentials are not valid. Nothing has been signed." in red, shown in the sheet and in the rail. In all four the password field is cleared, marked `aria-invalid`, focused, and ready for retyping. The status, Signatures and other cues stay unchanged, and no success cue plays.
- On desktop, B/C put the message next to the field (good proximity), but the sheet jumps 46 px taller. A/D keep the sheet still and put the message by the buttons (`cmp-refused-B-left-D-right.png`).
- **On phone, B/C's in-sheet message and the shaking field are scrolled out of view** inside the sheet. The user sees only the rail line. In A/D the message appears in view, directly above the thumb-zone buttons (`cmp-phone-refused-B-top-D-bottom.png`, frames 651–801 ms). In both families the rail grows by about 10 px on phone and nudges the sheet's buttons up.

### 4. Press feedback and busy state
- All four: press scale 0.97 (140–160 ms transition), and the busy state appears within 7–26 ms of the press.
- B/C: spinner plus disabled. A/D: the words "Signing…" plus a fade. Both are clear. A/D's wording is slightly more explicit, while B/C's keeps the label and is properly disabled and aria-busy (`cmp-busy.png`).
- Under reduced motion, the B/C spinner becomes an opacity pulse. A/D need no change.

### 5. Phone (iPhone 14, 390×664)
- No horizontal page scroll in any version (scrollWidth 390 = clientWidth). The top nav scrolls sideways inside itself and cuts off at "Docum…", the same in all four.
- All inputs are 16 px and 44 px tall. The sheet buttons are 56 px tall (Cancel 95 px wide, Sign 251 px in B/C and 263 px in A/D). The rail's main button is 358–366 × 56. Sign out is 90 × 44.
- **Shared defect:** the Test links in the Tests list are 52 × 35 px, below 44 (`layout tests-list` in every `.sum.txt`).
- Thumb use is comfortable in all four: the actions sit at the bottom. On phone the password field sits below the sheet's fold, so you scroll inside the sheet to reach it in every version.

### 6. Keyboard and reduced motion
- Escape: **D is instant** (0 ms, and the first frame is already closed, see `cmp-escape-B-top-D-bottom.png`). A animates 240 ms, B/C 220 ms. Under reduced motion, D is still instant, A fades in 150 ms and B/C fade in 160 ms.
- With reduced motion on, all four drop every translate: the sheet open and close become opacity fades (A/D 150 ms linear, B/C 160 ms ease), the row-in becomes a fade, and the pings and rings are dropped. The status wash and row tint (colour only) remain. The result is just as clear (`<V>-*/q3-after-sign.png`).

### 7. Polish and defects
- B/C desktop: the refusal makes the sheet jump 46 px.
- B/C phone: the refusal feedback in the sheet is off-screen.
- B/C: the refusal is duplicated in two live regions (a screen reader would announce it twice; inferred from the DOM).
- B/C: while the sheet is still sliding away, the rail button reappears underneath it (a small visual overlap, see the 41 ms frame in `cmp-escape-B-top-D-bottom.png`).
- A/D: the busy Sign button is not `disabled` and has no aria-busy (a screen-reader concern only, since a second press still sends nothing).
- I saw no flicker, no broken state and no optimistic update in any version.

## Ranking
1. **D**: instant Escape (with or without reduced motion), refusal visible in place on phone, no sheet jump.
2. **A**: the same as D apart from the animated Escape (240 ms).
3. **B** and 4. **C**: tied in practice. B is placed above C only because its rail note fades as well as slides, which is not perceptible. Against A/D they lose on the phone refusal (feedback off-screen), the desktop sheet jump on refusal, and the animated Escape.

## Not tested or inferred
- I could not test opening the sheet by keyboard, the focus order, focus return after close, or Enter-to-submit. After the flow the Tests were Reported, no sheet action remained, and I was limited to these two Tests.
- I did not test pressing Cancel while a signature is in flight.
- No real touch hardware, no WebKit and no on-screen keyboard (so the iOS focus zoom was judged from font-size only).
- Screen-reader effects are inferred from the DOM.
- Hit-test timings are approximate, about ±20 ms, because screenshots ran alongside them.
