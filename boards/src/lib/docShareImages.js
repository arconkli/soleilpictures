// A shared doc's images, for the people it is shared with.
//
// Someone reading a doc through its share holds the doc's image keys (they are
// in the doc the room sends) but no session that may sign them. The party's
// POST /share/doc-images (party/upload.ts) signs a key only when all of these
// hold, in this order:
//   1. get_file_share, run AS THE CALLER (their bearer, else the anon key with
//      the token), answers ok for a doc: the link is on for them, or they were
//      invited, and nothing was taken down.
//   2. the room it names is the doc's current one (_doc_room_target's
//      generation): nothing is signed for a doc that moved or was restored.
//   3. that room holds the key (DocParty /keys): a member put the image in the
//      doc. Guests cannot add images (docRoomBridge.js refuses a key it does
//      not trust).
//   4. it is a live images row of the share's workspace (0427: such a row's
//      key is its own workspace's).
// And it is a raster image, served as the raster type its name says whatever
// it was uploaded as. The urls live an hour, privately cached. The answer is
// aligned with the request (urls[i] answers keys[i]) and never names a key.
//
// The bottom half is the reader's side: r2.js resolves the doc's keys through
// a resolver made here (setKeyResolver), batched like /sign-reads.
import { PARTY_ORIGIN } from './partyHost.js';

export const DOC_IMAGE_KEYS_MAX = 100;
export const DOC_IMAGE_URL_TTL_SECONDS = 60 * 60;
export const DOC_IMAGE_CACHE_CONTROL = 'private, max-age=3600';

const RASTER = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
});
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// An original upload: <workspace id>/<name>.<ext>.
const KEY_RE = new RegExp(`^(${UUID})/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\\.([A-Za-z0-9]{1,8})$`, 'i');
const ROOM_RE = new RegExp(`^(${UUID})\\.(edit|view)\\.([0-9a-f]{12})$`, 'i');

// The raster content type a key's name says, or null (svg, html, a pdf,
// anything else is never signed here).
export function rasterTypeOf(key) {
  const m = KEY_RE.exec(String(key || ''));
  return m ? RASTER[m[2].toLowerCase()] || null : null;
}

// { token, keys } from a request body, or null. keys keeps the caller's order
// and length, so the answer can line up with it; a key that is not a string is
// '' (answered null).
export function parseDocImageRequest(body, tokenRe) {
  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!tokenRe.test(token)) return null;
  const keys = Array.isArray(body?.keys) ? body.keys : null;
  if (!keys || !keys.length || keys.length > DOC_IMAGE_KEYS_MAX) return null;
  return { token, keys: keys.map((k) => (typeof k === 'string' ? k : '')) };
}

// The room get_file_share named for this caller: { name, shareId, variant, gen }.
export function roomOfAnswer(answer) {
  const m = ROOM_RE.exec(String(answer?.room || ''));
  if (!m) return null;
  return { name: m[0].toLowerCase(), shareId: m[1].toLowerCase(), variant: m[2].toLowerCase(), gen: m[3].toLowerCase() };
}

// The keys worth asking the images table about: raster, under the share's
// workspace, and held by the room.
export function candidateKeys(keys, { workspaceId, trusted }) {
  const prefix = `${String(workspaceId || '').toLowerCase()}/`;
  const out = new Set();
  if (prefix === '/' || !trusted) return out;
  for (const k of keys) {
    if (!k || !rasterTypeOf(k)) continue;
    if (!k.toLowerCase().startsWith(prefix)) continue;
    if (!trusted.has(k)) continue;
    out.add(k);
  }
  return out;
}

// urls[i] for keys[i]: a url, or null.
export function alignedUrls(keys, urlByKey) {
  return keys.map((k) => (k && urlByKey.get(k)) || null);
}

// ---------------------------------------------------------------------------
// The reader's side.

// One resolver per open share. getBearer() is the reader's access token ('' for
// someone signed out); refresh() renews it once when the party says it expired.
// A url is kept until five minutes before it dies.
export function createDocImageResolver({
  token,
  getBearer = async () => '',
  refresh = async () => {},
  fetchImpl = (...a) => fetch(...a),
  now = () => Date.now(),
  batchMs = 30,
  origin = PARTY_ORIGIN,
} = {}) {
  const cache = new Map();          // key → { url, expiresAt }
  let queue = new Map();            // key → [resolve]
  let timer = null;
  const keepMs = (DOC_IMAGE_URL_TTL_SECONDS - 5 * 60) * 1000;

  const cached = (key) => {
    const c = cache.get(key);
    return c && c.expiresAt > now() ? c.url : null;
  };

  const ask = async (keys) => {
    const post = async () => {
      const bearer = await getBearer();
      const res = await fetchImpl(`${origin}/parties/upload/share/doc-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify({ token, keys }),
      });
      try { return await res.json(); } catch (_) { return null; }
    };
    let out = await post();
    if (out?.status === 'auth_expired') {
      try { await refresh(); } catch (_) { /* ask again anyway */ }
      out = await post();
    }
    return out && out.status === 'ok' && Array.isArray(out.urls) ? out.urls : [];
  };

  const flush = async () => {
    timer = null;
    const batch = queue;
    queue = new Map();
    const keys = [...batch.keys()];
    for (let i = 0; i < keys.length; i += DOC_IMAGE_KEYS_MAX) {
      const part = keys.slice(i, i + DOC_IMAGE_KEYS_MAX);
      let urls = [];
      try { urls = await ask(part); } catch (_) { urls = []; }
      part.forEach((k, j) => {
        const url = typeof urls[j] === 'string' && urls[j] ? urls[j] : null;
        if (url) cache.set(k, { url, expiresAt: now() + keepMs });
        for (const done of batch.get(k) || []) done(url);
      });
    }
  };

  return {
    cached,
    resolve(key, { force = false } = {}) {
      if (force) cache.delete(key);
      const hit = cached(key);
      if (hit) return Promise.resolve(hit);
      return new Promise((done) => {
        if (!queue.has(key)) queue.set(key, []);
        queue.get(key).push(done);
        if (!timer) timer = setTimeout(() => { void flush(); }, batchMs);
      });
    },
    // A url that failed is never handed out again.
    onAuthError(key) { cache.delete(key); },
  };
}
