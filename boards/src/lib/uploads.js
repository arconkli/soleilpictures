// Image uploads — direct-to-R2 via the upload party (Cloudflare R2,
// zero-egress, S3-compatible, PRIVATE bucket).
//
// Flow:
//   1. POST /parties/upload/<workspaceId>  → presigned PUT URL
//   2. PUT  uploadUrl   (browser → R2 directly, 5-min URL)
//   3. INSERT into `images` table for record-keeping (RLS allows
//      workspace members + can_write_board editor-shares)
//
// We return src as a sentinel `r2:<key>` rather than a raw URL —
// the renderer (R2Image / r2.js cache) presigns short-lived read URLs
// on demand. Cards never persist a leakable URL.

import { supabase } from './supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const PARTYKIT_PROTOCOL = PARTYKIT_HOST.startsWith('localhost') ? 'http' : 'https';

function readImageDims(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { res({ w: null, h: null }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}

async function presign({ workspaceId, boardId, file }) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
  const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/${encodeURIComponent(workspaceId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fileExt: ext,
      contentType: file.type || 'application/octet-stream',
      boardId: boardId || null,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Presign failed: ${res.status} ${msg}`);
  }
  return res.json();   // { uploadUrl, key }
}

// Presign a deterministic per-board thumbnail PUT URL. Unlike presign() this
// asks for a FIXED key (<ws>/thumbs/<boardId>.webp) so the board's preview
// overwrites in place rather than orphaning UUID-keyed objects. The upload
// party only honors thumbKey when it matches that canonical, board-scoped
// shape (and after a can_write_board check).
async function presignThumb({ workspaceId, boardId, thumbKey, contentType = 'image/webp' }) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/${encodeURIComponent(workspaceId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ boardId, thumbKey, contentType, fileExt: 'webp' }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Thumb presign failed: ${res.status} ${msg}`);
  }
  return res.json();   // { uploadUrl, key }
}

// XHR PUT with a real upload-progress callback. Browser fetch() doesn't
// expose progress for a request body, so we drop down to XHR for the
// PUT step. The presign + DB-insert steps still use fetch.
function putWithProgress(url, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || !onProgress) return;
      onProgress(ev.loaded / Math.max(1, ev.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(file);
  });
}

// Upload a File to R2 (via the upload party) and insert an `images`
// row. Returns { id, src, storagePath, width, height, key }.
//
//   src           = "r2:<key>"  — the value to store on the card
//   storagePath   = key         — same value, unprefixed
//
// Pass boardId so the inserted row gets stamped with which board the
// upload originated from. RLS uses board_id to extend image read
// access to per-board shares.
//
// `cardId` is optional but strongly recommended: it lets card_index
// recover meta.src from the images table when the Y.Doc → card_index
// sync misses the field (e.g. when the card was added BEFORE the
// upload completed, and no later edit triggered a re-sync). Without
// it, card_index has no way to link an image card to its R2 key.
//
// `onProgress(p)` (0..1) fires during the PUT step so callers can
// render a progress chip on the placeholder card.
export async function uploadImage({ file, workspaceId, boardId, cardId = null, userId, onProgress = null }) {
  if (!workspaceId) throw new Error('workspaceId required');

  const { uploadUrl, key } = await presign({ workspaceId, boardId, file });

  await putWithProgress(uploadUrl, file, { onProgress });

  const dims = await readImageDims(file);

  const { data: row, error: rowErr } = await supabase
    .from('images')
    .insert({
      workspace_id: workspaceId,
      board_id: boardId || null,
      card_id: cardId || null,
      storage_path: key,
      width: dims.w,
      height: dims.h,
      size_bytes: file.size || null,
      uploaded_by: userId,
    })
    .select('*')
    .single();
  if (rowErr) {
    // Bytes are uploaded; the row insert is bookkeeping only.
    console.warn('[uploads] images row insert failed', rowErr);
  }

  return {
    id: row?.id || null,
    src: `r2:${key}`,
    storagePath: key,
    key,
    width: dims.w,
    height: dims.h,
    // Back-compat: callers that referenced .publicUrl get the sentinel
    // too (so they don't crash if not yet updated).
    publicUrl: `r2:${key}`,
  };
}

// Upload a board preview WebP to R2 (deterministic per-board key, overwrite
// in place) and ensure an `images` row exists so /sign-reads authorizes the
// key. The images row is inserted once (ON CONFLICT DO NOTHING via the
// partial unique index on thumbs keys, migration 0090) — every regen just
// overwrites the R2 bytes; the row never changes, so no UPDATE RLS is needed.
// Returns { src, key } where src is the "r2:<key>" sentinel to stamp on the
// board row. Runs on the editing client (a workspace writer).
//
// retention_locked_until is set far in the future so the daily R2 orphan
// sweep (find_history_safe_orphan_images) never collects it: a thumbnail is
// never referenced by a card, so its ref_count stays 0 and it would
// otherwise become deletion-eligible after the 30-day grace period.
const THUMB_RETENTION_LOCK = '2999-01-01T00:00:00Z';
export async function uploadBoardThumbnail({ workspaceId, boardId, blob, userId = null }) {
  if (!workspaceId || !boardId) throw new Error('workspaceId + boardId required');
  if (!blob) throw new Error('blob required');
  const key = `${workspaceId}/thumbs/${boardId}.webp`;
  const { uploadUrl } = await presignThumb({ workspaceId, boardId, thumbKey: key, contentType: 'image/webp' });
  // putWithProgress reads .type for the Content-Type header; the WebP blob's
  // type is image/webp, matching the presigned signature.
  await putWithProgress(uploadUrl, blob, {});
  const { error } = await supabase
    .from('images')
    .upsert({
      workspace_id: workspaceId,
      board_id: boardId,
      storage_path: key,
      width: null,
      height: null,
      size_bytes: blob.size || null,
      uploaded_by: userId,
      retention_locked_until: THUMB_RETENTION_LOCK,
    }, { onConflict: 'storage_path', ignoreDuplicates: true });
  if (error) console.warn('[uploads] thumb images row upsert failed', error);
  return { src: `r2:${key}`, key };
}

// Read width/height/duration from a video File. Returns null fields if
// the metadata can't load — caller should treat that as "skip duration
// check" rather than fail.
export function readVideoMeta(file) {
  return new Promise((res) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const out = {
          w: v.videoWidth || null,
          h: v.videoHeight || null,
          duration: Number.isFinite(v.duration) ? v.duration : null,
        };
        URL.revokeObjectURL(url);
        res(out);
      };
      v.onerror = () => { URL.revokeObjectURL(url); res({ w: null, h: null, duration: null }); };
      v.src = url;
    } catch (_) {
      res({ w: null, h: null, duration: null });
    }
  });
}

// Read duration from an audio File. Returns null if metadata fails.
export function readAudioMeta(file) {
  return new Promise((res) => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        const out = { duration: Number.isFinite(a.duration) ? a.duration : null };
        URL.revokeObjectURL(url);
        res(out);
      };
      a.onerror = () => { URL.revokeObjectURL(url); res({ duration: null }); };
      a.src = url;
    } catch (_) {
      res({ duration: null });
    }
  });
}

// Upload an audio file (mp3 / wav / etc) to R2. Inserts an `images`
// row even though the file isn't an image — the sign-reads endpoint
// uses the table as the "uploaded R2 objects" allowlist for RLS, so a
// missing row means no signed read URL gets issued and `<audio>`
// silently fails to load.
export async function uploadAudio({ file, workspaceId, boardId, userId, onProgress = null,
                                    maxBytes = 50 * 1024 * 1024 }) {
  if (!workspaceId) throw new Error('workspaceId required');
  if (file.size > maxBytes) {
    throw new Error(`Audio too large (${Math.round(file.size / 1024 / 1024)} MB; max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  }
  const meta = await readAudioMeta(file);
  const { uploadUrl, key } = await presign({ workspaceId, boardId, file });
  await putWithProgress(uploadUrl, file, { onProgress });

  const { error: rowErr } = await supabase
    .from('images')
    .insert({
      workspace_id: workspaceId,
      board_id: boardId || null,
      storage_path: key,
      width: null,
      height: null,
      size_bytes: file.size || null,
      uploaded_by: userId,
    });
  if (rowErr) console.warn('[uploads] audio images row insert failed', rowErr);

  return {
    src: `r2:${key}`,
    storagePath: key,
    key,
    duration: meta.duration,
  };
}

// Upload a short video to R2. Caller is expected to enforce constraints
// (max duration, max bytes) BEFORE calling — we still validate here as
// a backstop. Returns the same shape as uploadImage so callers can
// switch on `kind` rather than the URL.
export async function uploadVideo({ file, workspaceId, boardId, userId, onProgress = null,
                                    maxBytes = 30 * 1024 * 1024,
                                    maxDurationSec = 60 }) {
  if (!workspaceId) throw new Error('workspaceId required');
  if (file.size > maxBytes) {
    throw new Error(`Video too large (${Math.round(file.size / 1024 / 1024)} MB; max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  }
  const meta = await readVideoMeta(file);
  if (meta.duration && meta.duration > maxDurationSec) {
    throw new Error(`Video too long (${Math.round(meta.duration)}s; max ${maxDurationSec}s)`);
  }
  const { uploadUrl, key } = await presign({ workspaceId, boardId, file });
  await putWithProgress(uploadUrl, file, { onProgress });

  // Insert an `images` row so sign-reads authorizes the key. Without
  // this the video element gets src=undefined and never plays.
  const { error: rowErr } = await supabase
    .from('images')
    .insert({
      workspace_id: workspaceId,
      board_id: boardId || null,
      storage_path: key,
      width: meta.w,
      height: meta.h,
      size_bytes: file.size || null,
      uploaded_by: userId,
    });
  if (rowErr) console.warn('[uploads] video images row insert failed', rowErr);

  return {
    src: `r2:${key}`,
    storagePath: key,
    key,
    width: meta.w,
    height: meta.h,
    duration: meta.duration,
  };
}
