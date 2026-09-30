# Cost of an expert review of a branch

What one `part11-expert`, `iso17025-expert` or `usp-expert` review of a diff range costs, the way `CLAUDE.md` requires before merging or closing a compliance-touching ticket. Three reviews run per ticket, so this prices a ticket's compliance review.

## Sub-features

- `review-cost`: cost and turns of one expert on one range.
- `review-context`: the expert's peak context, which grows with the diff and the sibling files it reads.
- `review-per-ticket`: the sum of the three experts on the same range.

## How to get to it (user POV)

- The owner asks what a compliance review costs, or why a ticket's review was expensive.

## Driving it with tokens.py

- **Write the prompt** to the scratchpad, in the CLAUDE.md form: "Run `git fetch origin` first. Review `origin/main..origin/research/<name>` for [<ticket title>](<url>), which serves [Map: Nitrosamine LC-MS/MS LIMS prototype](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Give a verdict per applicable requirement."
- **Run one expert.** `.claude/skills/budget-time/scripts/tokens.py run --name usp-<name> --agent usp-expert --prompt-file <f> --tools "Read Grep Glob Bash(git show:*) Bash(git diff:*) Bash(git log:*) Bash(git fetch:*) Bash(gh issue view:*)" --budget 3`.
- **Per ticket.** Repeat with `part11-expert` and `iso17025-expert` on the same prompt file; add the three `total_cost_usd` values.
- **End state.** Each `report.md` shows `finished: True`, and the stream holds a final `verdicts` block.

## Gotchas

- `usp-expert` is the cheapest (it marks most chapters n/a); `part11-expert` reads the most. Price all three, not one times three.
- Agents in `.claude/agents/` list `WebFetch`; it is off unless `--tools` allows it, which keeps the review offline and cheaper.
