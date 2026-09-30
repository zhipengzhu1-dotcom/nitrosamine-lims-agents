#!/usr/bin/env bash
# Stops the demo's containers. Keeps every volume: stopping never deletes records.
#   deploy/mac/stop.sh [--dry-run]
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${LIMS_COLIMA_PROFILE:-lims}"
export DOCKER_HOST="unix://$HOME/.colima/$PROFILE/docker.sock"
export DOCKER_CONFIG="$HOME/.config/nitrosamine-lims/docker"
export LIMS_SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}" LIMS_DATA_CLASS=fictional
compose=("$(brew --prefix)/bin/docker-compose" --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml"
  -f "$DEPLOY_DIR/compose.local.yaml" --profile tunnel)

if [ "${1:-}" = "--dry-run" ]; then
  echo "would run: DOCKER_HOST=$DOCKER_HOST ${compose[*]} down"
else
  "${compose[@]}" down
fi
