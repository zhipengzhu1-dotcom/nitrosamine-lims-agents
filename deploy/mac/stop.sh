#!/usr/bin/env bash
# Stops the demo's containers and keeps them, their volumes and networks.
#   deploy/mac/stop.sh [--dry-run] [--down]
#     --down  also removes the containers and networks (never the volumes)
set -euo pipefail
source "$(dirname "$0")/env.sh"

action=stop DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --down) action=down ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

if [ "$action" = down ]; then
  echo "WARNING: --down removes the containers and networks. The volumes stay, but never add -v:"
  echo "         the pgdata, reports and state volumes are the only copy until backup.sh has run."
fi
if $DRY_RUN; then
  echo "would run: DOCKER_HOST=$DOCKER_HOST ${compose[*]} $action"
else
  "${compose[@]}" "$action"
fi
