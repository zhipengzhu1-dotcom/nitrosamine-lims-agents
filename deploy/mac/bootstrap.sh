#!/usr/bin/env bash
# Prepares the owner's Mac to run the demo: the open-source Docker tools from Homebrew (never
# Docker Desktop, whose free licence doesn't cover the company), a Colima VM that sees only the
# secrets folder, and chrony with NTS against time.cloudflare.com inside that VM (ADR 0002
# "Time"). Idempotent: each step checks before it acts.
#   deploy/mac/bootstrap.sh [--dry-run]
set -euo pipefail

PROFILE="${LIMS_COLIMA_PROFILE:-lims}"
SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}"
DOCKER_CONFIG_DIR="$HOME/.config/nitrosamine-lims/docker"
FORMULAE=(colima docker docker-compose docker-buildx cloudflared age)
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

run() {
  if $DRY_RUN; then printf 'would run:'; printf ' %q' "$@"; echo; else "$@"; fi
}

[ "$(uname -s)" = Darwin ] || { echo "bootstrap.sh is for the owner's Mac" >&2; exit 1; }
command -v brew >/dev/null || { echo "Homebrew is required: https://brew.sh" >&2; exit 1; }
BREW="$(brew --prefix)"

for formula in "${FORMULAE[@]}"; do
  if brew list --formula "$formula" >/dev/null 2>&1; then
    echo "ok   $formula installed"
  else
    run brew install "$formula"
  fi
done

if [ ! -d "$SECRETS_DIR" ]; then run mkdir -p -m 700 "$SECRETS_DIR"; fi

# The scripts' own Docker client config: Homebrew's buildx plugin, and none of Docker Desktop's
# credential helpers or hooks.
docker_config="{\"cliPluginsExtraDirs\": [\"$BREW/lib/docker/cli-plugins\"]}"
if [ "$(cat "$DOCKER_CONFIG_DIR/config.json" 2>/dev/null)" = "$docker_config" ]; then
  echo "ok   docker client config at $DOCKER_CONFIG_DIR"
elif $DRY_RUN; then
  echo "would write $DOCKER_CONFIG_DIR/config.json: $docker_config"
else
  mkdir -p "$DOCKER_CONFIG_DIR" && printf '%s\n' "$docker_config" > "$DOCKER_CONFIG_DIR/config.json"
fi

# 4 CPUs and 6 GiB leave the Mac usable and give Postgres, the API and Caddy room. The VM mounts
# only the secrets folder (read-only), so nothing in it can see the repo or the real exports.
# --activate=false leaves the owner's current Docker context alone; the scripts name the socket.
status="$("$BREW/bin/colima" status -p "$PROFILE" 2>&1 || true)"
if printf '%s' "$status" | grep -q 'is running'; then
  echo "ok   colima profile $PROFILE running"
else
  run "$BREW/bin/colima" start "$PROFILE" --activate=false \
    --cpus 4 --memory 6 --disk 60 --vm-type vz --vz-rosetta \
    --mount-type virtiofs --mount "$SECRETS_DIR"
fi

# makestep 1 -1: step the clock whenever it is more than 1 s off, not only at boot, because the VM
# wakes with the Mac hours behind. chrony logs each step; each one is a System Incident.
# cmdallow lets the API read the sync state (monitoring commands only, never control) from
# Compose's egress network, whose gateway is this VM; compose.yaml fixes that subnet.
CHRONY_CONF='# Written by deploy/mac/bootstrap.sh (ADR 0002, Time).
server time.cloudflare.com iburst nts
makestep 1 -1
driftfile /var/lib/chrony/chrony.drift
ntsdumpdir /var/lib/chrony
rtcsync
logdir /var/log/chrony
log tracking measurements statistics
bindcmdaddress 0.0.0.0
cmdallow 172.30.10.0/24'

VM_SCRIPT="$(cat <<VM
set -eu
if ! command -v chronyd >/dev/null 2>&1; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q chrony
fi
changed=false
if [ "\$(cat /etc/chrony/chrony.conf 2>/dev/null)" != "$CHRONY_CONF" ]; then
  printf '%s\n' "$CHRONY_CONF" > /etc/chrony/chrony.conf
  changed=true
fi
systemctl disable --now systemd-timesyncd >/dev/null 2>&1 || true
systemctl enable chrony >/dev/null 2>&1
if \$changed || ! systemctl is-active --quiet chrony; then systemctl restart chrony; fi
chronyc -n waitsync 30 1.0 >/dev/null && echo "ok   chrony synced within 1 s (NTS, time.cloudflare.com)" || { echo "chrony is not synced within 1 s" >&2; exit 1; }
VM
)"

if $DRY_RUN; then
  echo "would run inside the $PROFILE VM as root:"
  printf '%s\n' "$VM_SCRIPT" | sed 's/^/    /'
else
  printf '%s\n' "$VM_SCRIPT" | "$BREW/bin/colima" ssh -p "$PROFILE" -- sudo sh -s
fi
