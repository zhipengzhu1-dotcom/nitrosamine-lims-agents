#!/usr/bin/env bash
# Stops the process group up.sh started, drops its scratch database and removes .verify/instance.
# Leaves .verify/evidence and the checkout's PostgreSQL cluster alone.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
STATE=$ROOT/.verify/instance
cd "$ROOT"

if [ ! -f "$STATE/env" ]; then
  echo "no instance to stop"
  exit 0
fi
# shellcheck source=/dev/null
. "$STATE/env"
# pnpm exec gives vite a process group of its own, so collect the whole tree under dev.sh before stopping it.
tree() {
  echo "$1"
  for child in $(pgrep -P "$1"); do tree "$child"; done
}
if kill -0 "$PGID" 2>/dev/null; then
  read -r -a pids <<<"$(tree "$PGID" | tr '\n' ' ')"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in $(seq 20); do
    kill -0 "${pids[@]}" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL "${pids[@]}" 2>/dev/null || true
fi
PGOPTIONS=--client-min-messages=warning scripts/pg.sh psql -qc "drop database if exists \"$DB\" with (force)"
rm -rf "$STATE"
echo "stopped the instance under process $PGID and dropped $DB; evidence stays in $ROOT/.verify/evidence"
