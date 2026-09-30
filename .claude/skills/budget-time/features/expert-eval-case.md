# Cost of one expert eval case

What one case from `evals/agents/cases.json` costs when run exactly as `evals/agents/run.py` runs it: the same inline-design prompt, `--agent`, and allowed tools. Use it to price the eval suite (19 cases) or to check that an edit to an expert agent didn't inflate its context.

## Sub-features

- `case-cost`: total cost, turns and per-model tokens for one case.
- `case-context`: the expert's peak context for that case.
- `case-verdicts`: the report still ends with a `verdicts` block (the run is a real review, not a truncated one).

## How to get to it (user POV)

- The owner asks "what does a compliance eval cost?" or edits `.claude/agents/<x>-expert.md`.
- `python3 evals/agents/run.py <prefix>` runs the same cases but records no tokens.

## Driving it with tokens.py

- **Run one case.** `.claude/skills/budget-time/scripts/tokens.py run --name usp-lane --case usp-lane-lockout --budget 3`. It prints the evidence directory and a report whose first actor row is `lead` (the expert itself, since `--agent` makes it the lead).
- **Check it was a full review.** `grep -c '```verdicts' evals/agents/out/budget-time/<dir>/stream.jsonl` is at least 1.
- **Compare before and after an agent edit.** Run the same `--case` on both versions and compare `total_cost_usd` and the lead's peak context in the two `report.md` files.
- **Suite estimate.** Cost of the cases run × 19 ÷ cases run, stated as an estimate with the cases it rests on.

## Gotchas

- Experts run on `opus` (their frontmatter). A `--model haiku` run measures Haiku, not the expert.
- The case ids are listed by `python3 -c "import json;[print(c['id']) for c in json.load(open('evals/agents/cases.json'))]"`.
- Costs are list price as Claude Code reports them, and cache reads dominate: a second run minutes later can be cheaper than the first.
