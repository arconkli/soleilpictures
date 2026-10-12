#!/usr/bin/env bash
# Tiny video fixtures for lib/mediaProbe.test.mjs and the film player e2e
# tests. Committed (a few KB each) so neither test needs ffmpeg; this script
# documents exactly how they were made. Re-run from boards/:
#   bash scripts/make-media-fixtures.sh
set -euo pipefail
OUT=tests/fixtures/media
mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"

# 24 fps H.264 + AAC stereo, moov first (faststart): the common web upload.
$FF -f lavfi -i "testsrc2=s=64x36:r=24:d=2" -f lavfi -i "sine=f=440:r=48000:d=2" \
  -ac 2 -c:v libx264 -preset veryfast -pix_fmt yuv420p -profile:v high -c:a aac -b:a 32k \
  -movflags +faststart "$OUT/faststart-24.mp4"

# 23.976 fps H.264, moov at the END (a camera or editor that never ran faststart).
$FF -f lavfi -i "testsrc2=s=64x36:r=24000/1001:d=1" -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  "$OUT/moovend-2398.mp4"

# 29.97 drop-frame ProRes 422 HQ in MOV, with a timecode track starting 01:00:00;00 and PCM audio.
$FF -f lavfi -i "testsrc2=s=32x18:r=30000/1001:d=0.4" -f lavfi -i "sine=f=440:r=48000:d=0.4" \
  -c:v prores_ks -profile:v 3 -c:a pcm_s16le -timecode "01:00:00;00" "$OUT/df2997-tc.mov"

# Variable frame rate: the first 20 frames of a 30 fps source, then every third.
$FF -f lavfi -i "testsrc2=s=64x36:r=30:d=2" -vf "select='lt(n\,20)+not(mod(n\,3))'" \
  -fps_mode vfr -c:v libx264 -preset veryfast -pix_fmt yuv420p "$OUT/vfr.mp4"

# Frame N is a flat grey of luma 16+3N: the player's frame-accuracy test reads
# a pixel and knows exactly which frame is on screen. VP9 (lossless) in MP4,
# because Playwright's bundled Chromium has no H.264 decoder. 24 fps, 48 frames.
$FF -f lavfi -i "color=c=black:s=64x36:r=24:d=2" -vf "format=yuv420p,geq=lum='16+3*N':cb=128:cr=128" \
  -c:v libvpx-vp9 -lossless 1 -row-mt 1 -an "$OUT/frames-vp9.mp4"

ls -l "$OUT"
