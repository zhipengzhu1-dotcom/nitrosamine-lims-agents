#!/usr/bin/env bash
# Read-only: says whether this checkout's verification instance is worth driving. Exits 1 on the first failure.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
STATE=$ROOT/.verify/instance
cd "$ROOT"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
[ -f "$STATE/env" ] || fail "no instance; run up.sh"
# shellcheck source=/dev/null
. "$STATE/env"
kill -0 -- "-$PGID" 2>/dev/null || fail "process group $PGID is gone; run down.sh, then up.sh"
echo "ok: process group $PGID is running"

WEB_PORT=${WEB##*:}
# pnpm exec gives vite a process group of its own, so walk up its parents to dev.sh instead.
pid=$(lsof -t -iTCP:"$WEB_PORT" -sTCP:LISTEN | head -1)
while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$pid" != "$PGID" ]; do pid=$(ps -o ppid= -p "$pid" | tr -d ' '); done
[ "$pid" = "$PGID" ] || fail "port $WEB_PORT is not served by this instance"
echo "ok: $WEB is served by this instance"

code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/api/me")
[ "$code" = 401 ] || fail "GET $WEB/api/me answered $code, not 401 (the API behind the proxy is not answering)"
echo "ok: the API answers through the web proxy"

seeded=$(grep -c "^  { role: '[A-Za-z]*', username: '" packages/db/src/seed.ts)
people=$(scripts/pg.sh psql -d "$DB" -tAc 'select count(*) from lims.person')
[ "$people" = "$seeded" ] || fail "$DB holds $people people, not the $seeded the seed makes"
echo "ok: $DB holds the seed; every account signs in with $PASSWORD"

now=$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- apps packages || echo -dirty)
[ "$now" = "$COMMIT" ] || echo "WARN: launched at $COMMIT, checkout is now $now"
changed=$(find apps/api/src packages/*/src packages/db/migrations -newer "$STATE/env" -type f | head -3)
[ -z "$changed" ] || fail "the API does not reload, and these changed since launch: $changed. Run down.sh, then up.sh"
echo "ok: the API runs the code in the checkout"
