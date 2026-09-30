# Research run delegates every fetch

The owner's rule (2026-09-30): in research, each web fetch or search is one subagent that explores that source and reports back; the lead never fetches in its own context. This feature proves a research-style run followed it and shows what it saved in the lead's context.

## Sub-features

- `lead-no-fetch`: the lead made no `WebFetch` or `WebSearch` call.
- `fetch-per-subagent`: each fetch sits under a subagent row, one source per subagent.
- `lead-context`: the lead's context grows only by the subagents' summaries; the page text stays in subagent rows.

## How to get to it (user POV)

- A wayfinder research ticket is dispatched, or the owner asks whether research agents are following the rule.

## Driving it with tokens.py

- **Write a two-source prompt** to the scratchpad, e.g.: "Research question: what is the current status of EU GMP Annex 22? Read these two sources, each through its own subagent (Agent tool) that fetches only that one page and reports back a 5-line summary with quotes and dates: https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en and https://www.ema.europa.eu/en/human-regulatory-overview/research-development/compliance-research-development/good-manufacturing-practice. Do not fetch anything yourself. Then answer in 5 lines."
- **Run it.** `.claude/skills/budget-time/scripts/tokens.py run --name fetch-rule --prompt-file <f> --model haiku --tools "Agent WebFetch WebSearch" --no-lead-fetch --max-lead-growth 10000 --budget 1`.
- **End state.** Exit 0; the actor table shows `lead` with `Agent×2` and no fetch tools, and two subagent rows each with `WebFetch` (or `WebSearch`). The lead's growth column stays small (about 2k tokens for two 5-line summaries, measured 2026-09-30) while each subagent's grows by the page it read. Don't compare peaks across rows: the lead starts near 28k because it carries Claude Code's full system prompt.
- **Negative control** (optional, proves the check bites): rerun with "fetch both pages yourself" in the prompt; `--no-lead-fetch` must fail with `lead fetched directly`.

## Gotchas

- Subagents inherit the allowed tools, so `WebFetch` must be in `--tools` for them to fetch at all.
- Many sites return 403 to the fetcher (openai.com, waters.com, agilent.com, x.ai were seen); pick sources that answer, or the subagent reports a failure instead of content.
- A real research ticket run is far larger; this drive proves the rule and the measurement, not a ticket's cost.
