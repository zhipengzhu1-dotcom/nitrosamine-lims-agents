#!/usr/bin/env bash
# CI's runners in Docker on the owner's Mac (ci/runner/README.md). Each pass of a slot registers a just-in-time runner
# that takes one job in a fresh container and then deregisters, so no job sees another job's workspace or PostgreSQL.
# The registration comes from gh api at each pass and lives only in the container's arguments, never in a file.
set -euo pipefail
REPO=zhipengzhu1-dotcom/09-28-2026-LIMS
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SLOTS=(check e2e)

case "${1:-}" in
  build) docker build --pull --platform linux/arm64 -t lims-runner "$ROOT/ci/runner" ;;
  slot)
    SLOT=${2:?usage: scripts/ci-runner.sh slot check|e2e}
    while true; do
      docker rm -f "lims-runner-$SLOT" >/dev/null 2>&1 || true
      # Docker stopped or no image: wait here, so no runner registers that cannot start.
      docker image inspect lims-runner >/dev/null || { sleep 30; continue; }
      # runner_group_id 1 is the repo's Default runner group.
      CONFIG=$(gh api -X POST "repos/$REPO/actions/runners/generate-jitconfig" -f name="lims-runner-$SLOT-$(date +%s)" \
        -F runner_group_id=1 -f 'labels[]=self-hosted' -f 'labels[]=Linux' -f 'labels[]=ARM64' -f "labels[]=lims-$SLOT" \
        --jq .encoded_jit_config) || { sleep 30; continue; }
      docker run --rm --name "lims-runner-$SLOT" --shm-size 1g lims-runner ./run.sh --jitconfig "$CONFIG" || sleep 30
    done
    ;;
  start)
    # A second loop for a slot would remove the first loop's container mid-job.
    if pgrep -f 'ci-runner.sh slot' >/dev/null; then echo "The slots are already running. Run stop first." >&2; exit 1; fi
    mkdir -p "$HOME/Library/Logs/lims-runner"
    for n in "${SLOTS[@]}"; do
      # caffeinate holds off idle sleep while the slot runs. A sleeping Mac freezes the runner, and GitHub fails its job.
      nohup caffeinate -i "$0" slot "$n" >>"$HOME/Library/Logs/lims-runner/$n.log" 2>&1 &
    done
    ;;
  stop)
    pkill -f 'ci-runner.sh slot' || true
    for n in "${SLOTS[@]}"; do docker rm -f "lims-runner-$n" >/dev/null 2>&1 || true; done
    gh api --paginate "repos/$REPO/actions/runners" --jq '.runners[] | select(.name | startswith("lims-runner-")) | .id' |
      while read -r id; do gh api -X DELETE "repos/$REPO/actions/runners/$id" || echo "runner $id not deleted" >&2; done
    ;;
  status)
    gh api --paginate "repos/$REPO/actions/runners" --jq '.runners[] | [.name, .status, .busy] | @tsv'
    if pgrep -f '^caffeinate -i .*ci-runner\.sh slot' >/dev/null; then echo "The slots keep the Mac awake."
    else echo "No slot keeps the Mac awake. Run stop, then start." >&2; exit 1; fi ;;
  *) echo "usage: scripts/ci-runner.sh build|start|status|stop|slot check|e2e" >&2; exit 2 ;;
esac
