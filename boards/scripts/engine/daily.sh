#!/bin/zsh
# daily.sh — the boards engine's 06:00 run (launchd: com.soleil.boards-engine,
# installed by install.mjs). Runs from its own checkout, moved to the newest
# main first, so each board is shot in the app as it is on main that morning.
# A checkout with local changes is left where it is and runs as it stands.
#
#   ENGINE_REPO   the checkout (default ~/soleil-engine)
#   ENGINE_ARGS   what to run (default --daily)

set -eu
REPO="${ENGINE_REPO:-$HOME/soleil-engine}"
cd "$REPO"
echo "── $(date '+%Y-%m-%d %H:%M:%S') boards engine"

if git fetch -q origin main && [ -z "$(git status --porcelain)" ]; then
  lock_before=$(git rev-parse HEAD:boards/package-lock.json 2>/dev/null || echo none)
  git checkout -q --detach origin/main
  lock_after=$(git rev-parse HEAD:boards/package-lock.json)
  cd boards
  if [ "$lock_before" != "$lock_after" ] || [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund --cache "${TMPDIR:-/tmp}/boards-engine-npm"
  fi
else
  echo "checkout not moved (no network, or local changes)"
  cd boards
fi
echo "at $(git rev-parse --short HEAD)"

exec node scripts/engine/run.mjs ${=ENGINE_ARGS:---daily}
