// Scout — inbound media → an image card's bytes in R2.
//
// Two things happen here that the browser upload path gets for free:
//
//  1. HEIC conversion. iPhones send HEIC, and Chrome and Firefox CANNOT render
//     it — only Safari can. An unconverted HEIC card is a broken card for most
//     viewers, and testing on a Mac in Safari will hide that from you.
//  2. Dimension probing. Card sizing needs width/height, and there's no
//     <img> to ask. We parse the header bytes directly rather than pulling in
//     an image library for two numbers.

import { heifToJpeg } from 'heif2jpeg';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { makeR2 } from '../../boards/scripts/lib/r2.mjs';
import { scoutInsert } from '../../boards/src/lib/scoutDb.js';
import { averageColor } from '../../boards/src/lib/oklab.js';

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
async function analyzeImage(bytes) {
  const base = sharp(Buffer.from(bytes), { failOn: 'none' }).rotate();
  const meta = await base.metadata();

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
    width: meta.width ?? null,
    height: meta.height ?? null,
    lab: averageColor(colorRaw, 3),
    thumbhash,
    preview,
    previewSm,
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

  return { key, width, height, mimeType: norm.mimeType, lab: info?.lab || null };
}
