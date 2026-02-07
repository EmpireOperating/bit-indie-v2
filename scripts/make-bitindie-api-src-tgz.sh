#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"

OUT_PATH_DEFAULT="$ROOT_DIR/out/bitindie-api-src.tgz"
OUT_PATH="${1:-$OUT_PATH_DEFAULT}"

if [[ ! -d "$API_DIR" ]]; then
  echo "Expected API dir at: $API_DIR" >&2
  exit 2
fi

mkdir -p "$(dirname "$OUT_PATH")"

# This tarball is used as the docker build context on the VPS (see ops runbook).
# Keep it minimal and deterministic: no node_modules, no dist, no env files.
# Note: Dockerfile generates prisma client + builds the app inside docker.
(
  cd "$API_DIR"

  tar \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    --exclude='./docker-compose*.yml' \
    -czf "$OUT_PATH" \
    ./Dockerfile \
    ./package.json \
    ./package-lock.json \
    ./tsconfig.json \
    ./prisma.config.ts \
    ./prisma \
    ./src \
    ./scripts
)

echo "Wrote: $OUT_PATH"
