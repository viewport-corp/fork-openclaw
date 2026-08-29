#!/usr/bin/env bash
set -euo pipefail
# Pre-pull the reviewed private GHCR digest into the docker-viewport daemon before Dokploy starts it.
# Reads only GITHUB_TOKEN_VIEWPORT_CORP from /srv/viewport/secrets/platformx.env and uses temporary Docker auth under /run.

OPENCLAW_PREPULL_SECRETS_FILE="${OPENCLAW_PREPULL_SECRETS_FILE:-/srv/viewport/secrets/platformx.env}"
OPENCLAW_PREPULL_IMAGE="${OPENCLAW_PREPULL_IMAGE:-ghcr.io/viewport-corp/fork-openclaw@sha256:3f5aa956e2f4021735065f7c9638420aed2dcbf05d8b79a3c2b936282fc59c0e}"
OPENCLAW_PREPULL_DOCKER_CONTEXT="${OPENCLAW_PREPULL_DOCKER_CONTEXT:-docker-viewport}"
OPENCLAW_PREPULL_DOCKER_CONFIG="$(mktemp -d /run/openclaw-ghcr-prepull.XXXXXX)"

cleanup() {
  rm -rf "$OPENCLAW_PREPULL_DOCKER_CONFIG"
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

OPENCLAW_PREPULL_TOKEN=""
while IFS= read -r OPENCLAW_PREPULL_LINE; do
  case "$OPENCLAW_PREPULL_LINE" in
    GITHUB_TOKEN_VIEWPORT_CORP=*)
      OPENCLAW_PREPULL_TOKEN="${OPENCLAW_PREPULL_LINE#GITHUB_TOKEN_VIEWPORT_CORP=}"
      break
      ;;
  esac
done < "$OPENCLAW_PREPULL_SECRETS_FILE"
OPENCLAW_PREPULL_TOKEN="${OPENCLAW_PREPULL_TOKEN%\"}"
OPENCLAW_PREPULL_TOKEN="${OPENCLAW_PREPULL_TOKEN#\"}"

if [[ -z "$OPENCLAW_PREPULL_TOKEN" ]]; then
  echo "GITHUB_TOKEN_VIEWPORT_CORP is missing or empty in $OPENCLAW_PREPULL_SECRETS_FILE" >&2
  exit 78
fi

echo "Logging into GHCR with temporary Docker auth under /run for $OPENCLAW_PREPULL_DOCKER_CONTEXT"
printf "%s\n" "$OPENCLAW_PREPULL_TOKEN" |
  DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker --context "$OPENCLAW_PREPULL_DOCKER_CONTEXT" login ghcr.io --username viewport-corp --password-stdin >/dev/null

echo "Pulling $OPENCLAW_PREPULL_IMAGE into Docker context $OPENCLAW_PREPULL_DOCKER_CONTEXT"
DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker --context "$OPENCLAW_PREPULL_DOCKER_CONTEXT" pull "$OPENCLAW_PREPULL_IMAGE"
DOCKER_CONFIG="$OPENCLAW_PREPULL_DOCKER_CONFIG" docker --context "$OPENCLAW_PREPULL_DOCKER_CONTEXT" logout ghcr.io >/dev/null 2>&1 || true

echo "Pre-pull complete; temporary Docker auth removed on exit"
