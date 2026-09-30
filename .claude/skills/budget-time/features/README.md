# Agent token-use verification map

The maintained source for measuring what this repo's headless agents spend. Read this index, then use the matching feature file as the recipe. Every recipe drives `scripts/tokens.py` (see `../SKILL.md`).

| Feature | File | Drivable |
|---|---|---|
| Cost of one expert eval case | [expert-eval-case.md](expert-eval-case.md) | yes |
| Cost of an expert review of a branch | [expert-branch-review.md](expert-branch-review.md) | yes |
| Research run delegates every fetch | [research-fetch-delegation.md](research-fetch-delegation.md) | yes |
| In-LIMS assistant calls against the hosting estimates | [assistant-layer-calls.md](assistant-layer-calls.md) | **no: not built** |

## Baseline preconditions

- Doctor in `../SKILL.md` passes: `claude` ≥ 2.1.200, logged in, `gh` logged in, `origin` fetched.
- No leftover `evals/agents/out/budget-time/*/pid` from an unfinished drive.
- Run from the repo root on `main`, clean or with only the change being measured.

## Driving conventions

- Every drive passes `--budget`. Probes use `--model haiku`; expert measurements use the expert's own model (omit `--model`).
- Use the same `--agent` and `--tools` a real review uses; a cheaper stand-in measures the stand-in.
- Write prompt files to the session scratchpad, never into the repo.
- One drive per claim. To compare thresholds, re-run `tokens.py report` on the saved stream instead of spending again.

## Proof and skip reporting

- Quote the evidence directory, `total_cost_usd`, the model table and the relevant actor's peak context.
- A delegation proof shows `--no-lead-fetch` passing and fetch tools only on subagent rows.
- Report a feature marked not drivable as skipped, naming what is missing.
