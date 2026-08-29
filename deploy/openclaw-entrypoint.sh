#!/bin/sh
set -eu

secret_file="${OPENCLAW_PROJECTED_ENV_FILE:-/run/openclaw-secrets/runtime.env}"
if [ ! -r "$secret_file" ]; then
  echo "OpenClaw projected secret file is unavailable: $secret_file" >&2
  exit 78
fi

set -a
# The file is generated from a fixed key allowlist with POSIX-safe quoting.
. "$secret_file"
set +a

exec "$@"
