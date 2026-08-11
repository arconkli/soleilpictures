// Scout — inbound media → bytes in R2 and a row that authorizes them.
//
// Four things happen here that the browser upload path gets for free:
//
//  1. HEIC conversion. iPhones send HEIC, and Chrome and Firefox CANNOT render
//     it — only Safari can. An unconverted HEIC card is a broken card for most
//     viewers, and testing on a Mac in Safari will hide that from you.
//     (ffmpeg.js does the same job for HEVC video, for exactly the same reason.)
//  2. Dimension probing. Card sizing needs width/height, and there's no
//     <img> to ask. We parse the header bytes directly rather than pulling in
//     an image library for two numbers.
//  3. Duration and poster frames, which uploads.js reads off a <video> element.
//  4. EXIF. `.rotate()` has always consumed the orientation tag and thrown the
//     rest away — including where and when the photo was taken, which for a
//     LOCATION SCOUTING product is arguably its most valuable field.
//
// ROUTING IS NOT DECIDED HERE. classifyDropFile (lib/fileIngest.js) is the app's
// own single source of truth for "what does this file become", shared by the
// canvas drop path and the list drop path precisely so they cannot drift. Scout
// is a third ingest surface and calls the same function, so a .mov texted to the
// bot and a .mov dragged onto the canvas can never disagree about what it is.

import { heifToJpeg } from 'heif2jpeg';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { rgbaToThumbHash } from 'thumbhash';
import { makeR2 } from '../../boards/scripts/lib/r2.mjs';
import { scoutInsert } from '../../boards/src/lib/scoutDb.js';
import { averageColor } from '../../boards/src/lib/oklab.js';
import { classifyDropFile } from '../../boards/src/lib/fileIngest.js';
import { probeMedia, posterFrame, transcodeToH264, needsTranscode } from './ffmpeg.js';

// Keep in lockstep with src/lib/uploads.js (the browser upload path) — a scout
// photo and a dragged photo should produce the same tiers.
const PREVIEW_LONGEST_EDGE = 1280;
const PREVIEW_SM_LONGEST_EDGE = 640;
const PREVIEW_QUALITY = 72;
// ThumbHash's encoder is specified for inputs up to 100×100.
const HASH_EDGE = 96;
// Average colour is computed from an 8×8 reduction: big enough that a single
// bright window doesn't dominate, small enough that it's free.
const COLOR_EDGE = 8;

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function makeUploader(cfg) {
  const r2 = makeR2({
    accountId: cfg.R2_ACCOUNT_ID,
    bucket: cfg.R2_BUCKET,
    accessKeyId: cfg.R2_ACCESS_KEY_ID,
    secretAccessKey: cfg.R2_SECRET_ACCESS_KEY,
  });
  return r2;
}

export function isImage(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  return m.startsWith('image/');
}

// What this attachment becomes, decided by the app's own router.
//
// classifyDropFile takes a browser File; it reads exactly three properties, so
// a duck-typed object is a faithful caller rather than a hack. Passing the real
// shape matters for one case in particular: iOS reports HEIC with an EMPTY mime
// type through some pickers, and the router falls back to the extension — which
// only works if we hand it the filename too.
//
// `canAttemptFiles` is the free-tier gate. Per fileIngest.js, video ≤30MB,
// audio ≤50MB and PDF ≤50MB are FREE and return before the gate is consulted;
// only oversize media and arbitrary file types are the paid "upload anything"
// feature. Scout's own copy used to claim all video and audio were paid, which
// was simply wrong.
export function classifyAttachment(att, { canAttemptFiles = true } = {}) {
  return classifyDropFile(
    { type: att?.mimeType || '', name: att?.name || '', size: att?.bytes?.length || att?.size || 0 },
    { canAttemptFiles },
  );
}

// ── EXIF ─────────────────────────────────────────────────────────────────────
//
// Capture time and coordinates, which travel ON THE CARD as flat fields for the
// same reason `lab` does (scoutCards.js:99): cards are schema-free objects, so
// this costs ~40 bytes, needs no migration, and survives a move between boards.
//
// Whether iMessage preserves EXIF at all is unverified — iOS strips location
// from some share paths. Everything here is therefore optional by construction:
// a photo with no EXIF, or EXIF we cannot parse, yields nulls and is otherwise
// completely normal.

// EXIF stores coordinates as [degrees, minutes, seconds] with a separate N/S/E/W
// reference. Without applying the reference, every southern and western
// coordinate comes out mirrored onto the wrong hemisphere — which is worse than
// no coordinate, because it looks plausible.
function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 2) return null;
  const [d, m = 0, s = 0] = dms.map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  const sign = /^[SW]$/i.test(String(ref || '')) ? -1 : 1;
  // 5 decimal places is about a metre. More is false precision, and it is
  // someone's location — rounding is the polite default.
  return Math.round(sign * (d + m / 60 + s / 3600) * 1e5) / 1e5;
}

export function readExif(exifBuffer) {
  if (!exifBuffer?.length) return { shotAt: null, geo: null };
  let tags;
  try {
    tags = exifReader(exifBuffer);
  } catch (_) {
    return { shotAt: null, geo: null };   // malformed EXIF is not a broken photo
  }

  let shotAt = null;
  const raw = tags?.Photo?.DateTimeOriginal || tags?.Image?.DateTime;
  if (raw) {
    const d = raw instanceof Date ? raw : new Date(String(raw).replace(/^(\d{4}):(\d{2}):/, '$1-$2-'));
    // Guard the epoch: a camera with a dead clock stamps 1970 (or 1904), and a
    // capture date decades before the product existed is noise, not data.
    if (!Number.isNaN(d?.getTime?.()) && d.getFullYear() > 1990) shotAt = d.toISOString();
  }

  const g = tags?.GPSInfo;
  const lat = dmsToDecimal(g?.GPSLatitude, g?.GPSLatitudeRef);
  const lon = dmsToDecimal(g?.GPSLongitude, g?.GPSLongitudeRef);
  // (0,0) is in the Atlantic and is what a GPS with no fix writes. Nobody
  // scouts there.
  const geo = lat != null && lon != null && (lat !== 0 || lon !== 0) ? [lat, lon] : null;

  return { shotAt, geo };
}

// Convert HEIC/HEIF to JPEG. Anything else passes through untouched — we do NOT
// re-encode JPEGs, because a scout photo re-compressed for no reason is a
// quality loss the user can see and we gain nothing.
export async function normalizeImage(bytes, mimeType, name) {
  const m = String(mimeType || '').toLowerCase();
  if (!HEIC_TYPES.has(m) && !/\.hei[cf]$/i.test(name || '')) {
    return { bytes, mimeType: m || 'application/octet-stream', ext: extFor(m, name) };
  }
  const jpeg = await heifToJpeg(Buffer.from(bytes), { quality: 88 });
  return { bytes: jpeg, mimeType: 'image/jpeg', ext: 'jpg' };
}

function extFor(mime, name) {
  const fromName = String(name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif',
  };
  return map[String(mime || '').toLowerCase()] || 'bin';
}

// Intrinsic dimensions from header bytes. Covers the formats that actually
// arrive from a phone. Returns nulls rather than guessing — imageCardSize()
// has a sane default for unknown dimensions.
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    // PNG: IHDR width/height at fixed offsets.
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    // GIF: little-endian at offset 6.
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    }
    // JPEG: walk the segment chain to the SOFn frame header.
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        const len = (b[i + 2] << 8) | b[i + 3];
        if (len <= 0) break;
        i += 2 + len;
      }
    }
    // WebP (VP8X / VP8L / VP8 ).
    if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
      const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fmt === 'VP8X') {
        return {
          width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
          height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        };
      }
      if (fmt === 'VP8 ') return { width: ((b[26] | (b[27] << 8)) & 0x3fff), height: ((b[28] | (b[29] << 8)) & 0x3fff) };
    }
  } catch (_) { /* fall through to unknown */ }
  return { width: null, height: null };
}

// One decode, four outputs.
//
// Scout previously wrote the raw original and nothing else, which meant a board
// full of texted photos made the canvas download every multi-megabyte original —
// exactly the problem migration 0105 exists to prevent. The browser upload path
// generates a ThumbHash and two WebP tiers; this brings parity, and since we're
// decoding anyway the moodboard's average colour comes out of the same pass.
//
// .rotate() FIRST and everywhere: iPhone photos carry EXIF orientation, so the
// stored dimensions of a portrait frame are landscape until it's applied. Get
// this wrong and every portrait photo gets a landscape card, which the moodboard
// layout then packs into a column of wrongly-shaped holes.
//
// THE DIMENSIONS COME FROM autoOrient, NOT FROM meta.width/height. This file
// already carried the warning above and then walked straight into it:
// `sharp(bytes).rotate().metadata()` reports the dimensions of the INPUT, not of
// the rotated output. Verified against sharp 0.34 — a 200×100 JPEG tagged
// orientation 6 reports 200×100 from metadata() while the encoded output really
// is 100×200. So every portrait iPhone photo has been getting a landscape card,
// landscape `images.width/height`, and a wrongly-shaped hole in the moodboard,
// exactly as predicted.
//
// `meta.autoOrient` is sharp's own answer to this question. The orientation-tag
// fallback covers an older sharp that does not expose it: tags 5–8 are the ones
// that transpose the axes.
export function orientedSize(meta) {
  if (meta?.autoOrient?.width && meta?.autoOrient?.height) {
    return { width: meta.autoOrient.width, height: meta.autoOrient.height };
  }
  const swap = meta?.orientation >= 5 && meta?.orientation <= 8;
  return {
    width: (swap ? meta?.height : meta?.width) ?? null,
    height: (swap ? meta?.width : meta?.height) ?? null,
  };
}

async function analyzeImage(bytes) {
  const base = sharp(Buffer.from(bytes), { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const { width, height } = orientedSize(meta);

  const [colorRaw, hashRaw, preview, previewSm] = await Promise.all([
    base.clone().resize(COLOR_EDGE, COLOR_EDGE, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    base.clone().resize(HASH_EDGE, HASH_EDGE, { fit: 'inside' }).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true }),
    encodePreview(base, PREVIEW_LONGEST_EDGE),
    encodePreview(base, PREVIEW_SM_LONGEST_EDGE),
  ]);

  let thumbhash = null;
  try {
    const { data, info } = hashRaw;
    thumbhash = Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
  } catch (_) { /* a blur placeholder is a nicety, never a reason to drop a photo */ }

  return {
    width,
    height,
    lab: averageColor(colorRaw, 3),
    thumbhash,
    preview,
    previewSm,
    // Read from the SOURCE metadata, before .rotate() consumed the orientation
    // tag — every other EXIF field survives that call untouched.
    ...readExif(meta.exif),
  };
}

async function encodePreview(base, edge) {
  try {
    const out = await base.clone()
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: out.data, w: out.info.width, h: out.info.height };
  } catch (_) {
    return null;
  }
}

// Upload one attachment and register it. The images row carries
// referenced_in_board_ids FROM BIRTH so the R2 orphan sweep can never treat it
// as garbage, even if a later step in the pipeline fails.
export async function uploadImage(cfg, r2, {
  bytes, mimeType, name, workspaceId, boardId, cardId, userId,
}) {
  const norm = await normalizeImage(bytes, mimeType, name);

  // Every derived artifact is optional. A photo that sharp can't decode still
  // gets stored and still becomes a card — it just loads slower and sorts to
  // the end of the moodboard.
  let info = null;
  try {
    info = await analyzeImage(norm.bytes);
  } catch (e) {
    console.error('[scout] image analyze failed', e?.message);
  }
  const { width, height } = info?.width ? info : imageSize(norm.bytes);

  const uuid = crypto.randomUUID();
  const key = `${workspaceId}/${uuid}.${norm.ext}`;
  const previewKey = info?.preview ? `${workspaceId}/previews/${uuid}.webp` : null;
  const previewSmKey = info?.previewSm ? `${workspaceId}/previews/${uuid}-sm.webp` : null;

  // R2 PUTs strictly BEFORE the DB stamps, so a crash can never leave a row
  // pointing at a missing object (same ordering as backfill-image-variants.mjs).
  await r2.put(key, norm.bytes, norm.mimeType);
  if (previewKey) await r2.put(previewKey, info.preview.bytes, 'image/webp');
  if (previewSmKey) await r2.put(previewSmKey, info.previewSm.bytes, 'image/webp');

  // /sign-reads only issues URLs for keys that have an images row, so a failure
  // here means an unviewable card. Let it throw.
  await scoutInsert(cfg, 'images', [{
    workspace_id: workspaceId,
    board_id: boardId,
    card_id: cardId,
    storage_path: key,
    width,
    height,
    size_bytes: norm.bytes.length ?? norm.bytes.byteLength ?? null,
    uploaded_by: userId,
    referenced_in_board_ids: [boardId],
    blur_hash: info?.thumbhash || null,
    preview_path: previewKey,
    preview_w: info?.preview?.w ?? null,
    preview_h: info?.preview?.h ?? null,
  }]);

  // Preview rows exist so /sign-reads will authorize the preview keys. They are
  // never referenced by a card, so ref_count stays 0 — without the retention
  // lock the daily R2 orphan sweep collects them after 30 days and every scout
  // photo silently loses its fast tier.
  const previewRows = [
    previewKey && { path: previewKey, w: info.preview.w, h: info.preview.h },
    previewSmKey && { path: previewSmKey, w: info.previewSm.w, h: info.previewSm.h },
  ].filter(Boolean).map((p) => ({
    workspace_id: workspaceId,
    board_id: boardId,
    storage_path: p.path,
    width: p.w,
    height: p.h,
    uploaded_by: userId,
    retention_locked_until: '2999-01-01T00:00:00Z',
  }));
  if (previewRows.length) {
    await scoutInsert(cfg, 'images', previewRows, { onConflict: 'storage_path' }).catch((e) => {
      console.error('[scout] preview row insert failed', e?.message);
    });
  }

  return {
    key,
    width,
    height,
    mimeType: norm.mimeType,
    lab: info?.lab || null,
    shotAt: info?.shotAt || null,
    geo: info?.geo || null,
  };
}

// ── Everything that is not a photo ───────────────────────────────────────────
//
// The `images` table is the universal object registry, not an image table. The
// browser path inserts a row there for video (uploads.js:838), audio (:691) and
// PDF (:768) alike, for one reason: /sign-reads only issues a signed URL for a
// key that HAS a row, so an object with no row is an object nobody can open.
//
// Scout additionally stamps referenced_in_board_ids AT BIRTH, as it always has
// for photos. The board_state trigger would populate it a moment later anyway
// (recompute_image_refs scans the decoded doc for `r2:` keys regardless of which
// field they sit in, so a video `src` and a `pdfSrc` are covered by the same
// mechanism) — but "a moment later" is only true if every later step succeeds,
// and the cost of being wrong is the sweep deleting the user's file 30 days on,
// invisibly.
async function putObject(cfg, r2, {
  bytes, mimeType, key, workspaceId, boardId, cardId, userId, width = null, height = null,
}) {
  await r2.put(key, bytes, mimeType || 'application/octet-stream');
  await scoutInsert(cfg, 'images', [{
    workspace_id: workspaceId,
    board_id: boardId,
    card_id: cardId,
    storage_path: key,
    width,
    height,
    size_bytes: bytes.length ?? bytes.byteLength ?? null,
    uploaded_by: userId,
    referenced_in_board_ids: [boardId],
  }]);
  return key;
}

function objectKey(workspaceId, uuid, mimeType, name) {
  return `${workspaceId}/${uuid}.${extFor(mimeType, name)}`;
}

/**
 * Upload one attachment of ANY kind and return what the card needs.
 *
 * `kind` comes from classifyAttachment — i.e. from the app's own router — so
 * the caller never decides what a file is. (The router's `route` is the
 * caller's business, not this function's: it decides whether the paid gate
 * applies, which has to happen before any bytes are spent.)
 *
 * Returns { kind, key, src, ...per-kind fields }. Throws only when the object
 * itself could not be stored; every derived artifact (poster, preview, colour,
 * duration) is optional and its absence degrades the card rather than losing it.
 */
export async function uploadObject(cfg, r2, {
  bytes, mimeType, name, kind, workspaceId, boardId, cardId, userId, onStage = null,
}) {
  if (kind === 'image') {
    const up = await uploadImage(cfg, r2, {
      bytes, mimeType, name, workspaceId, boardId, cardId, userId,
    });
    return { kind: 'image', src: `r2:${up.key}`, ...up };
  }

  const uuid = crypto.randomUUID();

  if (kind === 'video') {
    const ext = extFor(mimeType, name);
    const probe = await probeMedia(bytes, ext);

    // The HEVC problem. See ffmpeg.js — an iPhone clip stored as-is is a black
    // rectangle in Chrome and Firefox, which is most of the people a board gets
    // shared with.
    let outBytes = bytes;
    let outMime = mimeType;
    let outName = name;
    if (needsTranscode(probe)) {
      await onStage?.('transcoding');
      const converted = await transcodeToH264(bytes, ext, probe);
      if (converted) {
        outBytes = converted;
        outMime = 'video/mp4';
        outName = 'clip.mp4';
      }
    }

    const key = objectKey(workspaceId, uuid, outMime, outName);
    await putObject(cfg, r2, {
      bytes: outBytes, mimeType: outMime, key, workspaceId, boardId, cardId, userId,
      width: probe?.width ?? null, height: probe?.height ?? null,
    });

    // A poster is what makes the card look like the shot rather than like a
    // black box, so it goes through the full image path — its own images row
    // (required for /sign-reads) plus the progressive tiers, exactly as the
    // browser does it.
    let poster = null;
    const frame = await posterFrame(outBytes, extFor(outMime, outName), probe?.duration);
    if (frame) {
      try {
        const up = await uploadImage(cfg, r2, {
          bytes: frame, mimeType: 'image/jpeg', name: 'poster.jpg',
          workspaceId, boardId, cardId: null, userId,
        });
        poster = `r2:${up.key}`;
      } catch (e) {
        console.error('[scout] poster upload failed (video still plays)', e?.message);
      }
    }

    return {
      kind: 'video',
      key,
      src: `r2:${key}`,
      poster,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      duration: probe?.duration ?? null,
      transcoded: outBytes !== bytes,
    };
  }

  if (kind === 'audio') {
    const probe = await probeMedia(bytes, extFor(mimeType, name));
    const key = objectKey(workspaceId, uuid, mimeType, name);
    await putObject(cfg, r2, { bytes, mimeType, key, workspaceId, boardId, cardId, userId });
    return { kind: 'audio', key, src: `r2:${key}`, duration: probe?.duration ?? null };
  }

  // PDF and everything else. No derived artifact: rendering page 1 needs a PDF
  // rasterizer, which the browser has (pdf.js) and this process does not. The
  // card works without one — it opens and downloads — so a page-1 thumbnail is
  // a future nicety, not a blocker, and shipping the file beats withholding it.
  const key = objectKey(workspaceId, uuid, mimeType, name);
  await putObject(cfg, r2, { bytes, mimeType, key, workspaceId, boardId, cardId, userId });
  return { kind, key, src: `r2:${key}`, name: name || null, mimeType: mimeType || null,
           size: bytes.length ?? bytes.byteLength ?? null };
}
