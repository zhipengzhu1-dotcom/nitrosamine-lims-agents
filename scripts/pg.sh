#!/usr/bin/env bash
# Project-local PostgreSQL 18 cluster for development and tests. Idempotent: `up` twice is `up` once.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@18/bin}"
DATA="$ROOT/.pg/data"
PORT="${PGPORT:-54329}"
LOG="$ROOT/.pg/postgres.log"

case "${1:-}" in
  up)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$ROOT/.pg"
      "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
      {
        echo "port = $PORT"
        echo "listen_addresses = 'localhost'"
        echo "unix_socket_directories = ''"
        echo "timezone = 'UTC'"
        echo "default_transaction_isolation = 'read committed'"
      } >> "$DATA/postgresql.conf"
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -w start >/dev/null
    fi
    echo "postgres://postgres@localhost:$PORT/postgres"
    ;;
  down)
    "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
    ;;
  psql)
    shift
    exec "$PGBIN/psql" -h localhost -p "$PORT" -U postgres "$@"
    ;;
  *)
    echo "usage: scripts/pg.sh up|down|psql [args]" >&2
    exit 2
    ;;
esac
