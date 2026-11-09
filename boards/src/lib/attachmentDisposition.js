// The Content-Disposition a download URL is signed with (party/upload.ts
// /sign-reads `download`), from a client-supplied filename. Pure and shared
// with the party so node tests pin it (MEDIA-09).
//
// `attachment; filename="<ascii>"; filename*=UTF-8''<utf8>` (RFC 6266). The
// name is client input signed into a response header, so quotes, backslashes,
// control characters and path separators are stripped and the length capped:
// nothing in it can end the quoted value or start another header.
import { wellFormed, cutToLimits } from './safeFileName.js';

export function attachmentDisposition(name) {
  // Cut by whole characters: slice() cut UTF-16 units, and a lone surrogate
  // made encodeURIComponent throw (a 500 on /sign-reads).
  const clean = cutToLimits(wellFormed(name).replace(/[\u0000-\u001f\u007f"\\/]+/g, '').trim(), { maxChars: 150 }).trim();
  if (!clean) return null;
  const ascii = clean.replace(/[^\x20-\x7e]+/g, '_');
  // RFC 5987 attr-chars exclude ' ( ) * , which encodeURIComponent leaves alone.
  const ext = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${ext}`;
}
