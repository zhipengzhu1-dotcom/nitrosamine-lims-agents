I fixed the one blocking finding (status-legibility) with two lines in `apps/web/src/app.css`. Both commands pass, and the change is uncommitted.

- **Line 82:** the keyframe is now `@keyframes note-in { from { transform: translateY(6px); } }`. The rail note rises into place but is fully visible from the first frame, so "The Test is now Reviewed." shows at the same time as the `Status` beside the title.
- **Line 140, in the reduced-motion block:** the rule is now `.note-text--ok { animation: none; }`, so with reduced motion the note appears at once with no fade.

Nothing else changed.

**Checks**, run with `LIMS_PGPORT=54371 LIMS_PG=postgres://postgres@localhost:54371`:
- `pnpm check` exits 0. Nothing was listening on port 54371 at first, so I started the local cluster with `scripts/pg.sh start`. That Postgres is still running on 54371.
- `e2e-locked.sh` passed: 1 of 1, the whole chain through the UI ending in a Test Report with three Signatures.
