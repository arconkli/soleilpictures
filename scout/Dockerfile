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
COPY scout/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# The shared ingest core. Only the two directories Scout actually imports, so a
# change to the React app doesn't bust this layer.
COPY boards/src/lib        ./boards/src/lib
COPY boards/src/worker-llm.js ./boards/src/worker-llm.js
COPY boards/scripts/lib    ./boards/scripts/lib

COPY scout/src ./scout/src

ENV NODE_ENV=production
CMD ["node", "scout/src/index.js"]
