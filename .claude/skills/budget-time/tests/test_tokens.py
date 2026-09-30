import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "tokens.py"
sys.path.insert(0, str(SCRIPT.parent))
import tokens  # noqa: E402

SUB = "toolu_sub"


def usage(context, output=1):
    return {"input_tokens": 10, "cache_creation_input_tokens": context - 110,
            "cache_read_input_tokens": 100, "output_tokens": output}


def assistant(msg_id, context, blocks=(), parent=None):
    return {"type": "assistant", "parent_tool_use_id": parent,
            "message": {"id": msg_id, "usage": usage(context), "content": list(blocks)}}


def tool(name):
    return {"type": "tool_use", "name": name}


def result(cost=0.5, models=None, is_error=False):
    return {"type": "result", "is_error": is_error, "terminal_reason": "completed", "total_cost_usd": cost,
            "modelUsage": models or {}, "subagent_stats": {"spawned": 1}}


TASK_STARTED = {"type": "system", "subtype": "task_started", "tool_use_id": SUB,
                "subagent_type": "general-purpose", "description": "Fetch one page"}
TASK_DONE = {"type": "system", "subtype": "task_notification", "tool_use_id": SUB,
             "usage": {"total_tokens": 19288}}


def delegating_run():
    return [
        assistant("m1", 1000, [{"type": "thinking"}]),
        assistant("m1", 1000, [tool("Agent")]),
        TASK_STARTED,
        assistant("s1", 500, [tool("WebFetch")], parent=SUB),
        assistant("s2", 4000, [{"type": "text"}], parent=SUB),
        TASK_DONE,
        assistant("m2", 3000, [{"type": "text"}]),
        assistant("m3", 2000, [{"type": "text"}]),
        result(),
    ]


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def stream(self, rows):
        path = self.tmp / "stream.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        return path

    def analyse(self, rows):
        return tokens.analyse(self.stream(rows))


class AnalyseTest(Case):
    def test_each_api_message_is_one_turn_but_every_event_counts_its_tool_calls(self):
        lead = self.analyse(delegating_run())["actors"]["lead"]
        self.assertEqual(lead["turns"], 3)
        self.assertEqual(lead["tool_calls"], {"Agent": 1})

    def test_subagent_turns_are_attributed_to_the_spawning_call_not_the_lead(self):
        actors = self.analyse(delegating_run())["actors"]
        self.assertEqual(set(actors), {"lead", SUB})
        sub = actors[SUB]
        self.assertEqual(sub["label"], "general-purpose: Fetch one page")
        self.assertEqual(sub["tool_calls"], {"WebFetch": 1})
        self.assertEqual(sub["total_tokens"], 19288)
        self.assertNotIn("WebFetch", actors["lead"]["tool_calls"])

    def test_peak_is_the_largest_turn_and_growth_is_peak_minus_first(self):
        lead = self.analyse(delegating_run())["actors"]["lead"]
        self.assertEqual((lead["first_context"], lead["peak_context"]), (1000, 3000))
        self.assertIn("| lead | 3 | 3,000 | 2,000 | - | Agent×1 |", tokens.markdown(self.analyse(delegating_run())))

    def test_the_last_result_event_holds_the_totals(self):
        rep = self.analyse(delegating_run()[:-1] + [result(cost=0.1), result(cost=0.2)])
        self.assertEqual(rep["total_cost_usd"], 0.2)

    def test_a_stream_without_a_result_event_is_reported_unfinished(self):
        rep = self.analyse(delegating_run()[:-1])
        self.assertFalse(rep["finished"])
        self.assertIn("finished: False", tokens.markdown(rep))
        self.assertEqual(tokens.check(rep, checks()), ["run did not finish cleanly (None)"])

    def test_a_model_without_cost_or_counts_renders_as_dashes(self):
        rep = self.analyse(delegating_run()[:-1] + [result(models={"claude-x": {"outputTokens": 7}})])
        self.assertIn("| claude-x | - | 7 | - | - | - |", tokens.markdown(rep))


def checks(**overrides):
    return SimpleNamespace(**{"no_lead_fetch": False, "max_lead_context": None, "max_lead_growth": None,
                              **overrides})


class CheckTest(Case):
    def test_a_clean_delegating_run_passes_every_check(self):
        rep = self.analyse(delegating_run())
        self.assertEqual(tokens.check(rep, checks(no_lead_fetch=True, max_lead_context=3000,
                                                  max_lead_growth=2000)), [])

    def test_a_lead_fetch_fails_no_lead_fetch(self):
        rows = delegating_run()
        rows.insert(0, assistant("m0", 900, [tool("WebFetch")]))
        self.assertEqual(tokens.check(self.analyse(rows), checks(no_lead_fetch=True)),
                         ["lead fetched directly: {'WebFetch': 1}"])

    def test_a_lead_peak_above_the_ceiling_fails_max_lead_context(self):
        self.assertEqual(tokens.check(self.analyse(delegating_run()), checks(max_lead_context=2999)),
                         ["lead peak context 3,000 > 2,999"])

    def test_lead_growth_above_the_ceiling_fails_max_lead_growth(self):
        self.assertEqual(tokens.check(self.analyse(delegating_run()), checks(max_lead_growth=1999)),
                         ["lead context grew 2,000 > 1,999"])


def turn(msg_id, context, output, model="claude-opus-5-5", sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain,
            "message": {"id": msg_id, "model": model, "usage": usage(context, output)}}


SYNTHETIC = {"type": "assistant", "isSidechain": False, "isApiErrorMessage": True,
             "message": {"id": "e1", "model": "<synthetic>", "usage": {"input_tokens": 0, "cache_creation_input_tokens": 0,
                                                                "cache_read_input_tokens": 0, "output_tokens": 0}}}


def transcript():
    return [
        {"type": "user", "message": {"role": "user", "content": "go"}},
        turn("a1", 30000, 200),
        turn("a1", 30000, 200),
        {"type": "attachment"},
        turn("a2", 90000, 500),
        turn("x1", 170000, 9000, sidechain=True),
        turn("a3", 60000, 300),
        SYNTHETIC,
    ]


class SessionTest(Case):
    def test_reports_the_main_threads_last_turn_its_peak_and_output_once_per_message(self):
        self.assertEqual(tokens.session_usage(self.stream(transcript())),
                         {"turns": 3, "current_context": 60000, "peak_context": 90000, "output_tokens": 1000})


class CliTest(Case):
    def cli(self, *argv, env=None):
        return subprocess.run([sys.executable, str(SCRIPT), *argv], capture_output=True, text=True,
                              env={**os.environ, **(env or {})})

    def test_session_fails_when_current_context_is_over_the_ceiling(self):
        proc = self.cli("session", str(self.stream(transcript())), "--max-context", "59999")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("current context: 60,000", proc.stdout)
        self.assertIn("FAIL: current context 60,000 > 59,999", proc.stdout)

    def test_session_passes_at_the_ceiling_and_defaults_it_to_180k(self):
        path = str(self.stream(transcript()))
        self.assertEqual(self.cli("session", path, "--max-context", "60000").returncode, 0)
        rows = transcript() + [turn("a4", 180001, 1)]
        proc = self.cli("session", str(self.stream(rows)))
        self.assertIn("FAIL: current context 180,001 > 180,000", proc.stdout)

    def test_session_defaults_to_this_sessions_transcript(self):
        project = self.tmp / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(tokens.REPO))
        project.mkdir(parents=True)
        (project / "abc.jsonl").write_text(self.stream(transcript()).read_text())
        proc = self.cli("session", env={"HOME": str(self.tmp), "CLAUDE_CODE_SESSION_ID": "abc"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("peak context: 90,000", proc.stdout)

    def test_an_unknown_case_id_exits_with_a_message_before_spending(self):
        proc = self.cli("run", "--name", "x", "--case", "no-such-case")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("no case 'no-such-case' in evals/agents/cases.json", proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)


if __name__ == "__main__":
    unittest.main()
