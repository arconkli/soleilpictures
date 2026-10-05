// webImageSave — the rules for keeping a copy of an image dragged in from the
// web, shared by the Worker route that does it (worker-media.js), the canvas
// that asks for it, and the docs that state its limits.
//
// Pure (no Worker or browser globals), so every rule here tests under node.

import { ogTargetProblem } from './safeUrl.js';
import { meaningfulFileName } from './fileIngest.js';

export const WEB_IMAGE = Object.freeze({
  // The whole body is held in the isolate to read what it really is, so the
  // ceiling is the API's single-shot upload ceiling (worker-api.js
  // MAX_UPLOAD_BYTES) for the same reason. Past it, the card stays linked.
  maxBytes: 25 * 1024 * 1024,
  timeoutMs: 15_000,
  // images.source_url's own CHECK (0357).
  urlMax: 2000,
  // Per signed-in person, per Worker isolate. A person dragging pictures in
  // one at a time never meets it; a script looping on the route does.
  perMinute: 40,
  // What all saves in ONE isolate may hold in memory at once. The isolate has
  // 128MB and is shared with every other request it is serving — the app, the
  // API, the SEO pages — so a few large saves at the same moment must not be
  // able to kill it. A save reserves its declared length, or twice the ceiling
  // when the length is undeclared (it is read in chunks and joined at the end);
  // one that does not fit is answered 503 'busy' and the card stays a link.
  isolateBudgetBytes: 64 * 1024 * 1024,
});

// What a saved copy may be: pictures every browser draws. HEIC/HEIF are real
// images but only Safari shows them, and the hotlink they would replace is no
// better — so they stay linked rather than becoming a copy most viewers cannot
// see. SVG never gets this far (sniffImageType never answers it).
export const SAVEABLE_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
});

// Why this address may not be fetched, or null. The same host and port rule
// as the link-preview fetch (/api/og), plus: no embedded login, and short
// enough for the column that records it.
export function webImageUrlProblem(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'no address';
  if (s.length > WEB_IMAGE.urlMax) return 'address too long';
  let u;
  try { u = new URL(s); } catch { return 'not an address'; }
  if (u.username || u.password) return 'address carries a login';
  return ogTargetProblem(u);
}

// The picture's own name, when its address has one worth keeping:
// ".../ext_dusk_04.jpg?w=1200" → "ext_dusk_04.jpg". A CDN path with no
// extension ("/images?q=tbn:…", "/p/C8x…") names nothing, and inventing a name
// would be worse than having none.
export function nameFromImageUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  const last = u.pathname.split('/').filter(Boolean).pop() || '';
  let decoded = last;
  try { decoded = decodeURIComponent(last); } catch { /* keep it encoded */ }
  if (!/\.(png|jpe?g|gif|webp|avif)$/i.test(decoded)) return null;
  return meaningfulFileName({ name: decoded });
}

export class SaveError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// The body's declared length, or null when it does not say (or says nonsense).
export function declaredLength(res) {
  const raw = res.headers?.get?.('content-length');
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// A response body, read up to `max` bytes and no further. A declared length
// over the ceiling is refused before a byte is read, and a declared length is
// read straight into ONE buffer of that size — the body is never held twice.
// An undeclared one is counted as it streams, abandoned the moment it passes,
// and joined at the end.
export async function readCapped(res, max = WEB_IMAGE.maxBytes) {
  const declared = declaredLength(res);
  if (declared != null && declared > max) {
    try { await res.body?.cancel?.(); } catch (_) { /* already closed */ }
    throw new SaveError('too_large', 413);
  }
  if (!res.body?.getReader) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.length > max) throw new SaveError('too_large', 413);
    return whole;
  }
  const reader = res.body.getReader();
  const tooLarge = async () => {
    try { await reader.cancel(); } catch (_) { /* already closed */ }
    return new SaveError('too_large', 413);
  };
  if (declared != null) {
    const out = new Uint8Array(declared);
    let filled = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // More than it said: not the body it described. Refused rather than grown.
      if (filled + value.byteLength > declared) throw await tooLarge();
      out.set(value, filled);
      filled += value.byteLength;
    }
    return filled === declared ? out : out.subarray(0, filled);
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) throw await tooLarge();
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].byteLength; chunks[i] = null; }
  return out;
}

// What a save reserves against the isolate's budget before it reads a byte.
export const reservationFor = (declared, max = WEB_IMAGE.maxBytes) => (declared != null ? declared : 2 * max);

// The isolate's memory budget for saves in flight: take() before reading,
// give() back in a finally.
export function makeByteBudget(limit = WEB_IMAGE.isolateBudgetBytes) {
  let used = 0;
  return {
    take(n) { if (used + n > limit) return false; used += n; return true; },
    give(n) { used = Math.max(0, used - n); },
    get used() { return used; },
  };
}

// A fixed one-minute window per key, in memory. Per isolate on purpose: it
// bounds a loop, not a determined abuser, and needs no storage of its own.
export function makeRateLimiter({ perMinute = WEB_IMAGE.perMinute, now = () => Date.now() } = {}) {
  const seen = new Map();   // key → { start, n }
  return (key) => {
    const t = now();
    const cur = seen.get(key);
    if (!cur || t - cur.start >= 60_000) {
      if (seen.size > 5000) seen.clear();
      seen.set(key, { start: t, n: 1 });
      return true;
    }
    cur.n += 1;
    return cur.n <= perMinute;
  };
}
