"""Behaviour evals for the review agents in .claude/agents.

Each case hands one agent a short design or diff and grades only the agent's
report: the `verdicts` block it must end with. Expected verdicts come from the
research notes (research/* branches) or the owner's decision ticket, not from
the agent files.

    python3 evals/agents/run.py            # every case
    python3 evals/agents/run.py p11-edit   # cases whose id starts with p11-edit
"""

import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent.parent
OUT = HERE / "out"
ALLOWED_TOOLS = "Read Grep Glob Bash(git show:*) Bash(git diff:*) Bash(git log:*) Bash(gh issue view:*)"
PROMPT = "Review this proposed design for the LIMS. It is given inline; there is no diff.\n\n{artifact}"
PROMPTS = {
    "design-reviewer": "Review this change to apps/web. It is given inline; there is no diff range to load.\n\n{artifact}",
}

VERDICT_LINE = re.compile(
    r"^\s*[-*]?\s*(met|gap|procedural|unclear|n/a|blocking|advisory|overall)\s*:\s*(.+?)\s*$", re.IGNORECASE
)
PART11_CITATION = re.compile(r"^(§?11\.\d|a11|di|ci|sa|pics|cs|rd|gmp|jirei|ch4|esl|62fr)")
ISO_CITATION = re.compile(r"^\d\.\d")
USP_CITATION = re.compile(r"^(<\d{1,4}(\.\d+)?>|gn\d)")
LANES = {"part11": PART11_CITATION, "iso17025": ISO_CITATION, "usp": USP_CITATION}


def normalize(citation):
    return re.sub(r"[\s§`*]", "", citation).lower()


def parse_verdicts(report):
    blocks = re.findall(r"```verdicts\n(.*?)```", report, re.DOTALL)
    if not blocks:
        return None
    verdicts = []
    for line in blocks[-1].splitlines():
        m = VERDICT_LINE.match(line)
        if m:
            verdicts.append((m.group(1).lower(), normalize(m.group(2))))
    return verdicts


def cited(verdicts, kind, expected):
    want = normalize(expected)
    return any(v == kind and want in c for v, c in verdicts)


def grade(case, verdicts):
    if verdicts is None:
        return ["report has no ```verdicts block"]
    failures = []
    expect = case["expect"]
    for kind in ("gap", "blocking", "met", "procedural", "advisory", "overall"):
        for group in expect.get(kind, []):
            options = group if isinstance(group, list) else [group]
            if not any(cited(verdicts, kind, o) for o in options):
                failures.append(f"no {kind} citing any of {options}")
    for kind in ("gap", "blocking"):
        for c in expect.get(f"not_{kind}", []):
            if cited(verdicts, kind, c):
                failures.append(f"false alarm: {kind} citing {c}")
    lane = expect.get("no_gap_in")
    if lane:
        foreign = LANES[lane]
        strays = [c for v, c in verdicts if v == "gap" and foreign.match(c)]
        if strays:
            failures.append(f"out of lane: gaps cite {lane} rules {strays}")
    return failures


def run(case):
    prompt = PROMPTS.get(case["agent"], PROMPT).format(artifact=case["artifact"])
    proc = subprocess.run(
        ["claude", "-p", "--agent", case["agent"], "--allowedTools", ALLOWED_TOOLS],
        input=prompt,
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    report = proc.stdout
    (OUT / f"{case['id']}.md").write_text(report)
    if proc.returncode != 0:
        return case, [f"agent run failed: {proc.stderr.strip()[:300]}"]
    return case, grade(case, parse_verdicts(report))


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    cases = [c for c in json.loads((HERE / "cases.json").read_text()) if c["id"].startswith(prefix)]
    OUT.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, cases))
    failed = 0
    for case, failures in results:
        status = "PASS" if not failures else "FAIL"
        failed += bool(failures)
        print(f"{status}  {case['id']}  [{case['seam']}]")
        for f in failures:
            print(f"      {f}")
    print(f"\n{len(results) - failed}/{len(results)} passed; reports in {OUT.relative_to(REPO)}/")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
