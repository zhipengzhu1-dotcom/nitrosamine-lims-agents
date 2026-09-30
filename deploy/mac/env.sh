# Sourced by the Mac scripts: the Colima socket, the scripts' own Docker client config, and the
# compose command with every file and profile, so any service can be addressed.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
PROFILE="${LIMS_COLIMA_PROFILE:-lims}"
SECRETS_DIR="${LIMS_SECRETS_DIR:-$HOME/.config/nitrosamine-lims/secrets}"
export PATH="$(brew --prefix)/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/$PROFILE/docker.sock"
export DOCKER_CONFIG="$HOME/.config/nitrosamine-lims/docker"
export LIMS_SECRETS_DIR="$SECRETS_DIR" LIMS_DATA_CLASS="${LIMS_DATA_CLASS:-fictional}"
export LIMS_RELEASE="${LIMS_RELEASE:-$(git -C "$REPO_DIR" rev-parse --short HEAD)}"
compose=(docker-compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml"
  -f "$DEPLOY_DIR/compose.local.yaml" --profile tunnel)
refuse() { echo "REFUSED: $*" >&2; exit 1; }
