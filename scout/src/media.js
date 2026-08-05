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
import { makeR2 } from '../../boards/scripts/lib/r2.mjs';
import { scoutInsert } from '../../boards/src/lib/scoutDb.js';

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

// Upload one attachment and register it. The images row carries
// referenced_in_board_ids FROM BIRTH so the R2 orphan sweep can never treat it
// as garbage, even if a later step in the pipeline fails.
export async function uploadImage(cfg, r2, {
  bytes, mimeType, name, workspaceId, boardId, cardId, userId,
}) {
  const norm = await normalizeImage(bytes, mimeType, name);
  const { width, height } = imageSize(norm.bytes);
  const key = `${workspaceId}/${crypto.randomUUID()}.${norm.ext}`;

  await r2.put(key, norm.bytes, norm.mimeType);

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
  }]);

  return { key, width, height, mimeType: norm.mimeType };
}
