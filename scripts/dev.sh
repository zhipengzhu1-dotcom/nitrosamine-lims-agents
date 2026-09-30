#!/usr/bin/env bash
# Local development against the scripts/pg.sh cluster, with the same environment the API reads in
# deploy (deploy/README.md, "Runtime contract"). Secrets are generated once into .lims/ (ignored by
# git) and are for the local database only.
#
#   scripts/dev.sh migrate            create and migrate the lims_dev database
#   scripts/dev.sh seed [--handover]  seed the demo dataset through the real commands
#   scripts/dev.sh api                start the API on http://127.0.0.1:3000
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.lims"
DB="${PGDATABASE:-lims_dev}"
mkdir -p "$DIR/reports"
for key in pepper totp-key; do
  [ -f "$DIR/$key" ] || { umask 077; openssl rand -base64 32 > "$DIR/$key"; }
done
export PGDATABASE="$DB"
export LIMS_RELEASE="${LIMS_RELEASE:-dev-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}"
export LIMS_PASSWORD_PEPPER_FILE="$DIR/pepper"
export LIMS_TOTP_ENCRYPTION_KEY_FILE="$DIR/totp-key"
export LIMS_REPORT_STORE="$DIR/reports"
"$ROOT/scripts/pg.sh" up >/dev/null
case "${1:-}" in
  migrate) pnpm --filter @lims/db migrate "$DB" ;;
  seed) shift; pnpm --filter @lims/api seed "$@" ;;
  api) pnpm --filter @lims/api start ;;
  *) echo "usage: scripts/dev.sh migrate | seed [--handover] | api" >&2; exit 2 ;;
esac
