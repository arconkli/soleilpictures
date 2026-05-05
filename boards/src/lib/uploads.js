// Image uploads to the `board-images` Storage bucket + a row in `images`.

import { supabase } from './supabase.js';

const BUCKET = 'board-images';

// Read a File's pixel dimensions before uploading. Best-effort.
function readImageDims(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { res({ w: null, h: null }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Upload a File to storage and insert an `images` row. Returns
// { publicUrl, storagePath, width, height, id }.
export async function uploadImage({ file, workspaceId, userId }) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
  const id = crypto.randomUUID();
  const storagePath = `${workspaceId}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '604800',
      upsert: false,
    });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = pub.publicUrl;

  const dims = await readImageDims(file);

  const { data: row, error: rowErr } = await supabase
    .from('images')
    .insert({
      workspace_id: workspaceId,
      storage_path: storagePath,
      width: dims.w,
      height: dims.h,
      uploaded_by: userId,
    })
    .select('*')
    .single();
  if (rowErr) throw rowErr;

  return {
    id: row.id,
    publicUrl,
    storagePath,
    width: dims.w,
    height: dims.h,
  };
}
