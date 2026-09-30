#!/usr/bin/env bash
# The owner-run backup until the Worker path exists (ADR 0002 "Backups"). Streams a pg_dump of the
# database, the report store and the Postgres operator logs through `age` to the owner's public
# key, so nothing is written in plaintext. The destination must be off the repo and off the VM.
#   deploy/mac/backup.sh --to <directory> [--dry-run]
# The restore check decrypts a backup into a scratch database, runs lims.verify_chain on every
# ledger, checks that both archives read back, and drops the scratch database.
#   deploy/mac/backup.sh --restore-check <backup directory> --identity <age identity file> [--dry-run]
set -euo pipefail
source "$(dirname "$0")/env.sh"
umask 077

mode="" target="" identity="" DRY_RUN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --to) mode=backup target="${2:-}"; shift ;;
    --restore-check) mode=restore target="${2:-}"; shift ;;
    --identity) identity="${2:-}"; shift ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$mode" ] && [ -n "$target" ] || { sed -n '5p;8p' "$0" >&2; exit 2; }
[ -d "$target" ] || refuse "$target is not a directory"

running="$("${compose[@]}" ps --status running --services 2>/dev/null || true)"
need_running() {
  for service in "$@"; do
    printf '%s\n' "$running" | grep -qx "$service" || refuse "$service is not running; start the demo first"
  done
}

if [ "$mode" = backup ]; then
  dest="$(cd "$target" && pwd -P)"
  repo="$(cd "$REPO_DIR" && pwd -P)"
  secrets="$(cd "$SECRETS_DIR" && pwd -P)"
  for forbidden in "$repo" "$secrets" "$HOME/.colima" "$HOME/.lima"; do
    case "$dest/" in "$forbidden"/*) refuse "$dest is inside $forbidden; a backup must live off the repo and off the Colima VM" ;; esac
  done
  recipients="$SECRETS_DIR/age_public_key"
  [ -s "$recipients" ] || refuse "no age public key at $recipients"
  out="$dest/nitrosamine-lims-$(date -u +%Y%m%dT%H%M%SZ)"
  if $DRY_RUN; then
    echo "would write, each encrypted with age -R $recipients:"
    echo "  $out/lims.dump.age      pg_dump --format=custom of lims, from the postgres container"
    echo "  $out/reports.tar.age    tar of the reports volume, from the api container"
    echo "  $out/oplogs.tar.age     tar of the Postgres log directory in the pgdata volume"
    echo "  $out/SHA256SUMS         and MANIFEST (commit, data class, time)"
    exit 0
  fi
  need_running postgres api
  mkdir -m 700 "$out"
  "${compose[@]}" exec -T postgres pg_dump -U postgres --format=custom lims | age -R "$recipients" -o "$out/lims.dump.age"
  "${compose[@]}" exec -T api tar -C /var/lib/lims/reports -cf - . | age -R "$recipients" -o "$out/reports.tar.age"
  "${compose[@]}" exec -T postgres sh -c 'tar -C "$PGDATA" -cf - log' | age -R "$recipients" -o "$out/oplogs.tar.age"
  stored="$("${compose[@]}" run --rm --no-deps -T db-init node deploy/db/data-class.ts show 2>/dev/null || echo unknown)"
  printf 'time %s\ncommit %s\ndata class %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C "$REPO_DIR" rev-parse HEAD)" "$stored" > "$out/MANIFEST"
  (cd "$out" && shasum -a 256 lims.dump.age reports.tar.age oplogs.tar.age MANIFEST > SHA256SUMS)
  echo "Backup written to $out. It is the only copy off the VM; keep it on a second disk."
  exit 0
fi

src="$(cd "$target" && pwd -P)"
[ -n "$identity" ] && [ -f "$identity" ] || refuse "--restore-check needs --identity with the age identity file"
scratch="lims_restore_check_$(date -u +%Y%m%d%H%M%S)"
if $DRY_RUN; then
  echo "would check: SHA256SUMS in $src"
  echo "would run: age -d -i $identity lims.dump.age | pg_restore into the scratch database $scratch"
  echo "would run: lims.verify_chain on every ledger in $scratch, then drop $scratch"
  echo "would check: reports.tar.age and oplogs.tar.age decrypt to readable tar archives"
  exit 0
fi
need_running postgres
(cd "$src" && shasum -a 256 -c SHA256SUMS)
for archive in reports oplogs; do
  age -d -i "$identity" "$src/$archive.tar.age" | tar -tf - >/dev/null || refuse "$archive.tar.age does not read back"
  echo "ok   $archive.tar.age decrypts to a readable archive"
done
psql() { "${compose[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
psql -d postgres -c "create database $scratch owner lims_owner"
trap 'psql -d postgres -c "drop database if exists $scratch with (force)" >/dev/null' EXIT
age -d -i "$identity" "$src/lims.dump.age" | "${compose[@]}" exec -T postgres pg_restore -U postgres --exit-on-error -d "$scratch"
report="$(psql -d "$scratch" -F ' ' -c "select h.ledger_id, v.intact_through, coalesce(v.first_break::text, '-'), v.head_matches
  from lims.audit_chain_head h cross join lateral lims.verify_chain(h.ledger_id) v order by h.ledger_id")"
printf '%s\n' "$report" | sed 's/^/  ledger /'
if [ -z "$report" ] || printf '%s\n' "$report" | awk '$3 != "-" || $4 != "t"' | grep -q .; then
  refuse "chain-verify failed on the restored backup (or it has no ledgers); this is a System Incident"
fi
echo "Restore check passed: every ledger's chain verifies in the restored copy."
