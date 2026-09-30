#!/bin/sh
# Writes the database password secrets this container was given into a pgpass file on a tmpfs, so
# node-postgres authenticates without a password in the environment. A container gets only the
# secrets compose grants it: the API gets lims_app's, the init job the superuser's and migrator's.
set -eu
umask 077
pgpass=/run/lims/pgpass
: > "$pgpass"
for pair in postgres:db_superuser_password lims_migrator:db_migrator_password lims_app:db_app_password; do
  file="/run/secrets/${pair#*:}"
  if [ -r "$file" ]; then
    printf '*:*:*:%s:%s\n' "${pair%%:*}" "$(cat "$file")" >> "$pgpass"
  fi
done
export PGPASSFILE="$pgpass"
[ "$#" -gt 0 ] || set -- node "$API_ENTRY"
exec "$@"
