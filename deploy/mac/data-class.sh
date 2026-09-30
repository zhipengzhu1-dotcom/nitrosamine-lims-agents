#!/usr/bin/env bash
# Changes the data class stored with the data, the only way it changes (ADR 0002 "The real-data
# gate"). Takes the signed Release Log entry that approved the change; the change and that
# reference are appended to the history on the state volume. The demo must be stopped.
#   deploy/mac/data-class.sh <fictional|real> --release-log <link> [--dry-run]
set -euo pipefail
source "$(dirname "$0")/env.sh"

to="" ref="" DRY_RUN=false
while [ $# -gt 0 ]; do
  case "$1" in
    fictional | real) to="$1" ;;
    --release-log) ref="${2:-}"; shift ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$to" ] || refuse "name the new class: fictional or real"
[ -n "$ref" ] || refuse "a data class change needs --release-log with the signed entry's link"

if [ "$to" = real ]; then
  if $DRY_RUN; then
    echo "would check: sudo fdesetup haspersonalrecoverykey prints true, else refuse"
  else
    personal="$(sudo fdesetup haspersonalrecoverykey)"
    [ "$personal" = true ] || refuse "FileVault's recovery key is escrowed to iCloud (haspersonalrecoverykey: $personal)"
  fi
fi

if $DRY_RUN; then
  echo "would check: the api container is not running"
  echo "would run: ${compose[*]} run --rm --no-deps -T db-init node deploy/db/data-class.ts set $to '$ref'"
  exit 0
fi
[ -z "$("${compose[@]}" ps --status running -q api)" ] || refuse "stop the demo first (deploy/mac/stop.sh)"
"${compose[@]}" run --rm --no-deps -T db-init node deploy/db/data-class.ts set "$to" "$ref"
echo "Start the next release with: deploy/mac/start.sh --data-class $to"
