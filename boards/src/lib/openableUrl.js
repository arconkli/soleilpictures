// What a link card's "Open" is allowed to hand to window.open.
//
// The open handlers used to glue "https://" onto anything that did not start
// with "http". On 2026-10-12 a link card holding a dropped
// blob:https://livettu.sharepoint.com/… became https://blob:https//…, and
// window.open threw "Unable to open a window with invalid URL" from a click
// handler. This decides in one place: a bare host gets https://, only http(s)
// and mailto: open, and anything else (blob:, data:, javascript:, file:) is
// null so the caller can say so instead of throwing. (safeExternalHref.js is
// the other half: it makes a link harmless inside an href, and never says no.)

// Schemes that carry no "//" authority, so "scheme:rest" is still a scheme.
// Anything else needs "//" after the colon, which keeps "localhost:3000" and
// "example.com:8080/x" reading as bare hosts.
const NO_AUTHORITY = new Set([
  'http', 'https', 'ftp', 'blob', 'data', 'javascript', 'vbscript',
  'file', 'about', 'mailto', 'tel', 'sms',
]);

export function openableUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^([a-z][a-z\d+.-]*):/i.exec(s);
  const hasScheme = !!m && (s.slice(m[0].length).startsWith('//') || NO_AUTHORITY.has(m[1].toLowerCase()));
  let u;
  try { u = new URL(hasScheme ? s : `https://${s}`); } catch (_) { return null; }
  if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname ? u.href : null;
  if (u.protocol === 'mailto:') return u.href;
  return null;
}
