#!/bin/sh
# Deploy the converter to Fly from a build context holding only what the image
# copies (the repo root would send every node_modules to the remote builder).
# Run from anywhere: sh media/deploy.sh [extra fly deploy flags]
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CTX=$(mktemp -d)
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/boards/src/lib" "$CTX/media"
cp "$ROOT/boards/src/lib/playCopy.js" "$CTX/boards/src/lib/"
cp -R "$ROOT/media/package.json" "$ROOT/media/src" "$ROOT/media/Dockerfile" "$ROOT/media/fly.toml" "$CTX/media/"
cd "$CTX"
fly deploy --config media/fly.toml --dockerfile media/Dockerfile --remote-only --ha=false "$@" .
