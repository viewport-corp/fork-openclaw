#!/usr/bin/env bash
set -euo pipefail
# Pre-pull the reviewed private GHCR digest into the docker-viewport daemon before Dokploy starts it.
# Reads only GITHUB_TOKEN_VIEWPORT_CORP from /srv/viewport/secrets/platformx.env and uses temporary Docker auth under /run.

OPENCLAW_PREPULL_SECRETS_FILE="${OPENCLAW_PREPULL_SECRETS_FILE:-/srv/viewport/secrets/platformx.env}"
OPENCLAW_PREPULL_IMAGE="${OPENCLAW_PREPULL_IMAGE:-ghcr.io/viewport-corp/fork-openclaw@sha256:3f5aa956e2f4021735065f7c9638420aed2dcbf05d8b79a3c2b936282fc59c0e}"
OPENCLAW_PREPULL_DOCKER_HOST="${OPENCLAW_PREPULL_DOCKER_HOST:-unix:///var/run/docker-viewport.sock}"
OPENCLAW_PREPULL_GHCR_USERNAME="${OPENCLAW_PREPULL_GHCR_USERNAME:-theplatformx}"
OPENCLAW_PREPULL_DOCKER_CONFIG="$(mktemp -d /run/openclaw-ghcr-prepull.XXXXXX)"

cleanup() {
  case "$OPENCLAW_PREPULL_DOCKER_CONFIG" in
    /run/openclaw-ghcr-prepull.*) rm -rf "$OPENCLAW_PREPULL_DOCKER_CONFIG" ;;
    *) echo "Refusing to remove unexpected Docker config path: $OPENCLAW_PREPULL_DOCKER_CONFIG" >&2 ;;
  esac
}
trap cleanup EXIT

if [[ "$OPENCLAW_PREPULL_SECRETS_FILE" != "/srv/viewport/secrets/platformx.env" ]]; then
  echo "Refusing to read GitHub token outside /srv/viewport/secrets/platformx.env" >&2
  exit 64
fi

if [[ ! -r "$OPENCLAW_PREPULL_SECRETS_FILE" ]]; then
  echo "Cannot read $OPENCLAW_PREPULL_SECRETS_FILE" >&2
  exit 66
fi

if [[ ! "$OPENCLAW_PREPULL_IMAGE" =~ ^ghcr\.io/viewport-corp/fork-openclaw@sha256:[a-f0-9]{64}$ ]]; then
  echo "OPENCLAW_PREPULL_IMAGE must be the exact reviewed GHCR digest" >&2
  exit 64
fi

case "$OPENCLAW_PREPULL_DOCKER_HOST" in
  unix:///var/run/docker-viewport.sock) ;;
  *) echo "OPENCLAW_PREPULL_DOCKER_HOST must target the docker-viewport socket" >&2; exit 64 ;;
esac

OPENCLAW_PREPULL_TOKEN="$(
  set +u
  . "$OPENCLAW_PREPULL_SECRETS_FILE"
  printf "%s" "${GITHUB_TOKEN_VIEWPORT_CORP:-}"
)"

if [[ -z "$OPENCLAW_PREPULL_TOKEN" ]]; then
  echo "GITHUB_TOKEN_VIEWPORT_CORP is missing or empty in $OPENCLAW_PREPULL_SECRETS_FILE" >&2
  exit 78
fi

echo "Logging into GHCR with temporary Docker auth under /run for $OPENCLAW_PREPULL_DOCKER_HOST"
printf "%s\n" "$OPENCLAW_PREPULL_TOKEN" |
  DOCKER_HOST="$OPENCLAW_PREPULL_DOCKER_HOST" DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker login ghcr.io --username "$OPENCLAW_PREPULL_GHCR_USERNAME" --password-stdin >/dev/null

echo "Pulling $OPENCLAW_PREPULL_IMAGE into Docker host $OPENCLAW_PREPULL_DOCKER_HOST"
DOCKER_HOST="$OPENCLAW_PREPULL_DOCKER_HOST" DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker pull "$OPENCLAW_PREPULL_IMAGE"
DOCKER_HOST="$OPENCLAW_PREPULL_DOCKER_HOST" DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker logout ghcr.io >/dev/null 2>&1 || true
unset OPENCLAW_PREPULL_TOKEN

echo "Pre-pull complete; temporary Docker auth removed on exit"
