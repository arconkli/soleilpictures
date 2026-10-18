// What is left on the drive a cluster's uploads count against — the cluster
// OWNER's, exactly what authorize_image_upload will decide on. A dry run:
// p_bytes 0, and the function writes nothing (STABLE). Null when it cannot be
// read (offline, local mode, no longer a writer): the server still decides
// each file, so not knowing never blocks a drop.
//
// Shared by the drop preflight (App buildMutators) and the held-drop release
// watcher, which asks it whether a cluster's drive has grown since a drop was
// held (lib/heldUploads.js).

import { supabase } from './supabase.js';

export async function storageRoom(boardId) {
  if (!boardId || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc('authorize_image_upload', { p_board_id: boardId, p_bytes: 0 });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.reason === 'not_writer' || row.reason === 'no_workspace') return null;
    const quota = Number(row.quota);
    const used = Number(row.used);
    if (!Number.isFinite(quota) || !Number.isFinite(used) || quota <= 0) return null;
    return { used, quota, remaining: Math.max(0, quota - used) };
  } catch (_) { return null; }
}
