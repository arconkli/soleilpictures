// Camera raws: the picture the camera made of the shot, which a raw file keeps
// as a JPEG beside the sensor data (Sony's .arw, Canon's .cr2 and .cr3,
// Nikon's .nef, Fujifilm's .raf, a phone's .dng, ...). exiftool lifts the
// biggest one out and gives it the raw's orientation; a file whose biggest is
// under RAW_MIN_EDGE on its long side, or that carries none, is developed from
// the sensor data by LibRaw instead, at half size. Both run as the unprivileged
// user, with a bare environment and no network, on the local copy, like vips.

import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { run, isRoot, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';

// Below this, a camera's own JPEG makes too small a view to stand for the shot.
export const RAW_MIN_EDGE = 1024;
const EXIF_TIMEOUT_MS = 60_000;
const DEVELOP_TIMEOUT_MS = 5 * 60_000;
// The tags raw files keep their JPEGs in. Which is biggest depends on the
// camera: a full-size JpgFromRaw (Nikon, Panasonic), a PreviewImage (Sony,
// Fujifilm, a DNG), an OtherImage; the thumbnail is the last resort.
export const PREVIEW_TAGS = Object.freeze(['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage']);
const BINARY_RE = /^\(Binary data (\d+) bytes/;

// What exiftool says about a raw (its -json -n output, one file's object):
// the tag of its biggest embedded image by bytes, or null.
export function biggestPreview(info) {
  let best = null;
  let bytes = 0;
  for (const tag of PREVIEW_TAGS) {
    const m = typeof info?.[tag] === 'string' ? BINARY_RE.exec(info[tag]) : null;
    if (m && Number(m[1]) > bytes) {
      best = tag;
      bytes = Number(m[1]);
    }
  }
  return best;
}

// The raw's orientation (EXIF, 1-8), or null.
export function orientationOf(info) {
  const o = Number(info?.Orientation);
  return Number.isInteger(o) && o >= 1 && o <= 8 ? o : null;
}

// The shot's size as the raw stores it (not yet upright), or null.
export function rawSize(info) {
  const m = /^(\d{1,6})[ x](\d{1,6})$/.exec(String(info?.ImageSize || ''));
  const w = m ? Number(m[1]) : 0;
  const h = m ? Number(m[2]) : 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

// The arguments: what exiftool says of a raw, one embedded image out to
// stdout, and an orientation written onto the image lifted out.
export const infoArgs = (src) => ['-json', '-n', '-q', '-q', ...PREVIEW_TAGS.map((t) => `-${t}`), '-Orientation', '-ImageSize', src];
export const extractArgs = (src, tag) => ['-b', '-q', '-q', `-${tag}`, src];
export const orientArgs = (jpg, o) => ['-q', '-q', '-n', '-m', '-overwrite_original', `-Orientation=${o}`, jpg];
// LibRaw, half size, the camera's white balance, sRGB, as an 8-bit TIFF beside
// the source, named for it (source.arw → source.tiff). It turns the picture
// upright itself.
export const developArgs = (src) => ['-h', '-w', '-o', '1', '-T', '-Z', 'tiff', src];
export const developedPath = (src) => `${src.replace(/\.[A-Za-z0-9]{1,8}$/, '')}.tiff`;

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// The local raw `src` as a picture vips can read, in `dir` (which the
// unprivileged user owns): { path, loader, original, via }. `sizeOf(path,
// loader)` reads a picture's size with vips. Throws a Refused-like error
// (`reason`) when there is nothing to show.
export async function rawPicture(src, dir, { sizeOf, refuse }) {
  let info = {};
  try {
    const out = await run('exiftool', infoArgs(src), { timeoutMs: EXIF_TIMEOUT_MS, isolate: true });
    info = JSON.parse(out.toString())?.[0] || {};
  } catch (_) { /* LibRaw may still read it */ }
  const original = rawSize(info);

  let embedded = null;
  const tag = biggestPreview(info);
  if (tag) {
    const bytes = await run('exiftool', extractArgs(src, tag), { timeoutMs: EXIF_TIMEOUT_MS, isolate: true }).catch(() => null);
    if (bytes && isJpeg(bytes)) {
      // A new file (never through anything left in its place), handed to the
      // unprivileged user by its handle: exiftool writes the orientation in.
      const path = join(dir, 'embedded.jpg');
      const fh = await open(path, 'wx', 0o644);
      try {
        await fh.writeFile(bytes);
        if (isRoot()) await fh.chown(MEDIA_UID, MEDIA_GID);
      } finally {
        await fh.close();
      }
      const o = orientationOf(info);
      if (o) await run('exiftool', orientArgs(path, o), { timeoutMs: EXIF_TIMEOUT_MS, isolate: true });
      const size = await sizeOf(path, 'jpegload').catch(() => null);
      if (size) embedded = { path, loader: 'jpegload', original, via: 'embedded', edge: Math.max(size.w, size.h) };
    }
  }
  if (embedded && embedded.edge >= RAW_MIN_EDGE) return embedded;

  // Too small, or nothing: develop the sensor data.
  try {
    await run('dcraw_emu', developArgs(src), { timeoutMs: DEVELOP_TIMEOUT_MS, isolate: true });
    const path = developedPath(src);
    await stat(path);
    const size = await sizeOf(path, 'tiffload');
    if (!embedded || Math.max(size.w, size.h) > embedded.edge) return { path, loader: 'tiffload', original, via: 'libraw' };
  } catch (e) {
    if (!embedded) throw refuse('unsupported', `no picture in this raw (${String(e?.message || '').slice(0, 120)})`);
  }
  return embedded;
}
