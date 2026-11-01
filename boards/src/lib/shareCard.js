// The picture a pasted cluster link shows (iMessage, WhatsApp, Slack …): a
// 1200x630 JPEG drawn here, in the sender's browser, the moment they open the
// Share panel or copy a link, and uploaded for the Worker to serve as the
// link's og:image (PUT /api/share-card, lib in worker-api.js).
//
// The look is the search pages' (lib/sunArt.js 'og'): the logo's orbits and
// suns on a dark ground, up to four of the cluster's own pictures piled on
// them, the cluster's NAME big on the left, a small CLUSTERS mark at the
// bottom. It never carries a note's or a doc's words: the card is built from
// the name and pictures alone, so there is nothing else to leak.
//
// Pictures are loaded with loadCorsCleanImage (a cache-bypassing fetch decoded
// from an object URL — see lib/corsImage.js for why a crossOrigin <img> is NOT
// used on R2 URLs), so a canvas this draws on is never tainted; a picture that
// cannot be fetched that way is skipped, not fatal.
//
// Everything here fails quietly: renderShareCard resolves null and
// refreshShareCard resolves false, never rejects. A missing card costs a link
// its preview and nothing else.

import { orbitArtSvg } from './sunArt.js';
import { sunMarkSvg } from './sunMark.js';
import { layoutShareCard, CARD_W, CARD_H, MAX_PICTURES } from './shareCardLayout.js';
import { loadCorsCleanImage } from './corsImage.js';

// Bump when the design changes, so cards already uploaded are redrawn.
const CARD_VERSION = 1;
const MAX_BYTES = 380 * 1024;          // the Worker takes 400 KB; stay clear
const QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5];
const CANDIDATES = MAX_PICTURES + 2;   // a spare or two in case some won't load
const IMAGE_TIMEOUT_MS = 8000;
const FONT_TIMEOUT_MS = 1500;

const DISPLAY = "brandon-grotesque, Futura, 'Avenir Next', 'Century Gothic', sans-serif";
const FRAME = 5;   // the white-ish border around each picture

const withTimeout = (p, ms, fallback = null) =>
  Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);

function svgToImage(svg) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Crop-fill (object-fit: cover) an image into a rect.
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const want = w / h, have = iw / ih;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (have > want) { sw = ih * want; sx = (iw - sw) / 2; } else { sh = iw / want; sy = (ih - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function toJpeg(canvas, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b || null), 'image/jpeg', quality); } catch (_) { resolve(null); }
  });
}

// Draws the card; resolves a JPEG Blob under MAX_BYTES, or null. `stats`, if
// given, gets `drawn` (how many pictures made it onto the card) and `wanted`
// (how many it was meant to carry), so a caller can tell a complete card from
// one that skipped pictures that would not load.
export async function renderShareCard({ name, imageUrls = [], stats = null } = {}) {
  try {
    if (typeof document === 'undefined') return null;
    const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter((u) => typeof u === 'string' && u).slice(0, CANDIDATES);

    // The display font, if the app has it; the stack falls back to a sans.
    try { await withTimeout(document.fonts.load(`700 92px ${DISPLAY}`), FONT_TIMEOUT_MS); } catch (_) {}

    const [art, mark, ...loaded] = await Promise.all([
      svgToImage(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">`
        + `<style>.orb{filter:drop-shadow(0 8px 16px rgba(0,0,0,.45))}</style>${orbitArtSvg('og', { id: 'sc', motion: false })}</svg>`),
      svgToImage(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="92" height="92">${sunMarkSvg({ id: 'scm' })}</svg>`),
      ...urls.map((u) => withTimeout(loadCorsCleanImage(u).catch(() => null), IMAGE_TIMEOUT_MS)),
    ]);
    const pics = loaded.filter((img) => img && (img.naturalWidth || img.width)).slice(0, MAX_PICTURES);
    if (stats) { stats.drawn = pics.length; stats.wanted = Math.min(urls.length, MAX_PICTURES); }

    const canvas = document.createElement('canvas');
    canvas.width = CARD_W; canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const nameFont = (px) => `700 ${px}px ${DISPLAY}`;
    const measure = (text, px) => { ctx.font = nameFont(px); return ctx.measureText(text).width; };
    const L = layoutShareCard({
      name,
      pictures: pics.map((img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height })),
      measure,
    });

    // Ground: the same warm-to-black ellipse the search pages' previews use.
    ctx.fillStyle = '#0a0809';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.save();
    ctx.translate(0.7 * CARD_W, 0.5 * CARD_H);
    const rx = 0.62 * CARD_W, ry = 0.7 * CARD_H;
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, '#1d130a');
    g.addColorStop(0.74, '#0a0809');
    ctx.fillStyle = g;
    ctx.fillRect(-CARD_W, -CARD_H * 2, CARD_W * 2, CARD_H * 4);
    ctx.restore();

    if (art) ctx.drawImage(art, 0, 0, CARD_W, CARD_H);

    // The pile: last first, so the main picture ends on top.
    for (let i = L.pictures.length - 1; i >= 0; i--) {
      const p = L.pictures[i];
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 26;
      ctx.fillStyle = '#f4f1ea';
      roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      roundRect(ctx, -p.w / 2 + FRAME, -p.h / 2 + FRAME, p.w - FRAME * 2, p.h - FRAME * 2, 8);
      ctx.clip();
      drawCover(ctx, pics[i], -p.w / 2 + FRAME, -p.h / 2 + FRAME, p.w - FRAME * 2, p.h - FRAME * 2);
      ctx.restore();
    }

    // The name.
    ctx.fillStyle = '#fffaf0';
    ctx.font = nameFont(L.fontPx);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    L.nameLines.forEach((line, i) => ctx.fillText(line, L.nameX, L.nameY + L.lineH * (i + 0.5)));

    // The mark and CLUSTERS, bottom left.
    const markY = CARD_H - 58 - 46;
    if (mark) ctx.drawImage(mark, 72, markY, 46, 46);
    ctx.font = `700 26px ${DISPLAY}`;
    let tx = 72 + 46 + 14;
    for (const ch of 'CLUSTERS') {
      ctx.fillText(ch, tx, markY + 23);
      tx += ctx.measureText(ch).width + 26 * 0.2;
    }

    for (const q of QUALITIES) {
      const blob = await toJpeg(canvas, q);
      if (!blob) return null;
      if (blob.size <= MAX_BYTES) return blob;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Choosing the pictures ──────────────────────────────────────────────────

const area = (c) => (Number(c?.w) || 0) * (Number(c?.h) || 0);
const biggestFirst = (a, b) => area(b) - area(a);

async function cardsOf(boardId, ydoc) {
  const { readCards, b64ToBytes } = await import('./yhelpers.js');
  if (ydoc) return readCards(ydoc);
  const { loadBoardSnapshot } = await import('./boardsApi.js');
  const b64 = await loadBoardSnapshot(boardId);
  if (!b64) return [];
  const Y = await import('yjs');
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, b64ToBytes(b64));
    return readCards(doc);
  } finally {
    doc.destroy();
  }
}

// The pictures a card would use, best first: the cluster's image cards,
// biggest on the board first, then its sub-clusters' covers. `ydoc` is the
// board's live document when the caller has it open (so the card is made from
// what is on screen); without one the saved copy is read. Resolves
// { imageUrls, imageKeys } — the keys are stable (a presigned URL is not), for
// refreshShareCard's "has anything changed" check. Never rejects.
export async function collectShareCardImages({ boardId, ydoc = null } = {}) {
  const none = { imageUrls: [], imageKeys: [] };
  try {
    if (!boardId) return none;
    const cards = (await cardsOf(boardId, ydoc)).filter((c) => c && c.unplaced !== true);
    const { getMeta, primeImageMeta } = await import('./imageMeta.js');
    const { pickVariantSrc } = await import('./imageVariantPick.js');
    const { resolveSrc } = await import('./r2.js');

    const pics = cards.filter((c) => c.kind === 'image' && typeof c.src === 'string' && c.src).sort(biggestFirst);
    const subs = cards.filter((c) => c.kind === 'board').sort(biggestFirst);

    const keys = pics.slice(0, CANDIDATES).map((c) => (c.src.startsWith('r2:') ? c.src.slice(3) : null)).filter(Boolean);
    try { await primeImageMeta(keys); } catch (_) {}   // so a small preview can be picked
    const srcs = pics.slice(0, CANDIDATES).map((c) => pickVariantSrc(c.src, getMeta, 700)).filter(Boolean);

    if (srcs.length < CANDIDATES && subs.length) {
      const { getChildBoardThumbs } = await import('./boardsApi.js');
      const thumbs = await getChildBoardThumbs(boardId);
      for (const c of subs) {
        const t = thumbs?.[c.id]?.thumb_key;
        if (t) srcs.push(t);
        if (srcs.length >= CANDIDATES) break;
      }
    }

    const urls = await Promise.all(srcs.map((s) => resolveSrc(s).catch(() => null)));
    const out = { imageUrls: [], imageKeys: [] };
    srcs.forEach((s, i) => { if (urls[i]) { out.imageUrls.push(urls[i]); out.imageKeys.push(s); } });
    return out;
  } catch (_) {
    return none;
  }
}

// ── Keeping the stored card current ────────────────────────────────────────

const LS_PREFIX = 'shareCard:';

function hashOf(parts) {
  const s = parts.join('\u0001');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const stable = (u) => String(u).split('?')[0];   // presigned URLs differ every time

function readStored(boardId) {
  try { return localStorage.getItem(LS_PREFIX + boardId); } catch (_) { return null; }
}
function writeStored(boardId, hash) {
  try { localStorage.setItem(LS_PREFIX + boardId, hash); } catch (_) {}
}

async function refreshOnce({ supabase, boardId, name, imageUrls = [], imageKeys = null }) {
  const keys = (Array.isArray(imageKeys) && imageKeys.length ? imageKeys : imageUrls.map(stable)).slice(0, MAX_PICTURES);
  const hash = hashOf([CARD_VERSION, boardId, name || '', ...keys]);
  if (readStored(boardId) === hash) return true;   // already up to date

  const stats = {};
  const blob = await renderShareCard({ name, imageUrls, stats });
  if (!blob) return false;
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return false;
  const res = await fetch(`/api/share-card?board=${encodeURIComponent(boardId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) return false;   // the hash stays unwritten, so the next copy tries again
  // A card that skipped pictures which would not load is uploaded (better than
  // none) but not remembered as current, so the next copy tries again.
  if (stats.drawn < stats.wanted) return false;
  writeStored(boardId, hash);
  return true;
}

// One run at a time per board; a call that arrives meanwhile is folded into a
// single follow-up with the latest arguments (which the hash then usually
// skips). Resolves true when the stored card matches, false otherwise. For
// callers that must not wait on it: fire it and move on.
const running = new Map();   // boardId -> { next, promise }

export function refreshShareCard(args) {
  const boardId = args?.boardId;
  if (!boardId || !args.supabase) return Promise.resolve(false);
  const cur = running.get(boardId);
  if (cur) { cur.next = args; return cur.promise; }
  const slot = { next: null, promise: null };
  slot.promise = (async () => {
    let ok = false;
    let a = args;
    try {
      while (a) {
        slot.next = null;
        try { ok = await refreshOnce(a); } catch (_) { ok = false; }
        a = slot.next;
      }
    } finally {
      running.delete(boardId);
    }
    return ok;
  })();
  running.set(boardId, slot);
  return slot.promise;
}

// What the Share panel and the copy buttons call: choose the pictures, then
// refresh. Resolves quietly whatever happens.
export async function refreshShareCardFor({ supabase, boardId, name, ydoc = null } = {}) {
  try {
    const { imageUrls, imageKeys } = await collectShareCardImages({ boardId, ydoc });
    return await refreshShareCard({ supabase, boardId, name, imageUrls, imageKeys });
  } catch (_) {
    return false;
  }
}
