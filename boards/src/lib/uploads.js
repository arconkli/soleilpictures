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

// Upload a File to R2 (via the upload party) and insert an `images`
// row. Returns { id, src, storagePath, width, height, key }.
//
//   src           = "r2:<key>"  — the value to store on the card
//   storagePath   = key         — same value, unprefixed
//
// Pass boardId so the inserted row gets stamped with which board the
// upload originated from. RLS uses board_id to extend image read
// access to per-board shares.
export async function uploadImage({ file, workspaceId, boardId, userId }) {
  if (!workspaceId) throw new Error('workspaceId required');

  const { uploadUrl, key } = await presign({ workspaceId, boardId, file });

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) {
    const msg = await putRes.text().catch(() => putRes.statusText);
    throw new Error(`Upload failed: ${putRes.status} ${msg}`);
  }

  const dims = await readImageDims(file);

  const { data: row, error: rowErr } = await supabase
    .from('images')
    .insert({
      workspace_id: workspaceId,
      board_id: boardId || null,
      storage_path: key,
      width: dims.w,
      height: dims.h,
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
