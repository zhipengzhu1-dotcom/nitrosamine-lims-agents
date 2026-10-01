I fixed both findings and left the change uncommitted. `pnpm check` and the e2e script both pass. The first gate run failed only because Postgres wasn't running on port 54361; I started it with `scripts/pg.sh start` and reran.

**`touch-size`** (`apps/web/src/app.css:51`): the Test Report link's padding is now `13px 0` and its margin `-13px 0`, which makes the link 44.2 px tall by the reviewer's arithmetic. I didn't measure it in a browser.

**`frequency`** (`apps/web/src/rail.tsx`):
- **Escape closes at once.** The handler now sets `afterClose.current = { clear: false }` and calls `setSheet(null)` directly instead of `close(false)`, so there is no slide-down.
- **The commit button skips its fade-in after Escape.** A new `instant` state puts `data-instant` on the button, and a new CSS rule, `.rbtn--commit[data-instant]`, sets its starting state to `opacity: 1; transform: none`.
- **Cancel and signing still animate.** `close()` resets `instant` to false, so those paths keep their slide and fade.

The e2e walk passing doesn't prove the Escape fix: it doesn't use Escape or check the animation.
