#!/usr/bin/env bash
# CI's check job runs this script unchanged.
# The tests need this checkout's PostgreSQL (scripts/pg.sh start), or the server that LIMS_PG names.
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

if git grep -nIE '^(<{7}|>{7}) '; then
  echo "A tracked file holds a merge conflict marker, at the file and line above. Resolve the conflict, delete the marker lines, and stage the file." >&2
  exit 1
fi
if git grep -nE 'runs-on:' -- '.github/workflows/*' | grep -v 'runs-on: \[self-hosted, '; then
  echo "Every CI job runs on the self-hosted runners (ci/runner/README.md). Write its runs-on as [self-hosted, lims-<slot>] on one line." >&2
  exit 1
fi
if git grep -nE '"[~^][0-9]' -- '*package.json'; then
  echo "Pin every dependency to an exact version." >&2
  exit 1
fi
for dir in apps/*/test packages/*/test; do
  [ -d "$dir" ] || continue
  if ! grep -q '"test":' "$(dirname "$dir")/package.json"; then
    echo "$dir holds tests, but its package has no test script, so pnpm test would skip them." >&2
    exit 1
  fi
done

pnpm exec biome format .
pnpm lint
pnpm typecheck
git ls-files -co --exclude-standard -z '*.py' | xargs -0 uvx "$RUFF" check
git ls-files -co --exclude-standard -z '*.py' | xargs -0 uvx "$RUFF" format --check
git ls-files -co --exclude-standard -z 'scripts/*.sh' | xargs -0 uvx --from "$SHELLCHECK" shellcheck
pnpm test
python3 -m unittest discover -s .claude/skills/budget-time/tests
