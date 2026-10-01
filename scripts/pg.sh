#!/usr/bin/env bash
# A project-local PostgreSQL 18 cluster for development and tests, trusting localhost only.
set -euo pipefail
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@18/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=${LIMS_PGDATA:-$ROOT/.pg/data}
PORT=${LIMS_PGPORT:-54339}

case "${1:-}" in
  start)
    if [ ! -d "$DATA" ]; then
      "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null; then
      "$PGBIN/pg_ctl" -D "$DATA" -l "$ROOT/.pg/server.log" -w \
        -o "-p $PORT -c listen_addresses=localhost -c timezone=UTC" start >/dev/null
    fi
    echo "postgres://postgres@localhost:$PORT"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  psql) shift; exec "$PGBIN/psql" -h localhost -p "$PORT" -U postgres "$@" ;;
  *) echo "usage: scripts/pg.sh start|stop|psql [args]" >&2; exit 2 ;;
esac
