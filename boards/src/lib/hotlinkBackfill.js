// hotlinkBackfill — copies for the web images placed before copies were kept.
//
// A web image dropped since worker-media.js shipped is saved as it lands. The
// ones placed before then are still hotlinks, and so is any whose save failed
// for a passing reason. They are exactly the cards that break the day a page
// moves, so a writer's open of a board saves a few of them (CanvasSurface),
// through the same route and with the same silence: a card that cannot be
// copied stays the link it was.
//
// A few per open, one at a time: this is a repair, never a migration, and it
// shares the owner's storage and the route's rate limit with the person who is
// actually working. What was tried is remembered in this browser, so a picture
// that can never be copied (behind a login, not a picture, too large) is not
// fetched again on every open.
//
// Pure, apart from the storage handed in.

export const HOTLINK_PER_OPEN = 3;
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MEMO_KEY = 'soleil.hotlinkTried.v1';
const MEMO_MAX = 500;

// Never worth asking about again.
const PERMANENT = new Set(['not_an_image', 'too_large', 'unsafe_url', 'bad_request']);
// Not about this picture — about the account, the board or the route. Stop the
// pass; the next open asks again.
const STOPS_PASS = new Set(['over_quota', 'not_writer', 'not_found', 'rate_limited', 'cooldown', 'signed_out', 'storage_unavailable', 'busy']);
export const stopsThePass = (code) => STOPS_PASS.has(code);

export const isHotlinkImage = (c) => c?.kind === 'image' && !c.pending
  && typeof c.src === 'string' && /^https?:\/\//i.test(c.src);

// Short and stable: signed CDN links run to hundreds of characters, and the
// memo only needs to recognise one.
export function urlKey(url) {
  let h = 5381;
  const s = String(url);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

// The hotlinks worth trying now: not already tried this session, not known to
// be impossible, not tried in the last day.
export function pickHotlinks(cards, { attempted = new Set(), tried = {}, now = Date.now(), limit = HOTLINK_PER_OPEN } = {}) {
  const out = [];
  for (const c of cards || []) {
    if (out.length >= limit) break;
    if (!isHotlinkImage(c) || attempted.has(`${c.id}|${c.src}`)) continue;
    const memo = tried[urlKey(c.src)];
    if (memo && (PERMANENT.has(memo.c) || now - memo.t < RETRY_AFTER_MS)) continue;
    out.push(c);
  }
  return out;
}

export function noteTried(tried, url, code, now = Date.now()) {
  tried[urlKey(url)] = { c: code, t: now };
  const keys = Object.keys(tried);
  if (keys.length > MEMO_MAX) {
    keys.sort((a, b) => tried[a].t - tried[b].t);
    for (const k of keys.slice(0, keys.length - MEMO_MAX)) delete tried[k];
  }
  return tried;
}

export function loadTried(storage) {
  try {
    const v = JSON.parse(storage?.getItem?.(MEMO_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) { return {}; }
}

export function saveTried(storage, tried) {
  try { storage?.setItem?.(MEMO_KEY, JSON.stringify(tried)); } catch (_) { /* private mode, full */ }
}
