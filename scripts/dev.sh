#!/usr/bin/env bash
# Runs the slice locally: Postgres, migrations, a seed on an empty database, then the API and the web together.
# --scratch gives the database this checkout's suffix and drops it first.
set -euo pipefail
cd "$(dirname "$0")/.."
export LIMS_DB=${LIMS_DB:-lims} PORT=${PORT:-3000}
# A fresh key at each start, so no key is committed; local work never matches an HMAC across restarts.
export LIMS_ACCESS_EVENT_KEY=${LIMS_ACCESS_EVENT_KEY:-$(openssl rand -hex 32)}
WEB_PORT=${WEB_PORT:-5173}

scripts/pg.sh start >/dev/null
if [ "${1:-}" = --scratch ]; then
  LIMS_DB=$(node packages/db/src/checkout.ts database "$LIMS_DB")
  PGOPTIONS=--client-min-messages=warning scripts/pg.sh psql -qc "drop database if exists \"$LIMS_DB\" with (force)"
fi
node packages/db/src/migrate.ts
if [ "$(scripts/pg.sh psql -d "$LIMS_DB" -tAc 'select count(*) from lims.lab')" = 0 ]; then
  node packages/db/src/seed.ts
else
  echo "$LIMS_DB is already seeded; its accounts were printed when it was first seeded."
fi

trap 'kill 0' EXIT
LIMS_LOG=1 node apps/api/src/main.ts &
LIMS_API="http://127.0.0.1:$PORT" pnpm --filter @lims/web exec vite --port "$WEB_PORT" --strictPort &
echo "Open http://localhost:$WEB_PORT"
wait
