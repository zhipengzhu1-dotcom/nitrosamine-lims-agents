#!/usr/bin/env bash
# The gate behind pnpm check: green here is green on main, and CI runs exactly this.
# The tests need the PostgreSQL that LIMS_PG points at (scripts/pg.sh start locally).
set -euo pipefail
cd "$(dirname "$0")/.."
RUFF=ruff@0.16.9
SHELLCHECK=shellcheck-py==0.11.0.1

for tool in python3 uvx; do
  if ! command -v "$tool" >/dev/null; then
    echo "pnpm check needs $tool, which is not on PATH (uvx comes with uv: https://docs.astral.sh/uv/)." >&2
    exit 1
  fi
done

pnpm lint
pnpm typecheck
git ls-files -co --exclude-standard -z '*.py' | xargs -0 uvx "$RUFF" check
git ls-files -co --exclude-standard -z '*.py' | xargs -0 uvx "$RUFF" format --check
git ls-files -co --exclude-standard -z 'scripts/*.sh' | xargs -0 uvx --from "$SHELLCHECK" shellcheck
pnpm test
python3 -m unittest discover -s .claude/skills/budget-time/tests
