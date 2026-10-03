#!/usr/bin/env bash
# Runs the slice locally: Postgres, migrations, a seed on an empty database, then the API and the web together.
# --scratch gives the database this checkout's suffix and drops it first, and empties the API log.
# With LIMS_LOG_FILE set, the API appends its log to that file instead of printing it.
# The password pepper and the TOTP key, unless given, persist in the gitignored .pg/dev-secrets from the first start,
# so a password or an authenticator set under one start still verifies after the next; --scratch draws fresh ones.
set -euo pipefail
cd "$(dirname "$0")/.."
export LIMS_DB=${LIMS_DB:-lims} PORT=${PORT:-3000}
secrets=.pg/dev-secrets
if [ "${1:-}" != --scratch ] && [ ! -f "$secrets" ]; then
  mkdir -p .pg
  (umask 077; printf 'pepper=%s\ntotp_key=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >"$secrets")
fi
# shellcheck source=/dev/null
[ "${1:-}" = --scratch ] || . "$secrets"
access_event_key=${LIMS_ACCESS_EVENT_KEY:-$(openssl rand -hex 32)}
password_pepper=${LIMS_PASSWORD_PEPPER:-${pepper:-$(openssl rand -hex 32)}}
totp_key=${LIMS_TOTP_KEY:-${totp_key:-$(openssl rand -hex 32)}}
release=${LIMS_RELEASE:-development}
login=${LIMS_LOGIN:-demo}
log_file=${LIMS_LOG_FILE:-}
unset LIMS_ACCESS_EVENT_KEY LIMS_PASSWORD_PEPPER LIMS_TOTP_KEY LIMS_LOGIN LIMS_LOG_FILE LIMS_RELEASE
WEB_PORT=${WEB_PORT:-5173}

scripts/pg.sh start >/dev/null
if [ -n "$log_file" ]; then mkdir -p "$(dirname "$log_file")"; fi
if [ "${1:-}" = --scratch ]; then
  LIMS_DB=$(node packages/db/src/checkout.ts database "$LIMS_DB")
  PGOPTIONS=--client-min-messages=warning scripts/pg.sh psql -q -v ON_ERROR_STOP=1 -v db="$LIMS_DB" <<<'drop database if exists :"db" with (force)'
  if [ -n "$log_file" ]; then : >"$log_file"; fi
fi
node packages/db/src/migrate.ts
if [ "$(scripts/pg.sh psql -d "$LIMS_DB" -tAc 'select count(*) from lims.lab')" = 0 ]; then
  # The decided login admits only a hash made under the pepper, so its seed takes the API's pepper.
  if [ "$login" = decided ]; then LIMS_PASSWORD_PEPPER=$password_pepper node packages/db/src/seed.ts; else node packages/db/src/seed.ts; fi
else
  echo "$LIMS_DB is already seeded; its accounts were printed when it was first seeded."
fi

trap 'kill 0' EXIT
LIMS_LOG=1 LIMS_LOG_FILE=$log_file LIMS_LOGIN=$login LIMS_ACCESS_EVENT_KEY=$access_event_key LIMS_PASSWORD_PEPPER=$password_pepper LIMS_TOTP_KEY=$totp_key LIMS_RELEASE=$release node apps/api/src/main.ts &
LIMS_API="http://127.0.0.1:$PORT" pnpm --filter @lims/web exec vite --port "$WEB_PORT" --strictPort &
echo "Open http://localhost:$WEB_PORT"
wait
