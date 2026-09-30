#!/usr/bin/env bash
# Starts the demo on the owner's Mac. Refuses to launch as `real` unless FileVault has a personal
# recovery key (ADR 0002 "The real-data gate"), and refuses any launch whose secrets are missing
# or readable by anyone but the owner.
#   deploy/mac/start.sh [--dry-run] [--local] [--data-class fictional|real]
#     --local   serve on http://127.0.0.1:8080 of this Mac instead of starting the tunnel
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
PROFILE="${LIMS_COLIMA_PROFILE:-lims}"
SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}"
DATA_CLASS=fictional
MODE=tunnel
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --local) MODE=local ;;
    --data-class) DATA_CLASS="${2:-}"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

refuse() { echo "REFUSED: $*" >&2; exit 1; }

case "$DATA_CLASS" in
  fictional) echo "Data class: fictional. Fictional data only; every page shows the banner." ;;
  real) echo "Data class: real." ;;
  *) refuse "data class must be fictional or real, not '$DATA_CLASS'" ;;
esac

fdesetup status | grep -q 'FileVault is On' || refuse "FileVault is off; the Mac's disk encryption is the at-rest control"

if [ "$DATA_CLASS" = real ]; then
  if $DRY_RUN; then
    echo "would check: sudo fdesetup haspersonalrecoverykey prints true, else refuse"
  else
    personal="$(sudo fdesetup haspersonalrecoverykey)"
    [ "$personal" = true ] || refuse "FileVault's recovery key is escrowed to iCloud (haspersonalrecoverykey: $personal). Switch to a personal key and sign the data-class Release Log entry first"
    echo "ok   FileVault has a personal recovery key; record this in the Release Log entry"
  fi
fi

case "$SECRETS_DIR/" in
  "$REPO_DIR"/*) refuse "the secrets folder $SECRETS_DIR is inside the repo" ;;
esac
[ -d "$SECRETS_DIR" ] || refuse "no secrets folder at $SECRETS_DIR; run deploy/mac/secrets.sh"
[ "$(stat -f %Lp "$SECRETS_DIR")" = 700 ] || refuse "$SECRETS_DIR must be mode 700"
required=(db_superuser_password db_migrator_password db_app_password totp_encryption_key password_pepper
  worker_upload_token worker_alarm_token age_public_key)
[ "$MODE" = tunnel ] && required+=(cloudflared.yml tunnel_credentials.json)
for name in "${required[@]}"; do
  file="$SECRETS_DIR/$name"
  [ -s "$file" ] || refuse "missing secret $name; run deploy/mac/secrets.sh"
  [ "$(stat -f %Su:%Lp "$file")" = "$(id -un):600" ] || refuse "$name must be owned by $(id -un) with mode 600"
done
echo "ok   secrets present and owner-only in $SECRETS_DIR"

if [ "$MODE" = tunnel ] && [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then
  refuse "the working tree has uncommitted changes; a release is built from a commit"
fi

BREW="$(brew --prefix)"
export DOCKER_HOST="unix://$HOME/.colima/$PROFILE/docker.sock"
export DOCKER_CONFIG="$HOME/.config/nitrosamine-lims/docker"
export LIMS_SECRETS_DIR="$SECRETS_DIR" LIMS_DATA_CLASS="$DATA_CLASS"
export LIMS_RELEASE="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
compose=("$BREW/bin/docker-compose" --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml")
if [ "$MODE" = local ]; then compose+=(-f "$DEPLOY_DIR/compose.local.yaml"); else compose+=(--profile tunnel); fi

if $DRY_RUN; then
  echo "would check: colima profile $PROFILE is running and chrony in its VM is synced within 1 s"
  echo "would run: DOCKER_HOST=$DOCKER_HOST LIMS_RELEASE=$LIMS_RELEASE ${compose[*]} up -d --build --wait"
  echo "would print: the images for the Release Log entry"
  exit 0
fi

"$BREW/bin/colima" status -p "$PROFILE" >/dev/null 2>&1 || refuse "colima profile $PROFILE is not running; run deploy/mac/bootstrap.sh"
"$BREW/bin/colima" ssh -p "$PROFILE" -- chronyc -n waitsync 3 1.0 >/dev/null 2>&1 ||
  refuse "chrony in the VM is not synced within 1 s; run deploy/mac/bootstrap.sh"

"${compose[@]}" up -d --build --wait
echo "Release $LIMS_RELEASE is up. Images for the Release Log entry:"
"${compose[@]}" images
