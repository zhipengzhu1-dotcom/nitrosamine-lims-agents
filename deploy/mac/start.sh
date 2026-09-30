#!/usr/bin/env bash
# Starts the demo on the owner's Mac, in two steps that bracket the owner's approval:
#   deploy/mac/start.sh --local   builds this commit, serves it on http://127.0.0.1:8080 only, and
#                                 prints the release record the owner signs in the Release Log
#   deploy/mac/start.sh           the tunnel launch: runs only the images of a commit listed in
#                                 the owner's approved_releases file, with the ids recorded there
# Both refuse a dirty tree, missing or shared secrets, an unsynced clock, a failing
# `pnpm check:deploy`, and a data class that differs from the one stored with the data. Starting
# data stored as `real` needs a personal FileVault recovery key (ADR 0002 "The real-data gate").
#   deploy/mac/start.sh [--dry-run] [--local] [--data-class fictional|real]
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
PROFILE="${LIMS_COLIMA_PROFILE:-lims}"
SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}"
APPROVALS="$SECRETS_DIR/approved_releases"
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
field() { printf '%s\n' "$1" | tr ' ' '\n' | sed -n "s/^$2=//p"; }

case "$DATA_CLASS" in fictional | real) ;; *) refuse "data class must be fictional or real, not '$DATA_CLASS'" ;; esac

fdesetup status | grep -q 'FileVault is On' || refuse "FileVault is off; the Mac's disk encryption is the at-rest control"

case "$SECRETS_DIR/" in
  "$REPO_DIR"/*) refuse "the secrets folder $SECRETS_DIR is inside the repo" ;;
esac
[ -d "$SECRETS_DIR" ] || refuse "no secrets folder at $SECRETS_DIR; run deploy/mac/secrets.sh"
[ "$(stat -f %Lp "$SECRETS_DIR")" = 700 ] || refuse "$SECRETS_DIR must be mode 700"
required=(db_superuser_password db_migrator_password db_app_password totp_encryption_key password_pepper commit_input_key
  worker_upload_token worker_alarm_token age_public_key)
[ "$MODE" = tunnel ] && required+=(cloudflared.yml tunnel_credentials.json approved_releases)
for name in "${required[@]}"; do
  file="$SECRETS_DIR/$name"
  [ -s "$file" ] || refuse "missing $name in $SECRETS_DIR (deploy/README.md says who makes it)"
  [ "$(stat -f %Su:%Lp "$file")" = "$(id -un):600" ] || refuse "$name must be owned by $(id -un) with mode 600"
done
echo "ok   secrets present and owner-only in $SECRETS_DIR"

[ -z "$(git -C "$REPO_DIR" status --porcelain)" ] || refuse "the working tree has uncommitted changes; a release is built from a commit"
HEAD_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"

approval=""
if [ "$MODE" = tunnel ]; then
  approval="$(awk -v c="$HEAD_SHA" '$1 == c' "$APPROVALS" | tail -n 1)"
  [ -n "$approval" ] || refuse "commit $HEAD_SHA is not in $APPROVALS; run --local, sign its Release Log entry, then add its approval line"
  echo "ok   $HEAD_SHA approved: $(field "$approval" ref)"
fi

BREW="$(brew --prefix)"
export PATH="$BREW/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/$PROFILE/docker.sock"
export DOCKER_CONFIG="$HOME/.config/nitrosamine-lims/docker"
export LIMS_SECRETS_DIR="$SECRETS_DIR" LIMS_DATA_CLASS="$DATA_CLASS"
export LIMS_RELEASE="${HEAD_SHA:0:7}"
compose=(docker-compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml")
if [ "$MODE" = local ]; then compose+=(-f "$DEPLOY_DIR/compose.local.yaml"); else compose+=(--profile tunnel); fi
API_IMAGE="nitrosamine-lims/api:$LIMS_RELEASE"
WEB_IMAGE="nitrosamine-lims/web:$LIMS_RELEASE"

if $DRY_RUN; then
  echo "would check: colima profile $PROFILE is running and chrony in its VM is synced within 1 s"
  echo "would run: pnpm check:deploy, and refuse if it fails"
  if [ "$MODE" = local ]; then
    echo "would run: ${compose[*]} build, and pull the pinned cloudflared image if it is missing"
  else
    echo "would check: $API_IMAGE is $(field "$approval" api) and $WEB_IMAGE is $(field "$approval" web), as approved"
  fi
  echo "would check: the data class stored with the data is $DATA_CLASS (or none yet), and if it is real, that sudo fdesetup haspersonalrecoverykey prints true"
  echo "would run: DOCKER_HOST=$DOCKER_HOST ${compose[*]} up -d --no-build --wait"
  echo "would print: the release record, and chrony's clock steps since the last start"
  exit 0
fi

colima status -p "$PROFILE" >/dev/null 2>&1 || refuse "colima profile $PROFILE is not running; run deploy/mac/bootstrap.sh"
colima ssh -p "$PROFILE" -- chronyc -n waitsync 3 1.0 >/dev/null 2>&1 ||
  refuse "chrony in the VM is not synced within 1 s; run deploy/mac/bootstrap.sh"

(cd "$REPO_DIR" && pnpm check:deploy) || refuse "pnpm check:deploy failed"

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || echo "absent"; }
if [ "$MODE" = local ]; then
  "${compose[@]}" build
  "${compose[@]}" --profile tunnel pull --policy missing tunnel
else
  for pair in "api:$API_IMAGE" "web:$WEB_IMAGE"; do
    approved="$(field "$approval" "${pair%%:*}")" actual="$(image_id "${pair#*:}")"
    [ "$approved" = "$actual" ] || refuse "${pair#*:} is $actual, but the approved release recorded $approved"
  done
  echo "ok   the images are the ones approved"
fi

stored="$("${compose[@]}" run --rm --no-deps -T db-init node deploy/db/data-class.ts show 2>/dev/null)" ||
  refuse "could not read the stored data class"
if [ "$stored" != none ] && [ "$stored" != "$DATA_CLASS" ]; then
  refuse "the data is stored as $stored, and this start asks for $DATA_CLASS; change it with deploy/mac/data-class.sh"
fi
effective="${stored/none/$DATA_CLASS}"
if [ "$effective" = real ]; then
  personal="$(sudo fdesetup haspersonalrecoverykey)"
  [ "$personal" = true ] || refuse "FileVault's recovery key is escrowed to iCloud (haspersonalrecoverykey: $personal). Switch to a personal key and sign the data-class Release Log entry first"
  echo "ok   FileVault has a personal recovery key; record this in the Release Log entry"
else
  echo "Data class: fictional. Fictional data only; every page shows the banner."
fi

since="$({ docker inspect --format '{{.State.StartedAt}}' nitrosamine-lims-api-1 2>/dev/null || true; } | cut -c1-19 | tr T ' ')"
"${compose[@]}" up -d --no-build --wait

api_id="$(image_id "$API_IMAGE")" web_id="$(image_id "$WEB_IMAGE")"
echo
echo "Release record for the Release Log entry:"
echo "  commit             $HEAD_SHA"
echo "  runbook commit     $(git -C "$REPO_DIR" log -1 --format=%H -- deploy/README.md)"
echo "  data class         $DATA_CLASS"
echo "  image api          $api_id"
echo "  image web          $web_id"
"${compose[@]}" --profile tunnel config --images 2>/dev/null | grep -E '^(postgres|cloudflare/cloudflared)[:@]' | while read -r ref; do
  echo "  image $(printf '%-22s' "${ref%%[:@]*}") $(image_id "$ref") ($ref)"
done
if [ -f "$SECRETS_DIR/cloudflared.yml" ]; then
  echo "  cloudflared.yml    sha256 $(shasum -a 256 "$SECRETS_DIR/cloudflared.yml" | cut -d' ' -f1)"
  echo "  tunnel id          $(awk '/^tunnel:/ {print $2}' "$SECRETS_DIR/cloudflared.yml")"
fi
echo "  colima             $(colima version | head -n 1)"
echo "  docker-compose     $(docker-compose version --short)"
echo "  macOS              $(sw_vers -productVersion) ($(sw_vers -buildVersion))"

echo
echo "Clock steps in the VM since ${since:-the VM booted} (each is a System Incident; log it):"
since_arg="${since:+--since '$since UTC'}"
steps="$(echo "journalctl -u chrony --no-pager -o short-iso ${since_arg:--b}" | colima ssh -p "$PROFILE" -- sudo sh -s 2>/dev/null |
  grep -E 'System clock (wrong|was stepped)' || true)"
echo "${steps:-  none}"

if [ "$MODE" = local ]; then
  echo
  echo "Once the Release Log entry for this record is signed Approved, add this line to $APPROVALS:"
  echo "  $HEAD_SHA api=$api_id web=$web_id ref=<link to the signed entry>"
fi
