#!/usr/bin/env python3
"""Run a headless Claude Code agent and measure what it spent.

    tokens.py run --name NAME [--agent AGENT] [--model M] [--budget USD]
                  [--tools "Read Grep ..."] (--prompt-file F | --case ID)
    tokens.py report DIR_OR_STREAM [--no-lead-fetch] [--max-lead-context N] [--max-lead-growth N]
    tokens.py session [TRANSCRIPT] [--max-context N]

`run` pipes the prompt to `claude -p --output-format stream-json --verbose`,
saves the raw stream under evals/agents/out/budget-time/<UTC>-<NAME>/ and writes
report.json and report.md beside it. `--case ID` reuses the prompt, agent and
allowed tools of that case in evals/agents/cases.json, as evals/agents/run.py does.

`report` re-reads a saved stream. Its checks turn into a non-zero exit:
--no-lead-fetch fails when the lead agent itself called WebFetch or WebSearch,
--max-lead-context fails when the lead's largest turn went above N tokens,
--max-lead-growth when the lead's context grew more than N past its first turn.

`session` reads a live Claude Code session transcript (default: this session's,
from CLAUDE_CODE_SESSION_ID) and reports the main thread's current context, its
peak and its total output. It exits non-zero when the current context is above
--max-context (default 180000).
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / "evals" / "agents" / "out" / "budget-time"
CASES = REPO / "evals" / "agents" / "cases.json"
EVAL_TOOLS = "Read Grep Glob Bash(git show:*) Bash(git diff:*) Bash(git log:*) Bash(gh issue view:*)"
EVAL_PROMPT = "Review this proposed design for the LIMS. It is given inline; there is no diff.\n\n{artifact}"
FETCH_TOOLS = {"WebFetch", "WebSearch"}

Row = dict[str, Any]


class Actor(TypedDict):
    label: str
    turns: int
    first_context: int | None
    peak_context: int
    total_tokens: int | None
    tool_calls: dict[str, int]


class ModelTotals(TypedDict):
    inputTokens: int | None
    outputTokens: int | None
    cacheReadInputTokens: int | None
    cacheCreationInputTokens: int | None
    costUSD: float | None


class Report(TypedDict):
    stream: str
    finished: bool
    terminal_reason: str | None
    total_cost_usd: float | None
    duration_ms: int | None
    models: dict[str, ModelTotals]
    subagents: int
    actors: dict[str, Actor]


class SessionUsage(TypedDict):
    turns: int
    current_context: int
    peak_context: int
    output_tokens: int


def context_size(usage: Row) -> int:
    return (
        usage.get("input_tokens", 0)
        + usage.get("cache_creation_input_tokens", 0)
        + usage.get("cache_read_input_tokens", 0)
    )


def num(value: int | None) -> str:
    return "-" if value is None else f"{value:,}"


def read_jsonl(path: Path) -> list[Row]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def analyse(stream: Path) -> Report:
    rows = read_jsonl(stream)
    labels = {
        r["tool_use_id"]: f"{r.get('subagent_type') or 'agent'}: {r.get('description', '')}"
        for r in rows
        if r.get("type") == "system" and r.get("subtype") == "task_started"
    }
    actors: dict[str, Actor] = {}
    seen: set[str] = set()
    for r in rows:
        if r.get("type") != "assistant":
            continue
        msg = r["message"]
        parent = r.get("parent_tool_use_id") or "lead"
        actor = actors.setdefault(
            parent,
            {
                "label": "lead" if parent == "lead" else labels.get(parent, parent),
                "turns": 0,
                "first_context": None,
                "peak_context": 0,
                "total_tokens": None,
                "tool_calls": {},
            },
        )
        for block in msg.get("content", []):
            if block.get("type") == "tool_use":
                actor["tool_calls"][block["name"]] = actor["tool_calls"].get(block["name"], 0) + 1
        if msg.get("id") in seen:
            continue
        seen.add(msg.get("id"))
        usage = msg.get("usage", {})
        actor["turns"] += 1
        if actor["first_context"] is None:
            actor["first_context"] = context_size(usage)
        actor["peak_context"] = max(actor["peak_context"], context_size(usage))
    for r in rows:
        if r.get("subtype") == "task_notification" and r.get("tool_use_id") in actors:
            actors[r["tool_use_id"]]["total_tokens"] = r.get("usage", {}).get("total_tokens")
    results = [r for r in rows if r.get("type") == "result"]
    final = results[-1] if results else {}
    return {
        "stream": str(stream),
        "finished": bool(final) and not final.get("is_error", True),
        "terminal_reason": final.get("terminal_reason"),
        "total_cost_usd": final.get("total_cost_usd"),
        "duration_ms": final.get("duration_ms"),
        "models": {
            m: {
                k: u.get(k)
                for k in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "costUSD")
            }
            for m, u in final.get("modelUsage", {}).items()
        },
        "subagents": final.get("subagent_stats", {}).get("spawned", 0),
        "actors": actors,
    }


def markdown(rep: Report) -> str:
    lines = [
        f"# Token report: {rep['stream']}",
        "",
        f"- finished: {rep['finished']} ({rep['terminal_reason']})",
        f"- total cost: ${rep['total_cost_usd'] or 0:.4f} (list price, as Claude Code reports it)",
        f"- subagents spawned: {rep['subagents']}",
        "",
        (
            "Peak context is the largest single turn (input + cache); growth is peak minus the first turn,"
            " i.e. what the run added on top of the system prompt. Stream events carry"
            " output counts from the start of each message, so only the model table has true output."
        ),
        "",
        "| actor | turns | peak context | growth | subagent total tokens | tool calls |",
        "|---|---|---|---|---|---|",
    ]
    for a in rep["actors"].values():
        calls = ", ".join(f"{k}×{v}" for k, v in sorted(a["tool_calls"].items())) or "-"
        growth = a["peak_context"] - (a["first_context"] or 0)
        lines.append(
            f"| {a['label']} | {a['turns']} | {a['peak_context']:,} | {growth:,} | {num(a['total_tokens'])} | {calls} |"
        )
    lines += ["", "| model | input | output | cache read | cache write | cost |", "|---|---|---|---|---|---|"]
    for m, u in rep["models"].items():
        cost = "-" if u["costUSD"] is None else f"${u['costUSD']:.4f}"
        lines.append(
            f"| {m} | {num(u['inputTokens'])} | {num(u['outputTokens'])} | {num(u['cacheReadInputTokens'])}"
            f" | {num(u['cacheCreationInputTokens'])} | {cost} |"
        )
    return "\n".join(lines) + "\n"


def check(rep: Report, args: argparse.Namespace) -> list[str]:
    failures: list[str] = []
    if not rep["finished"]:
        failures.append(f"run did not finish cleanly ({rep['terminal_reason']})")
    lead = rep["actors"].get("lead", {"tool_calls": {}, "peak_context": 0})
    if args.no_lead_fetch:
        direct = {k: v for k, v in lead["tool_calls"].items() if k in FETCH_TOOLS}
        if direct:
            failures.append(f"lead fetched directly: {direct}")
    if args.max_lead_context and lead["peak_context"] > args.max_lead_context:
        failures.append(f"lead peak context {lead['peak_context']:,} > {args.max_lead_context:,}")
    growth = lead["peak_context"] - (lead.get("first_context") or 0)
    if args.max_lead_growth is not None and growth > args.max_lead_growth:
        failures.append(f"lead context grew {growth:,} > {args.max_lead_growth:,}")
    return failures


def write_report(stream: Path, args: argparse.Namespace) -> int:
    rep = analyse(stream)
    rep["failures"] = check(rep, args)
    (stream.parent / "report.json").write_text(json.dumps(rep, indent=1))
    text = markdown(rep) + "".join(f"\nFAIL: {f}" for f in rep["failures"])
    (stream.parent / "report.md").write_text(text + "\n")
    print(text)
    return 1 if rep["failures"] else 0


def session_usage(transcript: Path) -> SessionUsage:
    turns = {
        r["message"]["id"]: r["message"].get("usage", {})
        for r in read_jsonl(transcript)
        if r.get("type") == "assistant" and not r.get("isSidechain") and r["message"].get("model") != "<synthetic>"
    }
    contexts = [context_size(u) for u in turns.values()]
    return {
        "turns": len(turns),
        "current_context": contexts[-1] if contexts else 0,
        "peak_context": max(contexts, default=0),
        "output_tokens": sum(u.get("output_tokens", 0) for u in turns.values()),
    }


def session(args: argparse.Namespace) -> int:
    if args.path:
        path = Path(args.path)
    elif os.environ.get("CLAUDE_CODE_SESSION_ID"):
        project = re.sub(r"[^A-Za-z0-9]", "-", str(REPO))
        path = Path.home() / ".claude" / "projects" / project / f"{os.environ['CLAUDE_CODE_SESSION_ID']}.jsonl"
    else:
        sys.exit("give a transcript path: CLAUDE_CODE_SESSION_ID is unset")
    if not path.is_file():
        sys.exit(f"no transcript at {path}")
    use = session_usage(path)
    print(
        f"session: {path}\nturns: {use['turns']}\ncurrent context: {use['current_context']:,}\n"
        f"peak context: {use['peak_context']:,}\noutput tokens: {use['output_tokens']:,}"
    )
    if use["current_context"] > args.max_context:
        print(f"FAIL: current context {use['current_context']:,} > {args.max_context:,}")
        return 1
    return 0


def run(args: argparse.Namespace) -> int:
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--max-budget-usd", str(args.budget)]
    if args.case:
        case = next((c for c in json.loads(CASES.read_text()) if c["id"] == args.case), None)
        if case is None:
            sys.exit(f"no case {args.case!r} in {CASES.relative_to(REPO)}")
        prompt, agent, tools = EVAL_PROMPT.format(artifact=case["artifact"]), case["agent"], EVAL_TOOLS
    else:
        prompt, agent, tools = Path(args.prompt_file).read_text(), args.agent, args.tools
    if agent:
        cmd += ["--agent", agent]
    if args.model:
        cmd += ["--model", args.model]
    if tools:
        cmd += ["--allowedTools", tools]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = EVIDENCE / f"{stamp}-{args.name}"
    out.mkdir(parents=True)
    (out / "prompt.txt").write_text(prompt)
    (out / "command.json").write_text(json.dumps(cmd))
    stream = out / "stream.jsonl"
    with stream.open("w") as sink, (out / "stderr.txt").open("w") as err:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=sink, stderr=err, cwd=REPO, text=True)
        (out / "pid").write_text(str(proc.pid))
        proc.communicate(prompt)
    (out / "pid").unlink()
    print(f"evidence: {out.relative_to(REPO)}/  (exit {proc.returncode})\n")
    return write_report(stream, args) or (1 if proc.returncode else 0)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    checks = argparse.ArgumentParser(add_help=False)
    checks.add_argument("--max-lead-context", type=int)
    checks.add_argument("--max-lead-growth", type=int)
    checks.add_argument("--no-lead-fetch", action="store_true")
    r = sub.add_parser("run", parents=[checks])
    r.add_argument("--name", required=True)
    r.add_argument("--agent")
    r.add_argument("--model")
    r.add_argument("--budget", type=float, default=2.0)
    r.add_argument("--tools")
    src = r.add_mutually_exclusive_group(required=True)
    src.add_argument("--prompt-file")
    src.add_argument("--case")
    sub.add_parser("report", parents=[checks]).add_argument("path")
    s = sub.add_parser("session")
    s.add_argument("path", nargs="?")
    s.add_argument("--max-context", type=int, default=180_000)
    args = p.parse_args()
    if args.cmd == "run":
        sys.exit(run(args))
    if args.cmd == "session":
        sys.exit(session(args))
    path = Path(args.path).resolve()
    sys.exit(write_report(path / "stream.jsonl" if path.is_dir() else path, args))


if __name__ == "__main__":
    main()
