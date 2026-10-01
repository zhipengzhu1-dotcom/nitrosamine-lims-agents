---
name: budget-time
description: Measure and prove the token use of this LIMS repo's headless Claude Code agents (the part11, iso17025 and usp expert reviews, eval cases, and research runs that must hand each web fetch to its own subagent) by running them through `claude -p` stream-json and reporting cost, turns, per-agent peak context and direct fetches, and check a live session's own context against the 180K budget. Use when asked what a review or research run costs, to prove the one-fetch-per-subagent rule held, or to check a change to an agent or prompt didn't blow up its context.
---

# Budget time: agent token use

The only runnable surface on `main` is the agent tooling: `.claude/agents/*-expert.md`, driven headless by `claude -p` (see `evals/agents/run.py`).

Every drive spends real money on the owner's account. Always pass `--budget`; use `--model haiku` for probes, and run an expert on its own model (`opus`, from its frontmatter) only when the measurement is about that expert.

## Launch

Nothing stays running. Each drive is one `claude -p` process that exits when its lead agent and any background subagents finish. The helper starts it, pipes the prompt, and saves the stream:

```bash
.claude/skills/budget-time/scripts/tokens.py run --name <slug> --budget <usd> \
  (--case <cases.json id> | --prompt-file <file> [--agent <name>] [--tools "<allowedTools>"]) \
  [--model haiku] [--no-lead-fetch] [--max-lead-context <tokens>] [--max-lead-growth <tokens>]
```

It is done when it prints `evidence: evals/agents/out/budget-time/<UTC>-<slug>/  (exit N)` followed by the report. While it runs, `<dir>/pid` holds the `claude` PID; it is removed on exit.

## Doctor

Read-only. Run first, and again whenever a drive fails oddly:

```bash
claude --version                      # stream-json fields read here were checked on 2.1.286
claude auth status | grep -E 'loggedIn|authMethod'   # loggedIn: true
gh auth status 2>&1 | head -2         # expert agents may run `gh issue view`
git -C "$(git rev-parse --show-toplevel)" fetch -q origin && echo fetched   # agents diff origin/* branches
find evals/agents/out/budget-time -name pid 2>/dev/null   # any output = a drive still running or killed mid-run
```

## Drive

Pick the recipe from the feature map (`features/README.md`). The three shapes:

- **An eval case** (the exact prompt and tools `evals/agents/run.py` uses): `tokens.py run --name p11-cost --case <id> --budget 3`
- **An expert review of a branch**: write the prompt ("Review `origin/main..origin/research/x` for [ticket](url)…") to a file in the scratchpad, then `tokens.py run --name review-x --agent part11-expert --prompt-file <f> --tools "Read Grep Glob Bash(git show:*) Bash(git diff:*) Bash(git log:*) Bash(gh issue view:*)" --budget 3`
- **A research-style lead run** that must delegate fetches: prompt file plus `--tools "Agent WebFetch WebSearch Read"`, with `--no-lead-fetch` so a direct fetch by the lead fails the run.

To re-grade a saved run with other thresholds, no new spend: `tokens.py report evals/agents/out/budget-time/<dir> --no-lead-fetch --max-lead-context 60000`.

How the stream is read (from `claude -p --output-format stream-json --verbose`, Claude Code 2.1.286):
- `assistant` events: `parent_tool_use_id` null = the lead, otherwise the `Agent` tool call that spawned that subagent. Each API message appears twice (thinking and content), deduped by `message.id`.
- Their `usage` is the snapshot at message start: input and cache counts are true, `output_tokens` is not. Peak context = input + cache creation + cache read of the largest turn.
- `system/task_started` names each subagent (`subagent_type`, `description`); `system/task_notification` gives its true `usage.total_tokens`.
- The last `result` event gives `total_cost_usd`, `modelUsage` (true per-model input, output, cache and cost) and `subagent_stats`.

## Session context budget

Any Claude Code session in this repo can check its own context, at no spend:

```bash
.claude/skills/budget-time/scripts/tokens.py session [<transcript.jsonl>] [--max-context 180000]
```

With no path it reads `~/.claude/projects/<repo path, non-alphanumerics as ->/$CLAUDE_CODE_SESSION_ID.jsonl`. A subagent shares its parent's session id, so it measures the parent's main thread. It prints `turns`, `current context` (the last turn's input + cache tokens, what the next turn starts from), `peak context` and `output tokens`, and exits 1 with `FAIL: current context …` above the ceiling.

Near the ceiling, stop reading bulk into the main thread: hand file sweeps, stream reads and fetches to subagents and keep their summaries, not their payloads. Sample large files with `head` or a script instead of reading them whole.

## Evidence

Each run leaves `evals/agents/out/budget-time/<UTC>-<slug>/` (git-ignored by `evals/agents/.gitignore`):
`prompt.txt`, `command.json`, `stream.jsonl` (raw), `stderr.txt`, `report.json`, `report.md`.

Proof standards:
- Drive the real agent through `claude -p` with the same `--agent` and tools a real review uses; never estimate from prompt length.
- A cost claim cites `total_cost_usd` and the per-model table from `report.md`. It is list price as Claude Code computes it, not an invoice.
- A delegation claim ("each fetch went to a subagent") needs `--no-lead-fetch` passing and the actor table showing the fetches under subagent rows.
- A context claim names the actor and its peak context or growth (peak minus first turn), not the run total.
- Quote the evidence directory in the reply so the owner can open it.

## Cleanup

`claude -p` exits by itself. If a drive hangs, kill only the PID in that run's `pid` file (`kill "$(cat evals/agents/out/budget-time/<dir>/pid)"`), never by process name: the owner's own Claude sessions share the name. An agent run with worktree isolation may leave `.claude/worktrees/agent-*`; list them before a drive, and after it remove only new ones with `git worktree remove <path>` once their branch is pushed or unneeded. Never delete `evals/agents/out/budget-time/`: it is the evidence.

## Helpers

- `scripts/tokens.py run …`: drive and report, as above. Exit 0 when the run finished and every requested check passed.
- `scripts/tokens.py report <dir|stream.jsonl> [checks]`: re-report a saved stream.
- `scripts/tokens.py session [<transcript>] [--max-context N]`: the session context budget, as above.
- `python3 -m unittest discover .claude/skills/budget-time/tests`: the helper's tests, on synthetic streams. Run them after editing `tokens.py`.
- `scripts/tokens.py --help`: full usage.
