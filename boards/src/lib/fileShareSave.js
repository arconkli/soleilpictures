// Pure core of the party Worker's POST /parties/upload/<workspace>/file-save
// ("Save a copy" on a file shared with you). get_file_share (SQL), run as the
// caller, decides whether they may open and download it; this decides whether
// it can be saved, how R2 copies the bytes (one CopyObject, or a multipart
// copy above the single-copy ceiling), the new keys, and the card the copy
// becomes. The copy belongs to the caller's workspace and counts toward its
// owner's storage, like an upload.

import { docDropSize, extOfKey } from './fileView.js';

// R2's CopyObject takes objects up to 5 GiB; stay under it, and copy anything
// bigger in parts with UploadPartCopy.
export const SINGLE_COPY_MAX_BYTES = 5 * 1024 ** 3 - 1024 ** 2;
export const COPY_PART_BYTES = 1024 ** 3;

const SAVEABLE = new Set(['image', 'video', 'audio', 'pdf', 'file']);
const ID_PREFIX = { image: 'img', video: 'vid', audio: 'aud', pdf: 'pdf', file: 'file' };
// The canvas's own new-card sizes (FALLBACK_DIMS in lib/fileIngest.js; a test
// keeps the two equal).
export const SAVED_CARD_DIMS = {
  image: { w: 320, h: 240 },
  pdf: { w: 300, h: 388 },
  video: { w: 360, h: 202 },
  audio: { w: 380, h: 130 },
  file: { w: 240, h: 150 },
};

// Why a get_file_share answer can't be saved, or null when it can.
export function saveRefusal(result) {
  if (!result || typeof result !== 'object') return 'gone';
  if (result.status === 'sign_in') return 'sign_in';
  if (result.status === 'no_access') return 'no_access';
  if (result.status !== 'ok' || !result.file) return 'gone';
  if (!SAVEABLE.has(result.file.kind)) return 'not_saveable';
  if (result.allow_download !== true) return 'no_download';
  if (!result.keys || typeof result.keys.src !== 'string' || !result.keys.src) return 'gone';
  return null;
}

// How to copy `totalBytes`: { mode: 'single' } or { mode: 'multipart', parts }
// with inclusive byte ranges, or null when there is nothing to copy.
export function copyPlan(totalBytes, { singleMax = SINGLE_COPY_MAX_BYTES, partBytes = COPY_PART_BYTES } = {}) {
  const n = Math.floor(Number(totalBytes) || 0);
  if (!(n > 0)) return null;
  if (n <= singleMax) return { mode: 'single', bytes: n };
  const parts = [];
  for (let start = 0, partNumber = 1; start < n; start += partBytes, partNumber += 1) {
    parts.push({ partNumber, start, end: Math.min(n, start + partBytes) - 1 });
  }
  return { mode: 'multipart', bytes: n, parts };
}

// `<workspace>/<uuid>.<ext>`: the shape every upload key has (the party's
// isValidUploadKey), with the source key's extension.
export function copyKey(workspaceId, sourceKey, uuid) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(sourceKey || ''));
  const ext = m ? m[1].toLowerCase() : 'bin';
  return `${workspaceId}/${uuid}.${ext}`;
}

// An id in the canvas's own style (vid-<ms>-<n>).
export function savedCardId(kind, now = Date.now(), rand = Math.random()) {
  return `${ID_PREFIX[kind] || 'file'}-${now}-${Math.floor(rand * 1e6)}`;
}

// The card a saved copy becomes, in the shape the canvas makes for the same
// upload. No x/y: the append route stores it off the board, where uploads to a
// closed cluster go. `src`/`poster` are the NEW keys.
export function savedCard(result, { cardId, srcKey, posterKey = null }) {
  const f = result.file || {};
  const kind = f.kind;
  const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : null;
  // A saved document lands at its family's size, as a dropped one does.
  const dims = (kind === 'file' && docDropSize(extOfKey(srcKey))) || SAVED_CARD_DIMS[kind] || SAVED_CARD_DIMS.file;
  const size = Number.isFinite(Number(f.size)) && Number(f.size) > 0 ? Math.floor(Number(f.size)) : null;
  const mime = typeof f.mime === 'string' && f.mime ? f.mime : null;
  const ref = (k) => (k ? `r2:${k}` : null);
  const card = { id: cardId, kind, w: dims.w, h: dims.h };
  if (kind === 'image') {
    Object.assign(card, { src: ref(srcKey) }, name ? { fileName: name } : null);
  } else if (kind === 'video') {
    Object.assign(card, { src: ref(srcKey), sizeBytes: size, mime },
      posterKey ? { poster: ref(posterKey) } : null,
      name ? { fileName: name } : null,
      Number.isFinite(Number(f.duration)) && Number(f.duration) > 0 ? { duration: Number(f.duration) } : null);
  } else if (kind === 'audio') {
    Object.assign(card, { src: ref(srcKey), title: name || 'Audio', fileName: name, mime, sizeBytes: size, ext: f.ext || null },
      Number.isFinite(Number(f.duration)) && Number(f.duration) > 0 ? { duration: Number(f.duration) } : null);
  } else if (kind === 'pdf') {
    // The PDF's own file is pdfSrc; src is its page-one picture.
    Object.assign(card, { pdfSrc: ref(srcKey), src: ref(posterKey), name: name || 'PDF' },
      Number.isInteger(Number(f.page_count)) && Number(f.page_count) > 0 ? { pageCount: Number(f.page_count) } : null);
  } else {
    Object.assign(card, { kind: 'file', fileSrc: ref(srcKey), fileName: name || 'File', mime, sizeBytes: size, ext: f.ext || null });
  }
  return card;
}

// The images row for a copied object, in the shape uploads.js inserts.
export function savedImageRow({ workspaceId, boardId, cardId, key, bytes, userId, originalName }) {
  return {
    workspace_id: workspaceId,
    board_id: boardId || null,
    card_id: cardId || null,
    storage_path: key,
    size_bytes: Number.isFinite(Number(bytes)) && Number(bytes) > 0 ? Math.floor(Number(bytes)) : null,
    uploaded_by: userId,
    original_name: originalName || null,
  };
}

// What the client shows for each refusal (the route's `reason`).
export const SAVE_REFUSAL_STATUS = {
  sign_in: 401, no_access: 403, gone: 404, not_saveable: 422, no_download: 403,
  not_writer: 403, over_quota: 402, wrong_workspace: 400,
};
