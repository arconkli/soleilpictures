import { supabase } from './supabase.js';

// Content types we are willing to have a browser RENDER inline straight off the
// storage domain. Everything else uploads as application/octet-stream, which
// makes the browser download it instead.
//
// Why this exists (0218): message-attachments is a PUBLIC bucket, deliberately
// so — object GET-by-key bypasses RLS and <img>/PDF rendering depends on it
// (0165 established that and it still holds). But Supabase serves back whatever
// content-type was declared at upload, and the client declares it from
// `file.type`, which the user controls. Declaring text/html meant a page that
// renders on `<project>.supabase.co` — the same origin as the auth API — and an
// image/svg+xml can carry script the same way.
//
// The point of the remap is that NO attachment type stops working. A .html or
// .svg still uploads, still attaches, still downloads; it just doesn't render
// itself in place. The bucket's allowed_mime_types is this list plus
// application/octet-stream, so by construction every upload here is accepted —
// keep the two in step if you edit either.
const INLINE_SAFE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg',
  'text/plain',
]);

export function safeUploadContentType(mime) {
  const t = String(mime || '').split(';')[0].trim().toLowerCase();
  return INLINE_SAFE_TYPES.has(t) ? t : 'application/octet-stream';
}

// Upload a File to the message-attachments bucket. Returns the attachment
// record shape ready to push into messages.attachments.
export async function uploadMessageFile(file, { workspaceId, userId }) {
  if (!supabase || !file) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const id  = crypto.randomUUID();
  // Path shape is load-bearing: `<workspaceId>/<userId>/<uuid>.<ext>`. The
  // storage policies read folder[1] as the workspace and folder[2] as the
  // uploader, so changing this shape silently breaks read AND write authz.
  const path = `${workspaceId}/${userId}/${id}.${ext || 'bin'}`;
  const served = safeUploadContentType(file.type);
  const { error } = await supabase.storage.from('message-attachments').upload(path, file, {
    contentType: served,
    upsert: false,
  });
  if (error) { console.warn('upload failed', error); return null; }
  // Derive `kind` from what will actually be SERVED, not from what was picked.
  // An SVG is image/* but gets remapped to octet-stream above, so calling it an
  // image would render it into an <img> that can never load. As a file it stays
  // a working, downloadable attachment.
  const isImage = served.startsWith('image/');
  return {
    kind: isImage ? 'image' : 'file',
    storage_path: path,
    // `mime` keeps the ORIGINAL type: it drives how the app labels and renders
    // the attachment in its own UI, which is a different question from what the
    // storage domain is allowed to hand a browser.
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
    case 'file': {
      // A PDF attachment becomes a real PDF card (opens in the in-app viewer).
      // It lives in the public message-attachments bucket, so the viewer uses
      // the plain URL (resolveSrc passes non-r2: through). No R2 thumbnail.
      const isPdf = (att.mime === 'application/pdf') || /\.pdf$/i.test(att.name || '');
      if (isPdf) return { kind: 'pdf', pdfSrc: url, src: null, name: att.name || 'PDF' };
      return { kind: 'link', url, title: att.name || url, source: 'attachment' };
    }
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
