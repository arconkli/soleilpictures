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
