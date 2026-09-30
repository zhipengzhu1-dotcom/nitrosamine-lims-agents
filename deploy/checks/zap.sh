#!/usr/bin/env bash
# The OWASP ZAP baseline scan (passive) against the --local stack, whose report goes with the
# Release Log entry (ADR 0002 "Security testing"). ZAP joins the local stack's published network
# and scans http://web; its report is copied out of the container, so nothing is bind-mounted.
#   deploy/checks/zap.sh --out <directory outside the repo> [--dry-run]
set -euo pipefail
source "$(dirname "$0")/../mac/env.sh"

# Not pinned by digest yet: the first run records the digest it pulled, and the owner pins it.
ZAP_IMAGE="${LIMS_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
NETWORK="nitrosamine-lims_published"
out="" DRY_RUN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:-}"; shift ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$out" ] && [ -d "$out" ] || refuse "--out must name an existing directory"
out="$(cd "$out" && pwd -P)"
case "$out/" in "$(cd "$REPO_DIR" && pwd -P)"/*) refuse "$out is inside the repo; reports stay out of git" ;; esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="lims-zap-$stamp"
scan=(docker run --name "$name" --network "$NETWORK" -v /zap/wrk "$ZAP_IMAGE"
  zap-baseline.py -t http://web:80 -r report.html -J report.json -I)
if $DRY_RUN; then
  echo "would check: the --local stack is running (web on $NETWORK)"
  echo "would run: DOCKER_HOST=$DOCKER_HOST ${scan[*]}"
  echo "would copy: /zap/wrk/report.html and report.json to $out/zap-baseline-$stamp.{html,json}"
  echo "would print: the scan's exit status and the ZAP image digest for the Release Log"
  exit 0
fi

docker network inspect "$NETWORK" >/dev/null 2>&1 || refuse "the --local stack is not up (no $NETWORK); run deploy/mac/start.sh --local"
set +e
"${scan[@]}"
status=$?
set -e
for ext in html json; do docker cp "$name:/zap/wrk/report.$ext" "$out/zap-baseline-$stamp.$ext"; done
docker rm -v "$name" >/dev/null
echo "ZAP $(docker image inspect --format '{{index .RepoDigests 0}}' "$ZAP_IMAGE") exited $status (0 pass, 1 fail, 3 error; warnings don't fail)."
echo "Report: $out/zap-baseline-$stamp.html"
exit "$status"
