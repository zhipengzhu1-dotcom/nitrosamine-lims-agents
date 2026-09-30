#!/usr/bin/env bash
# Creates the generated Compose secrets in the owner-only secrets folder, and lists the ones only
# the owner can provide. Never overwrites an existing file, so rerunning it is safe.
#   deploy/mac/secrets.sh [--dry-run]
set -euo pipefail

SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# name:format. Hex for passwords and tokens (safe in pgpass and in headers), base64 for keys.
GENERATED=(
  db_superuser_password:hex
  db_migrator_password:hex
  db_app_password:hex
  totp_encryption_key:base64
  password_pepper:base64
  worker_upload_token:hex
  worker_alarm_token:hex
)
OWNER_PROVIDED=(
  "age_public_key: the age public key made on 2026-09-30 (decision #34)"
  "cloudflared.yml: deploy/cloudflared/config.yml.template with the tunnel id filled in"
  "tunnel_credentials.json: the credentials file \`cloudflared tunnel create\` wrote"
  "approved_releases: one line per signed release, as \`start.sh --local\` prints it"
)

if [ ! -d "$SECRETS_DIR" ]; then
  if $DRY_RUN; then echo "would create $SECRETS_DIR (mode 700)"; else mkdir -p -m 700 "$SECRETS_DIR"; fi
fi

umask 077
for entry in "${GENERATED[@]}"; do
  name="${entry%%:*}" format="${entry#*:}"
  file="$SECRETS_DIR/$name"
  if [ -e "$file" ]; then
    echo "keep     $name"
  elif $DRY_RUN; then
    echo "would generate $name (32 random bytes, $format)"
  else
    if [ "$format" = hex ]; then openssl rand -hex 32 > "$file"; else openssl rand -base64 32 > "$file"; fi
    chmod 600 "$file"
    echo "created  $name"
  fi
done

for entry in "${OWNER_PROVIDED[@]}"; do
  name="${entry%%:*}"
  if [ -e "$SECRETS_DIR/$name" ]; then echo "keep     $name"; else echo "MISSING  $name (owner:${entry#*:})"; fi
done
