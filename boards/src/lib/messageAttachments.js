import { supabase } from './supabase.js';

// Upload a File to the message-attachments bucket. Returns the attachment
// record shape ready to push into messages.attachments.
export async function uploadMessageFile(file, { workspaceId, userId }) {
  if (!supabase || !file) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const id  = crypto.randomUUID();
  const path = `${workspaceId}/${userId}/${id}.${ext || 'bin'}`;
  const { error } = await supabase.storage.from('message-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) { console.warn('upload failed', error); return null; }
  const isImage = (file.type || '').startsWith('image/');
  return {
    kind: isImage ? 'image' : 'file',
    storage_path: path,
    name: file.name,
    mime: file.type,
    size: file.size,
    ...(isImage ? await readImageDims(file) : {}),
  };
}

async function readImageDims(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Translate a chat attachment into the inbox-MIME payload shape that
// CanvasSurface.handleDrop already understands. Each attachment kind maps
// to the appropriate seeded card.
export function inboxPayloadFor(att) {
  const url = att.storage_path
    ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/message-attachments/${att.storage_path}`
    : att.href;
  switch (att.kind) {
    case 'image':
      return { kind: 'image', src: url, label: att.name, w: att.width, h: att.height };
    case 'file':
      return { kind: 'link', url, title: att.name || url, source: 'attachment' };
    case 'url':
      return { kind: 'link', url: att.href, title: att.title || att.href, source: att.favicon };
    case 'board':
      return { kind: 'boardRef', boardId: att.boardId, name: att.title };
    case 'card':
      return { kind: 'boardRef', boardId: att.boardId, cardId: att.cardId };
    case 'doc':
    case 'docPos':
      return { kind: 'docRef', docCardId: att.docCardId, pageId: att.pageId };
    default: return null;
  }
}
