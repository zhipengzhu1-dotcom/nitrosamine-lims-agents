#!/usr/bin/env bash
# A PostgreSQL 18 cluster for development and tests, one for each checkout, trusting localhost only.
# The Node code finds the running cluster as this script does, in its postmaster.pid (packages/db/src/config.ts).
# With LIMS_PG set, both use that server instead and start leaves the cluster alone (CI's service container).
set -euo pipefail
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@18/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=$ROOT/.pg/data

port() {
  if [[ ${LIMS_PG:-} =~ ^postgres://postgres@localhost:([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [ -n "${LIMS_PG:-}" ]; then
    echo "scripts/pg.sh reaches only postgres://postgres@localhost:<port>, and LIMS_PG names another server." >&2
    return 1
  elif [ -f "$DATA/postmaster.pid" ]; then
    sed -n 4p "$DATA/postmaster.pid"
  else
    echo "This checkout has no PostgreSQL running. Run scripts/pg.sh start, or set LIMS_PG." >&2
    return 1
  fi
}

case "${1:-}" in
  start)
    if [ -z "${LIMS_PG:-}" ] && ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      [ -d "$DATA" ] || "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
      # The port and the test database names come from one hash of the checkout's path (packages/db/src/checkout.ts),
      # so that two checkouts ask for neither the same port nor the same database.
      PORT=$(node "$ROOT/packages/db/src/checkout.ts" port)
      "$PGBIN/pg_ctl" -D "$DATA" -l "$ROOT/.pg/server.log" -w \
        -o "-p $PORT -c listen_addresses=localhost -c timezone=UTC" start >/dev/null
    fi
    PORT=$(port)
    echo "postgres://postgres@localhost:$PORT"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  psql) shift; PORT=$(port); exec "$PGBIN/psql" -h localhost -p "$PORT" -U postgres "$@" ;;
  *) echo "usage: scripts/pg.sh start|stop|psql [args]" >&2; exit 2 ;;
esac
