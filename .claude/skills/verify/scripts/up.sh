#!/usr/bin/env bash
# Starts one verification instance for this checkout: a scratch database seeded fresh, the API and the web
# on free ports, all in a process group of their own so down.sh can stop exactly what this started.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
STATE=$ROOT/.verify/instance
cd "$ROOT"

if [ -f "$STATE/env" ] && kill -0 -- "-$(sed -n 's/^PGID=//p' "$STATE/env")" 2>/dev/null; then
  echo "A verification instance is already up: $(sed -n 's/^WEB=//p' "$STATE/env"). Drive it, or run down.sh first." >&2
  exit 1
fi
[ -d node_modules ] || pnpm install --frozen-lockfile
rm -rf "$STATE"
mkdir -p "$STATE"

read -r API_PORT WEB_PORT < <(node -e '
  const net = require("node:net");
  const free = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });
  Promise.all([free(), free()]).then((ports) => console.log(ports.join(" ")));')
PASSWORD=verify-demo-password
DB=$(node packages/db/src/checkout.ts database lims_verify)

set -m
LIMS_DB=lims_verify PORT=$API_PORT WEB_PORT=$WEB_PORT DEMO_PASSWORD=$PASSWORD \
  nohup scripts/dev.sh --scratch >"$STATE/server.log" 2>&1 &
PGID=$!
set +m
cat >"$STATE/env" <<EOF
PGID=$PGID
WEB=http://localhost:$WEB_PORT
API=http://127.0.0.1:$API_PORT
DB=$DB
PASSWORD=$PASSWORD
COMMIT=$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- apps packages || echo -dirty)
EOF

for _ in $(seq 120); do
  if ! kill -0 -- "-$PGID" 2>/dev/null; then
    echo "The instance stopped while starting. The end of $STATE/server.log:" >&2
    tail -20 "$STATE/server.log" >&2
    exit 1
  fi
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/api/me")" = 401 ]; then
    echo "ready: http://localhost:$WEB_PORT (API $API_PORT, database $DB, password $PASSWORD)"
    exit 0
  fi
  sleep 0.5
done
echo "Not ready after 60 s. See $STATE/server.log, then run down.sh." >&2
exit 1
