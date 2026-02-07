#!/usr/bin/env bash
set -euo pipefail

# One-command staging redeploy.
#
# 1) Builds a tarball of apps/api (Docker build context)
# 2) Uploads it to the staging VPS (/opt/bitindie-staging/bitindie-api-src.tgz)
# 3) Runs `make redeploy` on the VPS

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STAGING_HOST="${STAGING_HOST:-89.167.43.73}"
STAGING_USER="${STAGING_USER:-root}"
STAGING_KEY="${STAGING_KEY:-$HOME/.ssh/bitindie_hetzner_staging}"
STAGING_DIR="${STAGING_DIR:-/opt/bitindie-staging}"

if [[ ! -f "$STAGING_KEY" ]]; then
  echo "Missing SSH key: $STAGING_KEY" >&2
  exit 2
fi

TARBALL="$(mktemp -t bitindie-api-src.XXXXXX.tgz)"
cleanup() { rm -f "$TARBALL"; }
trap cleanup EXIT

echo "== Building tarball =="
"$REPO_ROOT/scripts/make-bitindie-api-src-tgz.sh" "$TARBALL" >/dev/null

echo "== Uploading to $STAGING_USER@$STAGING_HOST:$STAGING_DIR/bitindie-api-src.tgz =="
scp -i "$STAGING_KEY" "$TARBALL" "$STAGING_USER@$STAGING_HOST:$STAGING_DIR/bitindie-api-src.tgz"

echo "== Running make redeploy on VPS =="
ssh -i "$STAGING_KEY" "$STAGING_USER@$STAGING_HOST" "cd '$STAGING_DIR' && make redeploy"
