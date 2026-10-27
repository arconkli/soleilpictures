# Built by media/deploy.sh from a context laid out like the repo, holding only
# what is copied below (playCopy.js and fileView.js are shared with the Worker;
# zipRead.js and zipStore.js are the app's zip reader, which zipMain.js runs;
# archiveSheet.js is what an archive's card shows, from its names):
#   sh media/deploy.sh
FROM node:22-bookworm-slim

# vips makes the views of photos (HEIC, TIFF, JPEG XL, OpenEXR, JPEG 2000). Its
# ImageMagick, PDF and OpenSlide modules are removed: views never need them,
# and ImageMagick reads formats that follow references to other files.
# exiftool lifts the camera's own JPEG out of a raw file, and LibRaw
# (dcraw_emu) develops one that carries none big enough. LibreOffice (with no
# GUI and no Java) prints documents to PDF and poppler-utils draws a PDF's
# first page; bsdtar (libarchive-tools) lists what is inside tar, 7z, rar and the
# like; the fonts stand in for the ones documents name (Liberation for
# Arial, Times and Courier, Carlito for Calibri, Caladea for Cambria) and
# cover most scripts (Noto, Noto CJK). util-linux's unshare and setpriv, in
# the base image, run every decoder but ffmpeg with no network.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips-tools libimage-exiftool-perl libraw-bin ca-certificates \
       libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui poppler-utils libarchive-tools \
       fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /usr/lib/*/vips-modules-*/vips-magick.so /usr/lib/*/vips-modules-*/vips-poppler.so \
       /usr/lib/*/vips-modules-*/vips-openslide.so

# The unprivileged user every decoder runs as (MEDIA_UID/MEDIA_GID default to
# 10001). They parse strangers' files; they get no secrets and no rights.
RUN groupadd -g 10001 media \
  && useradd -r -u 10001 -g media -d /tmp -s /usr/sbin/nologin media

WORKDIR /app
COPY boards/src/lib/playCopy.js ./boards/src/lib/playCopy.js
COPY boards/src/lib/fileView.js ./boards/src/lib/fileView.js
COPY boards/src/lib/zipRead.js ./boards/src/lib/zipRead.js
COPY boards/src/lib/zipStore.js ./boards/src/lib/zipStore.js
COPY boards/src/lib/archiveSheet.js ./boards/src/lib/archiveSheet.js
COPY media/package.json ./media/package.json
COPY media/src ./media/src

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# The node process stays root ON PURPOSE: only root can spawn a decoder as
# another uid, or in a network namespace of its own (src/ffmpeg.js drops each
# child to MEDIA_UID). The node process holds the one secret; the decoders
# never see it.
CMD ["node", "media/src/index.js"]
