# Trial brief: the signing flow on the Test page

Approved by the owner on 2026-10-01. Serves [Prototype the signing flow with and without the design skills](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/51).

Both builders receive the section "The task" word for word. The only difference between them is one added line: the skills build is told to load `emil:emil-design-eng`, `emil:animate`, `emil:mobile-native`, `emil:apple-design` and `frontend-design` before it starts. The control is told nothing about skills.

## The task

Make signing a Test feel finished, on a desktop and on a phone. Work in `apps/web` only.

Today a person on the Test page (`#/tests/<id>`) presses the commit button in the bottom rail, a signature sheet appears above the rail, they type their password and press "Sign as <Meaning>". The sheet vanishes, the Status beside the page title changes, a row appears in the Signatures table and the rail shows a note. Nothing moves, nothing responds to a press, and at phone width the layout breaks.

Build these, and nothing else:

1. **The rail's commit button and the sheet's buttons** respond when pressed.
2. **The signature sheet opens and closes** in a way that shows where it came from and where it went.
3. **After the server accepts a Signature**, the page shows what changed: the Status beside the title, the new row in the Signatures table, and the rail's note.
4. **After the server refuses** (a wrong password), the sheet shows the refusal clearly and stays ready for another try.
5. **Phone width** (390 px wide, portrait): the Test page, the rail and the sheet are laid out for a phone. Desktop keeps the Bench Rail layout as it is.

### Rules every build must follow

These are decided for this LIMS. They are not suggestions.

- Nothing signed, judged or given a status is shown before the server confirms it. Motion on those values starts only after the server's answer, never on the press.
- A new status word and glyph are legible from the first frame. Motion is an accent on a confirmed state. Never crossfade or morph so that the old and new status are both visible.
- A row animates in only if the server returned it.
- A refused or failed action never plays the success motion, even partly.
- A control is inert from the first press until the server answers. A double press, including one during a closing animation, can never sign twice. A closing animation never leaves a live control on screen.
- Honour the device's reduced-motion setting: movement removed, short opacity fades allowed, status accents instant.
- Every control is at least 44 × 44 CSS px. The rail's commit buttons stay 56 px tall. Text in inputs is at least 16 px.
- CSS only. Add no dependency.
- Render a status only through the `Status` component. Read server data only through `useApi`.
- Keep the Bench Rail direction: the colours, type and tokens in `app.css`, the dense records above, every commit in the bottom rail. This is not a redesign.
- Change nothing outside `apps/web`. The end-to-end test in `apps/web/e2e` must still pass.
- Fictional data only. Add no demo aid, label or note that says how the build was made.

### What to hand back

- The change, uncommitted, in your worktree.
- A short rationale in the scratch path you were given, not in the repo: what you built, what you considered and rejected.

## How the four versions are made

1. Two Opus builders run from this brief in separate worktrees, at the same time, without seeing each other's work.
2. The draft `design-reviewer` reviews each build's diff.
3. A copy of each build goes to an Opus fixer that loads no skills and is given only the reviewer's findings. That copy is the reviewed twin.
4. That gives four versions: control, control reviewed, skills, skills reviewed.

**What the fixer applies.** Blocking findings only, as the owner chose: this is what a mandatory gate would enforce. If a build has no blocking finding, its twin is identical and that pair counts as "cannot tell apart". Each build's advisory findings are shown to the owner after the ranking.

## How the owner judges

- The four run side by side on this Mac, each with its own database seeded with the same fictional Tests, reachable from a phone on the same Wi-Fi.
- They are labelled A to D in a random order. The key stays in a file the owner does not open until the ranking is written down.
- On each, the owner signs one Test as Performed, Reviewed and Released, once on the desktop and once on a phone, tries one wrong password, and ranks the four from best to worst.
- The ranking is read by the rule already on the ticket.
