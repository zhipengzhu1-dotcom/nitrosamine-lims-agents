#!/usr/bin/env bash
# Reports the hand-written lines (blank lines included) per area.
# Not counted: docs and Markdown, the lockfile, generated database types, and files that predate the slice.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git ls-files -co --exclude-standard | while IFS= read -r f; do
  case "$f" in
    *.md | docs/* | evals/* | .claude/* | pnpm-lock.yaml | packages/db/src/schema.ts) continue ;;
  esac
  [ -f "$f" ] || continue
  grep -Iq . "$f" || continue
  case "$f" in
    */e2e/*) area=e2e ;;
    */test/* | *.test.ts | *.test.tsx) area=tests ;;
    apps/* | packages/*) area=$(echo "$f" | cut -d/ -f2) ;;
    deploy/*) area=deploy ;;
    *) area=config ;;
  esac
  echo "$area $(wc -l < "$f")"
done | awk '
  { lines[$1] += $2; total += $2 }
  END {
    for (a in lines) printf "%-8s %6d\n", a, lines[a]
    printf "%-8s %6d\n", "total", total
  }'
