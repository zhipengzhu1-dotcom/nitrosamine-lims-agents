#!/usr/bin/env bash
# Runs the slice locally: Postgres, migrations, a seed on an empty database, then the API and the web together.
# --scratch gives the database this checkout's suffix and drops it first.
set -euo pipefail
cd "$(dirname "$0")/.."
export LIMS_DB=${LIMS_DB:-lims} PORT=${PORT:-3000}
access_event_key=${LIMS_ACCESS_EVENT_KEY:-$(openssl rand -hex 32)}
login=${LIMS_LOGIN:-demo}
unset LIMS_ACCESS_EVENT_KEY LIMS_LOGIN
WEB_PORT=${WEB_PORT:-5173}

scripts/pg.sh start >/dev/null
if [ "${1:-}" = --scratch ]; then
  LIMS_DB=$(node packages/db/src/checkout.ts database "$LIMS_DB")
  PGOPTIONS=--client-min-messages=warning scripts/pg.sh psql -q -v ON_ERROR_STOP=1 -v db="$LIMS_DB" <<<'drop database if exists :"db" with (force)'
fi
node packages/db/src/migrate.ts
if [ "$(scripts/pg.sh psql -d "$LIMS_DB" -tAc 'select count(*) from lims.lab')" = 0 ]; then
  node packages/db/src/seed.ts
else
  echo "$LIMS_DB is already seeded; its accounts were printed when it was first seeded."
fi

trap 'kill 0' EXIT
LIMS_LOG=1 LIMS_LOGIN=$login LIMS_ACCESS_EVENT_KEY=$access_event_key node apps/api/src/main.ts &
LIMS_API="http://127.0.0.1:$PORT" pnpm --filter @lims/web exec vite --port "$WEB_PORT" --strictPort &
echo "Open http://localhost:$WEB_PORT"
wait
