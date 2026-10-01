# Signing-flow trial record

The primary sources for [Prototype the signing flow with and without the design skills](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/51). Throwaway: this branch is never merged.

| Label | Version | Branch |
|---|---|---|
| A | Control: Opus, Skill tool switched off | `prototype/signing-trial/k` |
| D | Control after the review's blocking fixes | `prototype/signing-trial/k2` |
| B | Skills build | `prototype/signing-trial/m` |
| C | Skills build after the review's blocking fixes | `prototype/signing-trial/m2` |

- `brief.md`: the brief the owner approved.
- `control-rationale.md`, `skills-rationale.md`: each builder's own account.
- `control-review.md`, `skills-review.md`: the `design-reviewer` reports (the agent is on `task/design-reviewer`).
- `control-fix-report.md`, `skills-fix-report.md`: what each fixer changed.
- `evaluator-1-fable-notes.md`, `evaluator-2-opus-notes.md`: the two blind evaluators' notes. They cite screenshot files that were not kept, except the one below.
- `phone-refusal-B-top-D-bottom.png`: frames after a wrong password on a phone, skills build above, reviewed control below.

Run a version from its branch with `scripts/dev.sh`.
