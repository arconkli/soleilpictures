# Soleil Scout ingest service.
#
# Debian-based (not Alpine) on purpose: heif2jpeg ships prebuilt native binaries
# built against glibc, and musl would force a source build of libheif/libde265.
FROM node:22-slim

WORKDIR /app

# fonts-dejavu-core is NOT optional. The contact sheets Scout texts back draw
# their group labels ("TODAY · 6", "3 DAYS AGO · 14") by compositing an SVG,
# which sharp renders through librsvg → fontconfig. node:22-slim ships zero
# fonts, and with none installed the text renders BLANK — silently, with no
# error — leaving an unlabelled grid that defeats the whole point of showing the
# groups. ~1MB.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Dependencies are installed ONCE at the image root. Node resolves bare
# specifiers by walking UP from the importing file, so /app/node_modules serves
# both /app/scout/src/* and the shared modules under /app/boards/* — no
# workspace config, no duplicated installs, no symlink games.
# `npm ci` against a committed lockfile, NOT `npm install`. The provider SDK's
# surface is version-specific — v12.7.0 exports `attachment` and reaches
# space-creation through `imessage(app).space.create`, and this code is written
# against exactly that. A floating install could resolve a later minor whose
# shape differs, and the failure mode is the process dying at import time with
# "does not provide an export named …", which no test here would catch.
COPY scout/package.json scout/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# The shared ingest core. Only what Scout actually imports, so a change to the
# React app doesn't bust this layer.
#
# KEEP THIS LIST IN STEP WITH THE IMPORTS. It is not a directory copy, so a new
# `../../boards/...` import in scout/src that is not listed here fails at
# STARTUP with ERR_MODULE_NOT_FOUND — the container never serves a request, and
# nothing catches it before deploy. To check:
#   grep -rhoE "\.\./\.\./boards/[A-Za-z0-9_/.-]+" scout/src/*.js | sort -u
COPY boards/src/lib        ./boards/src/lib
COPY boards/src/worker-llm.js ./boards/src/worker-llm.js
# The session-link signer. pipeline.js mints instant-session tokens in-process
# rather than over HTTP, because this file uses only fetch + WebCrypto + base64
# and therefore runs unchanged in Node — so the Worker and the bot share one
# implementation of the thing that must not go wrong.
COPY boards/src/worker-scout.js ./boards/src/worker-scout.js
COPY boards/scripts/lib    ./boards/scripts/lib

COPY scout/src ./scout/src

ENV NODE_ENV=production
CMD ["node", "scout/src/index.js"]
