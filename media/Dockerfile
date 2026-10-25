# Built by media/deploy.sh from a context laid out like the repo, holding only
# what is copied below (playCopy.js is shared with the Worker):
#   sh media/deploy.sh
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The unprivileged user ffmpeg and ffprobe run as (MEDIA_UID/MEDIA_GID default
# to 10001). They parse strangers' files; they get no secrets and no rights.
RUN groupadd -g 10001 media \
  && useradd -r -u 10001 -g media -d /tmp -s /usr/sbin/nologin media

WORKDIR /app
COPY boards/src/lib/playCopy.js ./boards/src/lib/playCopy.js
COPY media/package.json ./media/package.json
COPY media/src ./media/src

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# The node process stays root ON PURPOSE: only root can spawn ffmpeg as another
# uid (src/ffmpeg.js drops each child to MEDIA_UID). The node process holds the
# one secret; the decoders never see it.
CMD ["node", "media/src/index.js"]
