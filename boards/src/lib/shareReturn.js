// shareReturn.js — a sign-up that began on a /share page goes back there.
//
// Every share-page CTA sent the visitor to '/', carried the share token as
// attribution only, and after the OTP hop dropped them at the root of an empty
// workspace. Not one share-token signup ever first-opened the board they had
// been looking at — and they were the best-returning cohort on a phone anyway.
//
// The fix is the ?join= idiom: a marker on the CTA URL, stashed in localStorage
// across the OTP round trip by AuthGate, consumed once a session exists by
// navigating back to /share/<token>. share_token itself stays in the URL: the
// first-touch attribution reads it. Pure, storage injected, node-testable.

const KEY = 'soleil.boards.pending.share.return';
const PARAM = 'back';
const MARK = 'share';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

// The share token to return to, or null. Requires BOTH the marker and a
// well-formed token: a bare marker or a malformed token stashes nothing.
export function parseShareReturn(url) {
  if (!url || typeof url.searchParams?.get !== 'function') return null;
  if (url.searchParams.get(PARAM) !== MARK) return null;
  const t = (url.searchParams.get('share_token') || '').trim();
  return UUID_RE.test(t) ? t : null;
}

export function withShareReturn(href) {
  const h = String(href || '/');
  return `${h}${h.includes('?') ? '&' : '?'}${PARAM}=${MARK}`;
}

export function shareReturnHref(token) {
  return UUID_RE.test(String(token || '')) ? `/share/${token}` : '/';
}

export function stashShareReturn(token, storage = defaultStorage()) {
  if (!UUID_RE.test(String(token || ''))) return;
  try { storage?.setItem(KEY, token); } catch (_) {}
  // Newest intent wins: a file return left over from an earlier visit must not
  // outrank the cluster share the visitor just came from.
  clearFileReturn(storage);
}

export function readShareReturn(storage = defaultStorage()) {
  try {
    const v = storage?.getItem(KEY);
    return UUID_RE.test(String(v || '')) ? v : null;
  } catch (_) { return null; }
}

export function clearShareReturn(storage = defaultStorage()) {
  try { storage?.removeItem(KEY); } catch (_) {}
}

// The same contract for a single shared file (/f/<token>): the sign-in link
// carries back=file&file_token=<uuid>, AuthGate stashes it across the OTP hop
// and, once a session exists, goes back to /f/<token>. Its own key, but only
// one return is ever pending: stashing either clears the other.
const FILE_KEY = 'soleil.boards.pending.file.return';
const FILE_MARK = 'file';

export function parseFileReturn(url) {
  if (!url || typeof url.searchParams?.get !== 'function') return null;
  if (url.searchParams.get(PARAM) !== FILE_MARK) return null;
  const t = (url.searchParams.get('file_token') || '').trim();
  return UUID_RE.test(t) ? t : null;
}

export function fileReturnHref(token) {
  return UUID_RE.test(String(token || '')) ? `/f/${token}` : '/';
}

export function stashFileReturn(token, storage = defaultStorage()) {
  if (!UUID_RE.test(String(token || ''))) return;
  try { storage?.setItem(FILE_KEY, token); } catch (_) {}
  clearShareReturn(storage);
}

export function readFileReturn(storage = defaultStorage()) {
  try {
    const v = storage?.getItem(FILE_KEY);
    return UUID_RE.test(String(v || '')) ? v : null;
  } catch (_) { return null; }
}

export function clearFileReturn(storage = defaultStorage()) {
  try { storage?.removeItem(FILE_KEY); } catch (_) {}
}
