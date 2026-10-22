// Media for files shared with you, wherever they show in the app: the /f/
// page, the in-app viewer, a shortcut card. Their keys are
// `__fs/<token>/<name>` (name: src, poster or download), and r2.js resolves
// them here (setPrefixResolver), never through /sign-reads, so a shared file
// never disturbs how the app's own files load. One /file-share call per token
// answers all of them; an answer is reused until an hour before its urls
// expire (FILE_SHARE_URL_TTL_SECONDS), then the next read asks again.
import { setPrefixResolver } from './r2.js';
import { FILE_SHARE_URL_TTL_SECONDS, FS_PREFIX, fsRef, parseFsKey } from './fileShareBundle.js';
import { fetchFileShare } from './fileShares.js';

export { FS_PREFIX, fsRef, parseFsKey };
export const FRESH_MS = (FILE_SHARE_URL_TTL_SECONDS - 60 * 60) * 1000;
const LIVE_MS = FILE_SHARE_URL_TTL_SECONDS * 1000;

const entries = new Map();   // token → { res, at }
const inflight = new Map();  // token → Promise<res>
const listeners = new Set();

function emit(token) {
  for (const fn of listeners) { try { fn(token); } catch (_) {} }
}

// A fresh answer the caller already has (the /f/ page reads for itself).
export function rememberShare(token, res, at = Date.now()) {
  const t = String(token || '').toLowerCase();
  if (!t || !res || res.status !== 'ok') return;
  entries.set(t, { res, at });
  emit(t);
}

// The last answer for a token, or null.
export function shareEntry(token) {
  return entries.get(String(token || '').toLowerCase())?.res || null;
}

// The answer for a token: the remembered one while fresh, else one read
// (shared by everyone asking at once). A share that is gone or out of reach
// is forgotten, so nothing keeps showing it.
export function ensureShare(token, { force = false, api = null } = {}) {
  const t = String(token || '').toLowerCase();
  if (!t) return Promise.resolve({ status: 'gone' });
  const e = entries.get(t);
  if (!force && e && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.res);
  if (inflight.has(t)) return inflight.get(t);
  const read = api?.fetchFileShare || fetchFileShare;
  const p = (async () => {
    try {
      let r = await read(t);
      if (r?.status === 'auth_expired') r = await read(t, { anonymous: true });
      if (r?.status === 'ok') rememberShare(t, r);
      else if (r && ['gone', 'sign_in', 'no_access'].includes(r.status) && entries.has(t)) {
        entries.delete(t);
        emit(t);
      }
      return r && typeof r === 'object' ? r : { status: 'error' };
    } catch (_) {
      return { status: 'error' };
    } finally {
      inflight.delete(t);
    }
  })();
  inflight.set(t, p);
  return p;
}

// fn(token) after any token's answer changes. Returns the unsubscribe.
export function subscribeShares(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function urlFor(key) {
  const k = parseFsKey(key);
  if (!k) return null;
  const e = entries.get(k.token);
  if (!e || Date.now() - e.at >= LIVE_MS) return null;
  return e.res?.urls?.[k.name] || null;
}

setPrefixResolver(FS_PREFIX, {
  cached: urlFor,
  async resolve(key, { force = false } = {}) {
    const k = parseFsKey(key);
    if (!k) return null;
    if (!force) {
      const have = urlFor(key);
      const e = entries.get(k.token);
      if (have && e && Date.now() - e.at < FRESH_MS) return have;
    }
    const r = await ensureShare(k.token, { force });
    return r?.status === 'ok' ? r.urls?.[k.name] || null : null;
  },
  onAuthError(key) {
    const k = parseFsKey(key);
    if (k) void ensureShare(k.token, { force: true });
  },
});

// Tests only.
export function __resetShareUrls() { entries.clear(); inflight.clear(); }
