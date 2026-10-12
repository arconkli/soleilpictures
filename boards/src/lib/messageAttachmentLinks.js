// Links and labels for message attachments. Pure, so node --test can pin it.
//
// A file attachment rendered as plain text: no link, no way to open or save it
// except dragging it onto a canvas, and on a phone not even that (COMMS-07).
// message-attachments is a public bucket (see messageAttachments.js), so the
// object URL opens the file; `?download=` makes Supabase send it as an
// attachment under its real name — the `download` attribute alone is ignored
// for a cross-origin URL.

export function attachmentUrl(base, storagePath, { download = null } = {}) {
  if (!base || !storagePath) return '';
  const path = String(storagePath).split('/').map(encodeURIComponent).join('/');
  const url = `${base}/storage/v1/object/public/message-attachments/${path}`;
  return download ? `${url}?download=${encodeURIComponent(download)}` : url;
}

export function formatAttachmentSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// The box an image attachment takes BEFORE it loads, from the dimensions
// recorded at upload: its aspect ratio, no taller than maxH. Without it the
// image arrived at zero height and pushed the newest message off-screen when
// it loaded, and a tall portrait ran unbounded down the panel (COMMS-16).
// Null when the dimensions weren't recorded (older attachments).
export const IMAGE_MAX_H = 320;
export function imageBoxStyle(att, maxH = IMAGE_MAX_H) {
  const w = Number(att?.width), h = Number(att?.height);
  if (!(w > 0) || !(h > 0)) return null;
  return {
    aspectRatio: `${w} / ${h}`,
    width: `min(100%, ${Math.round(Math.min(w, (maxH * w) / h))}px)`,
    height: 'auto',
  };
}

// "PDF · 2.4 MB" — the extension when the name has one, else the mime subtype.
export function attachmentMetaLabel(att) {
  const name = String(att?.name || '');
  const dot = name.lastIndexOf('.');
  let type = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
  if (!type && att?.mime) type = String(att.mime).split('/').pop().split(';')[0];
  type = type.slice(0, 8).toUpperCase();
  return [type, formatAttachmentSize(att?.size)].filter(Boolean).join(' · ');
}
