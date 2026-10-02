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
if git grep -nE '"[~^][0-9]' -- '*package.json'; then
  echo "Pin every dependency to an exact version." >&2
  exit 1
fi
# shellcheck disable=SC2016 # the backticks and ${ are regex text, not shell expansions
if git grep -nE 'sql\.raw\(([^'\''"`]|`[^`]*\$\{)' -- '*.ts' '*.tsx'; then
  echo "sql.raw takes only a quoted string literal. Pass a value through the sql tag, which binds it as a parameter." >&2
  exit 1
fi
if git grep -nE 'psql.*[[:space:]'\''"]-[A-Za-z]*c[A-Za-z]*['\''"]?[[:space:],].*\$[{A-Za-z_]' -- .claude/skills/verify apps/web/e2e scripts; then
  echo "psql -c builds SQL from an interpolated value. Bind it with psql -v name=value and send the SQL on stdin, where :'name' quotes it." >&2
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
