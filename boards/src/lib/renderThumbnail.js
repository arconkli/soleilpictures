// Canvas2D renderer for board thumbnails — a faithful miniature screenshot
// of the canvas, not an abstract approximation.
//
// v2 (thumbnail rework): the output is a fixed 16:9 frame painted with the
// board's real background (bg_color or --bg-0) and the canvas dot grid,
// with every card drawn using the live UI's actual tokens and geometry —
// same radii, shadows, fonts, paddings and type sizes, all in BOARD UNITS
// so text can never overflow a card the way the old content-scaled font
// sizing did. Strokes/shape outlines render 1:1 with the live canvas
// (the old renderer doubled them). The frame is letterboxed around the
// content on the canvas background, like a zoomed-out screenshot.
//
// History: Round 20 built this as an SVG string; Round 21 moved to real
// canvas so cross-origin images render; Round 23 started storing the
// output to R2 (boards.thumb_key). RENDER_VERSION below gates the stored
// artifacts — bump it whenever the visual output changes materially so
// stale thumbs self-heal (see useThumbnailBackfill).
//
// Returns a blob: URL (caller is responsible for revokeObjectURL).

import { resolveSrc, cachedUrl } from './r2.js';
import { loadCorsCleanImage } from './corsImage.js';
import {
  computeArrowAttachments, buildArrowPath, arrowHeadPolygon,
  arrowStrokeWidth, arrowHeadSize, arrowHeadStyle,
} from './arrowGeometry.js';
import { paletteLayout, readableInk, hasCustomName } from './paletteLayout.js';

// Bump when the rendered output changes materially. Stored thumbnails carry
// this in boards.thumb_version; tiles re-render stale versions in the
// background (useThumbnailBackfill) so the new look rolls out lazily.
export const RENDER_VERSION = 3;

// Output frame: 16:9 ≈ both the grid tile cover and OG's 1.91:1. Fixed
// supersample (NOT device DPR) so the stored artifact is deterministic
// regardless of which client rendered it.
const FRAME_W = 1200;
const FRAME_H = 675;
const SUPERSAMPLE = 2;
// Never render content larger than 1.5× logical zoom — a one-note board
// should read as a note on a canvas, not a wall of 80px text.
const MAX_ZOOM = 1.5;

// ── Design tokens (concrete-hex mirrors of styles.css :root, dark theme).
// Thumbnails are shared artifacts (one per board, all viewers) so they
// always render with the dark canvas tokens; an explicit board bg_color
// wins over bg0.
const T = {
  bg0: '#0a0a0c', bg1: '#111114', bg2: '#16161a', bg3: '#1c1c20',
  line1: '#212126', line2: '#2c2c32', line3: '#3a3a40',
  ink0: '#f5f5f7', ink1: '#d0d0d4', ink2: '#888890', ink3: '#5a5a60',
  gridDot: 'rgba(245,245,247,.05)',
};
const FONT_SANS = 'aileron, -apple-system, system-ui, sans-serif';
const FONT_DISPLAY = 'brandon-grotesque, Impact, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
// Note cards expose a fontFamily option; map the stored keys to stacks.
function noteFontStack(fam) {
  if (fam === 'mono') return FONT_MONO;
  if (fam === 'display') return FONT_DISPLAY;
  if (fam === 'serif') return 'Georgia, "Times New Roman", serif';
  return FONT_SANS;
}

function labelForCard(c, boards) {
  if (!c) return '';
  if (c.kind === 'board')     return boards?.[c.id]?.name || 'Board';
  if (c.kind === 'boardlink') return boards?.[c.target]?.name || 'Linked board';
  if (c.kind === 'link')      return c.title || c.source || 'Link';
  if (c.kind === 'image')     return c.title || c.label || '';
  if (c.kind === 'pdf')       return c.name || c.title || 'PDF';
  if (c.kind === 'palette')   return c.title || 'Palette';
  if (c.kind === 'doc')       return c.title || 'Doc';
  if (c.kind === 'schedule')  return c.title || 'Schedule';
  return c.title || c.label || '';
}

// Quick stable hash over a card array. Used as in-memory cache key so a
// React effect re-firing with reference-new but content-identical data
// doesn't re-render the canvas. Uses ids + a few hot fields per card; not
// a perfect hash but cheap and good enough for cache short-circuiting.
function quickHashCards(cards, strokes) {
  let h = `${cards?.length || 0}|${strokes?.length || 0}|`;
  for (const c of (cards || [])) {
    h += `${c.id || ''}:${c.x || 0},${c.y || 0},${c.w || 0},${c.h || 0},${c.kind || ''},${c.title || ''},${c.src || ''}|`;
  }
  for (let i = 0; i < (strokes || []).length; i++) {
    const s = strokes[i];
    h += `s${i}:${s.points?.length || 0},${s.color || ''}|`;
  }
  return h;
}

// Public content hash including arrows — used by the snapshot generator
// (yboard.js) to skip re-uploading a thumbnail when nothing visual changed.
// `extra` lets callers fold render inputs that live outside the doc (board
// bg_color); RENDER_VERSION is folded so a renderer upgrade re-renders.
export function quickVisualHash(cards, strokes, arrows, extra = '') {
  let h = `v${RENDER_VERSION}|${extra}|` + quickHashCards(cards, strokes);
  for (let i = 0; i < (arrows || []).length; i++) {
    const a = arrows[i] || {};
    h += `a${i}:${JSON.stringify(a.from)},${JSON.stringify(a.to)},${a.color || ''},`
       + `${a.customStroke || ''},${a.thickness || ''},${a.straight ? 1 : 0},${a.head || ''},${a.label || ''}|`;
  }
  // Note bodies/colors and palette swatches/flags aren't in quickHashCards
  // (it only samples title/src); fold them in so an edited note or recolored
  // palette re-renders instead of serving a stale thumbnail.
  for (const c of (cards || [])) {
    if (c?.kind === 'note') h += `n${c.id}:${(c.html || c.body || '').length},${c.bgColor || ''},${c.textColor || ''},${c.fontSize || ''}|`;
    else if (c?.kind === 'palette') h += `p${c.id}:${(c.swatches || []).map((s) => `${s?.hex || s?.color || s || ''}${s?.name || ''}`).join('~')},${c.chipsOnly ? 1 : 0},${c.hideHex ? 1 : 0},${c.hideLabels ? 1 : 0}|`;
  }
  return h;
}

// ── Arrow helpers (unchanged from v1 — arrows already rendered faithfully) ──

// Concrete-hex mirror of arrowGeometry's COLOR_TOKENS. Canvas2D can't parse
// the `var(--…)` strings arrowColor() returns, so we resolve tokens to hex
// here. `ink` ≈ --ink-2. Custom hex (shape-tool lines) is honored directly.
const ARROW_HEX = {
  ink: '#888890', red: '#ef4444', orange: '#f59e0b',
  green: '#10b981', blue: '#3b82f6', purple: '#a855f7',
};
function resolveArrowColorHex(a) {
  if (typeof a.customStroke === 'string' && a.customStroke.startsWith('#')) return a.customStroke;
  const c = a.color;
  if (typeof c === 'string' && c.startsWith('#')) return c;
  return ARROW_HEX[c] || ARROW_HEX.ink;
}

// Card ids to exclude from obstacle avoidance for an arrow endpoint — the
// anchor card itself, or all members of an anchored group. Mirrors
// CanvasSurface.excludedCardIdsForRef.
function excludedIds(ref, cards) {
  if (!ref) return [];
  if (typeof ref === 'string') return [ref];
  if (ref.type === 'card' && ref.id) return [ref.id];
  if (ref.type === 'group' && ref.id) return cards.filter(c => c.groupId === ref.id).map(c => c.id);
  return [];
}

// Build the {cardById, resolveGroupBBox} context arrowGeometry needs, from a
// plain cards array (no DOM / Y.Doc). Group bbox derived from card.groupId,
// matching CanvasSurface.groupBoundsById.
function buildArrowCtx(cards) {
  const cardById = {};
  for (const c of cards || []) cardById[c.id] = c;
  const gb = {};
  for (const c of cards || []) {
    if (!c.groupId) continue;
    const g = gb[c.groupId] || (gb[c.groupId] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    g.minX = Math.min(g.minX, c.x);
    g.minY = Math.min(g.minY, c.y);
    g.maxX = Math.max(g.maxX, c.x + (c.w || 100));
    g.maxY = Math.max(g.maxY, c.y + (c.h || 100));
  }
  return {
    cardById,
    resolveGroupBBox: (gid) => {
      const g = gb[gid];
      return g && isFinite(g.minX) ? { x: g.minX, y: g.minY, w: g.maxX - g.minX, h: g.maxY - g.minY } : null;
    },
  };
}

function fillTriangle(ctx, ptsStr) {
  const pts = ptsStr.split(' ').map(p => p.split(',').map(Number));
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.closePath();
  ctx.fill();
}

// Draw all arrows in board-space (ctx is already board→canvas scaled).
// `pxPerUnit` = backing canvas px per board unit; used to floor thin arrows
// so they stay visible at fit-to-content scale.
function drawArrows(ctx, arrows, cards, pxPerUnit, precomputedPlacements) {
  if (!arrows || !arrows.length) return;
  const placements = precomputedPlacements || computeArrowAttachments(arrows, buildArrowCtx(cards));
  const obstacleRects = (cards || []).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w || 100, h: c.h || 100 }));
  const MIN_PX = 1.6;
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i] || {};
    const att = placements[i];
    if (!att || !att.from || !att.to) continue;
    const anchorIds = new Set([...excludedIds(a.from, cards), ...excludedIds(a.to, cards)]);
    const obstacles = a.straight ? null
      : obstacleRects.map(r => (anchorIds.has(r.id) ? { ...r, pad: 1 } : r));
    let built = null;
    try { built = buildArrowPath({ from: att.from, to: att.to, style: { straight: !!a.straight }, obstacles }); }
    catch (_) { built = null; }
    if (!built) continue;
    const { path, fromTangentIn, toTangentIn } = built;
    const stroke = resolveArrowColorHex(a);
    const baseSw = (typeof a.customStrokeWidth === 'number' && a.customStrokeWidth >= 0)
      ? Math.max(0.5, a.customStrokeWidth) : arrowStrokeWidth(a.thickness);
    const sw = Math.max(baseSw, MIN_PX / (pxPerUnit || 1));
    const k = sw / baseSw;
    const hd0 = arrowHeadSize(a.thickness);
    const hd = { size: hd0.size * k, width: hd0.width * k };
    const headStyle = arrowHeadStyle(a);
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (a.customDash === 'dashed' || a.dashed) ctx.setLineDash([sw * 4, sw * 3]);
    else if (a.customDash === 'dotted') ctx.setLineDash([sw, sw * 2]);
    let p2d = null;
    try { p2d = new Path2D(path); } catch (_) { p2d = null; }
    if (p2d) ctx.stroke(p2d);
    ctx.setLineDash([]);
    ctx.fillStyle = stroke;
    if (headStyle !== 'none') fillTriangle(ctx, arrowHeadPolygon(att.to.point, toTangentIn, hd));
    if (headStyle === 'double') fillTriangle(ctx, arrowHeadPolygon(att.from.point, fromTangentIn, hd));
    ctx.restore();
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────

// Plain text from a note card. Block elements become newlines so wrapped
// paragraphs survive. Falls back to legacy `body`.
function extractNoteText(c) {
  if (c.html && typeof document !== 'undefined') {
    const tmp = document.createElement('div');
    tmp.innerHTML = c.html;
    tmp.querySelectorAll('p,div,li,br,h1,h2,h3').forEach(el => {
      try { el.insertAdjacentText('afterend', '\n'); } catch (_) {}
    });
    return (tmp.textContent || '').replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim();
  }
  return (c.body ? String(c.body) : '').trim();
}

// Word-wrap `text` to lines no wider than `maxWidth` using the ctx's current
// font. Preserves explicit newlines. Long unbroken words are character-split
// (live CSS uses overflow-wrap: anywhere).
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      let test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
      if (line) { lines.push(line); line = ''; }
      // Word alone is too wide — split by characters.
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Trim `text` with a measured ellipsis so it fits in maxWidth at the
// ctx's current font. Replaces the old `w/(fontSize*0.55)` guess that
// caused labels to spill outside their cards.
function truncateToWidth(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '…';
}

// Draw wrapped text clipped to a box, ellipsizing the last visible line
// instead of clipping glyphs mid-row. Assumes ctx.font/fillStyle are set
// and textBaseline = 'top'. Returns nothing; caller saves/restores.
function drawWrappedText(ctx, text, x, y, maxWidth, maxHeight, lineH) {
  const lines = wrapText(ctx, text, maxWidth);
  const maxLines = Math.max(1, Math.floor(maxHeight / lineH));
  const n = Math.min(lines.length, maxLines);
  for (let i = 0; i < n; i++) {
    let line = lines[i];
    if (i === n - 1 && lines.length > maxLines) line = truncateToWidth(ctx, line + '…', maxWidth);
    if (line) ctx.fillText(line, x, y + i * lineH);
  }
}

function _hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return 0;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

// Pick a readable note text color: explicit textColor wins; else contrast
// against the note's fill (light fill → dark ink, dark fill → light ink).
// Matches the live `.note.is-light-bg` behavior.
function readableNoteTextColor(bgHex, explicit) {
  if (explicit) return explicit;
  return luminance(bgHex) > 0.6 ? T.bg0 : T.ink0;
}

// ── Geometry helpers ─────────────────────────────────────────────────────

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

// The live `.card` wrapper: 8px-radius surface + shadow-1 + overflow:hidden.
// Returns with the clip ACTIVE — caller draws the interior then restores.
// Canvas2D shadow params are device-px (not CTM-scaled), so scale by ppu.
function beginCard(ctx, x, y, w, h, ppu, { fill = T.bg3, shadow = true, radius = 8 } = {}) {
  ctx.save();
  if (fill) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.33)';
      ctx.shadowBlur = 6 * ppu;
      ctx.shadowOffsetY = 2 * ppu;
    }
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
}
function endCard(ctx) { ctx.restore(); }

// 1px (board-unit) inner border, like the .ic/.lc/.blc card borders.
function innerBorder(ctx, x, y, w, h, r, color, { dashed = false } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (dashed) ctx.setLineDash([4, 3]);
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, r - 0.5));
  ctx.stroke();
  ctx.restore();
}

// Small "pill" tag (image caption, BOARD badge, VIDEO placeholder). Draws at
// (x,y) top-left; returns the pill width.
function drawPill(ctx, text, x, y, { font = `600 11.5px ${FONT_SANS}`, color = T.ink0, bg = 'rgba(10,10,12,.75)', padX = 8, padY = 3, radius = 4 } = {}) {
  ctx.save();
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const fontPx = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || '11');
  const pw = tw + padX * 2;
  const ph = fontPx + padY * 2;
  ctx.fillStyle = bg;
  roundRectPath(ctx, x, y, pw, ph, radius);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + padX, y + padY + fontPx * 0.08);
  ctx.restore();
  return pw;
}

// ── Image loading (unchanged) ────────────────────────────────────────────

// Resolve an r2: src to a presigned URL. Synchronous if cached; otherwise
// awaits the async resolveSrc. Returns null on failure.
async function resolveImageUrl(src) {
  if (!src || typeof src !== 'string') return null;
  if (!src.startsWith('r2:')) return src; // already a URL or data: scheme
  const cached = cachedUrl(src);
  if (cached) return cached;
  try { return await resolveSrc(src); } catch (_) { return null; }
}

// Load a remote URL into an HTMLImageElement we can drawImage to a canvas
// without tainting. Delegates to loadCorsCleanImage — a cache-bypassing
// fetch → blob, NOT an <img crossOrigin> load (see lib/corsImage.js).
function loadCorsImage(url) {
  if (!url) return Promise.resolve(null);
  return loadCorsCleanImage(url);
}

// Crop-fill (object-fit: cover) an image into a rect. Throws 'TAINT' via
// caller's try/catch if the canvas got poisoned.
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const targetAR = w / h;
  const srcAR = iw / ih;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (srcAR > targetAR) { sw = ih * targetAR; sx = (iw - sw) / 2; }
  else { sh = iw / targetAR; sy = (ih - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// ── In-memory cache of rendered thumbnails (blob URLs) ───────────────────
const _cache = new Map();
const _CACHE_MAX = 200;
let _cacheTaintWarned = false;

function _cacheGet(key) {
  return _cache.get(key) || null;
}
function _cacheSet(key, url) {
  if (_cache.size >= _CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest) {
      const old = _cache.get(oldest);
      try { URL.revokeObjectURL(old); } catch (_) {}
      _cache.delete(oldest);
    }
  }
  _cache.set(key, url);
}

// ── Per-kind interior renderers ──────────────────────────────────────────
// Every function draws INSIDE an active beginCard clip, in board units.
// (x,y,w,h) is the card rect; ppu = device px per board unit (for shadow /
// min-stroke scaling only — geometry stays in board units).

function drawNoteInterior(ctx, c, x, y, w, h) {
  const text = extractNoteText(c);
  if (!text) return;
  const pad = 14;
  const fontPx = (typeof c.fontSize === 'number' && c.fontSize > 0) ? c.fontSize : 15;
  const isTransparent = c.bgColor === 'transparent';
  const bg = (c.bgColor && !isTransparent) ? c.bgColor : T.bg0;
  ctx.save();
  ctx.font = `400 ${fontPx}px ${noteFontStack(c.fontFamily)}`;
  ctx.fillStyle = readableNoteTextColor(isTransparent ? T.bg0 : bg, c.textColor);
  ctx.textBaseline = 'top';
  drawWrappedText(ctx, text, x + pad, y + pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2), fontPx * 1.5);
  ctx.restore();
}

function drawImageInterior(ctx, c, x, y, w, h, img) {
  const titleH = c.title ? 26 : 0;
  const imgH = Math.max(1, h - titleH);
  if (img) {
    drawCover(ctx, img, x, y, w, imgH);
  } else {
    // Neutral placeholder (replaces the old brown rect): quiet surface +
    // subtle border, like an .ic that hasn't loaded yet.
    ctx.fillStyle = T.bg2;
    ctx.fillRect(x, y, w, imgH);
  }
  if (c.caption) {
    ctx.save();
    ctx.font = `600 11.5px ${FONT_SANS}`;
    const capMax = w - 16 - 16;
    if (capMax > 12) drawPill(ctx, truncateToWidth(ctx, String(c.caption), capMax), x + 8, y + 8);
    ctx.restore();
  }
  if (titleH) {
    ctx.save();
    ctx.fillStyle = T.bg3;
    ctx.fillRect(x, y + imgH, w, titleH);
    ctx.strokeStyle = T.line1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + imgH + 0.5);
    ctx.lineTo(x + w, y + imgH + 0.5);
    ctx.stroke();
    ctx.font = `500 11.5px ${FONT_SANS}`;
    ctx.fillStyle = T.ink1;
    ctx.textBaseline = 'top';
    ctx.fillText(truncateToWidth(ctx, String(c.title), w - 20), x + 10, y + imgH + 7);
    ctx.restore();
  }
}

function hostOf(source) {
  if (!source) return '';
  try { return new URL(source.startsWith('http') ? source : `https://${source}`).hostname.replace(/^www\./, ''); }
  catch (_) { return String(source); }
}

function drawLinkInterior(ctx, c, x, y, w, h, img) {
  // Embed links (YouTube/Spotify/…): live renders an iframe; the closest
  // honest still is a black frame + provider name.
  if (c.embed && c.embed.embedUrl && !img) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.font = `600 11px ${FONT_MONO}`;
    ctx.fillStyle = T.ink3;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(String(c.embed.provider || 'embed').toUpperCase(), x + w / 2, y + h / 2);
    ctx.restore();
    return;
  }

  const pad = 14;
  if (img) {
    // Preview layout: image on top, meta block pinned to the bottom.
    const metaH = Math.min(h * 0.42, 52);
    const imgH = Math.max(1, h - metaH);
    drawCover(ctx, img, x, y, w, imgH);
    ctx.fillStyle = T.bg3;
    ctx.fillRect(x, y + imgH, w, metaH);
    ctx.save();
    ctx.strokeStyle = T.line1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + imgH + 0.5);
    ctx.lineTo(x + w, y + imgH + 0.5);
    ctx.stroke();
    ctx.font = `500 13px ${FONT_SANS}`;
    ctx.fillStyle = T.ink0;
    ctx.textBaseline = 'top';
    ctx.fillText(truncateToWidth(ctx, c.title || c.source || 'Link', w - pad * 2), x + pad, y + imgH + 9);
    ctx.font = `400 10px ${FONT_MONO}`;
    ctx.fillStyle = T.ink3;
    const host = hostOf(c.source);
    if (host && metaH > 36) ctx.fillText(truncateToWidth(ctx, host, w - pad * 2), x + pad, y + imgH + 9 + 18);
    ctx.restore();
    return;
  }

  // Text-only link card.
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `500 13px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  drawWrappedText(ctx, c.title || c.source || 'Link', x + pad, y + pad, w - pad * 2, 13 * 1.35 * 2, 13 * 1.35);
  if (c.description) {
    ctx.font = `400 11px ${FONT_SANS}`;
    ctx.fillStyle = T.ink2;
    const descY = y + pad + 13 * 1.35 * 2 + 6;
    const room = (y + h - 22) - descY;
    if (room > 12) drawWrappedText(ctx, String(c.description), x + pad, descY, w - pad * 2, room, 11 * 1.4);
  }
  const host = hostOf(c.source);
  if (host) {
    ctx.font = `400 10px ${FONT_MONO}`;
    ctx.fillStyle = T.ink3;
    ctx.fillText(truncateToWidth(ctx, host, w - pad * 2), x + pad, y + h - pad - 10);
  }
  ctx.restore();
}

function drawBoardLinkInterior(ctx, c, x, y, w, h, boards) {
  const pad = 14;
  ctx.save();
  ctx.textBaseline = 'top';
  // Eyebrow: "LINKED BOARD" — display stack, letterspaced.
  ctx.font = `700 10px ${FONT_DISPLAY}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
  ctx.fillStyle = T.ink3;
  ctx.fillText(truncateToWidth(ctx, 'LINKED BOARD', w - pad * 2), x + pad, y + pad);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  // Name.
  ctx.font = `600 14px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  ctx.fillText(truncateToWidth(ctx, labelForCard(c, boards), w - pad * 2), x + pad, y + pad + 18);
  // Optional note.
  if (c.note) {
    ctx.font = `400 12px ${FONT_SANS}`;
    ctx.fillStyle = T.ink2;
    const noteY = y + pad + 18 + 22;
    const room = (y + h - 30) - noteY;
    if (room > 12) drawWrappedText(ctx, String(c.note), x + pad, noteY, w - pad * 2, room, 12 * 1.4);
  }
  // Footer: meta row pinned to the bottom.
  if (h > 70) {
    ctx.strokeStyle = T.line1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + pad, y + h - 26.5);
    ctx.lineTo(x + w - pad, y + h - 26.5);
    ctx.stroke();
    ctx.font = `400 10px ${FONT_MONO}`;
    ctx.fillStyle = T.ink3;
    ctx.fillText('Board', x + pad, y + h - 19);
    ctx.fillStyle = T.ink1;
    ctx.textAlign = 'right';
    ctx.fillText('→', x + w - pad, y + h - 19);
    ctx.restore();
    return;
  }
  ctx.restore();
}

function drawBoardInterior(ctx, c, x, y, w, h, boards) {
  const board = boards?.[c.id];
  const metaH = Math.min(44, h * 0.36);
  const coverH = Math.max(1, h - metaH);
  // Cover region: the board's own bg color (like .bc-thumb-wrap).
  ctx.fillStyle = board?.bg_color || T.bg2;
  ctx.fillRect(x, y, w, coverH);
  if (coverH > 26 && w > 60) {
    drawPill(ctx, 'BOARD', x + 10, y + 10, {
      font: `700 9px ${FONT_DISPLAY}`, color: T.ink1, bg: 'rgba(10,10,12,.7)', padX: 7, padY: 3,
    });
  }
  // Meta strip.
  ctx.save();
  ctx.fillStyle = T.bg3;
  ctx.fillRect(x, y + coverH, w, metaH);
  ctx.strokeStyle = T.line1;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + coverH + 0.5);
  ctx.lineTo(x + w, y + coverH + 0.5);
  ctx.stroke();
  ctx.font = `600 13px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  ctx.textBaseline = 'top';
  ctx.fillText(truncateToWidth(ctx, labelForCard(c, boards), w - 28), x + 14, y + coverH + (metaH - 13) / 2 - 1);
  ctx.restore();
}

function drawPaletteInterior(ctx, c, x, y, w, h) {
  const swatches = (Array.isArray(c.swatches) ? c.swatches : [])
    .map((s) => (typeof s === 'string' ? { hex: s } : (s || {})))
    .map((s) => ({ hex: s.hex || s.color, name: s.name }))
    .filter((s) => !!s.hex);
  const n = swatches.length;
  if (!n) return;

  // Mode/orientation come from the card's REAL (board-unit) size — via the
  // SAME paletteLayout the live card uses — so the thumbnail shows the same
  // bands-vs-chips look, just scaled into this rect. Labels are gated on the
  // drawn slot size so we never paint unreadable micro-text.
  const pureColor = !!c.chipsOnly || (!!c.hideHex && !!c.hideLabels);
  const L = paletteLayout(c.w || w, c.h || h, n, { pureColor });
  const vert = L.orient === 'vert';
  const isBands = L.mode === 'bands';
  const headerShown = L.showHead && !c.hideLabels && h >= 64;
  const wantHex = L.showHex && !c.hideHex;
  const wantName = wantHex && L.showName;

  ctx.save();

  // Header strip (title only).
  let top = y, areaH = h;
  if (headerShown) {
    const headPadX = isBands ? 11 : 14;
    ctx.font = `600 13px ${FONT_SANS}`;
    ctx.fillStyle = T.ink0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncateToWidth(ctx, c.title || 'Palette', w - headPadX * 2), x + headPadX, y + 7);
    top = y + 24;
    areaH = h - 24;
  }

  // Swatch area. Chips (non-pure) keep card padding + gaps; bands/pure bleed.
  const pad = (!isBands && !pureColor) ? 12 : 0;
  const gap = isBands ? 0 : 6;
  const ax = x + pad;
  const ay = top + (headerShown ? 0 : pad);
  const aw = w - pad * 2;
  const ah = areaH - (headerShown ? 0 : pad) - pad;
  if (aw <= 0 || ah <= 0) { ctx.restore(); return; }

  const mainLen = vert ? aw : ah;
  const slot = (mainLen - gap * (n - 1)) / n;
  const radius = isBands ? 0 : Math.min(7, slot / 2);

  for (let i = 0; i < n; i++) {
    const s = swatches[i];
    const off = i * (slot + gap);
    const cw = vert ? slot : aw;
    const ch = vert ? ah : slot;
    const cx = vert ? ax + off : ax;
    const cy = vert ? ay : ay + off;
    if (cw <= 0.5 || ch <= 0.5) continue;

    ctx.fillStyle = s.hex;
    if (radius > 0) { roundRectPath(ctx, cx, cy, cw, ch, radius); ctx.fill(); }
    else ctx.fillRect(cx, cy, cw, ch);
    if (!isBands) {
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, cx + 0.5, cy + 0.5, cw - 1, ch - 1, Math.max(0, radius - 0.5));
      ctx.stroke();
    }

    // Overlaid labels — only when the slot is big enough to read.
    const canFitText = cw >= 26 && ch >= 13;
    if (!canFitText || (!wantHex && !wantName)) continue;
    const named = wantName && hasCustomName(s.name);
    const ink = readableInk(s.hex);
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.shadowColor = ink === '#f5f5f7' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)';
    ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
    const midX = cx + cw / 2;
    const midY = cy + ch / 2;
    if (named && wantHex && ch >= 26) {
      ctx.font = `600 11px ${FONT_SANS}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(truncateToWidth(ctx, s.name, cw - 6), midX, midY - 1);
      ctx.font = `400 10px ${FONT_MONO}`;
      ctx.textBaseline = 'top';
      ctx.fillText(truncateToWidth(ctx, String(s.hex).toUpperCase(), cw - 6), midX, midY + 1);
    } else if (named) {
      ctx.font = `600 11px ${FONT_SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateToWidth(ctx, s.name, cw - 6), midX, midY);
    } else if (wantHex) {
      ctx.font = `400 10px ${FONT_MONO}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateToWidth(ctx, String(s.hex).toUpperCase(), cw - 6), midX, midY);
    }
    ctx.restore();
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

function drawDocInterior(ctx, c, x, y, w, h) {
  const pad = 14;
  ctx.save();
  ctx.textBaseline = 'top';
  // Header: tiny doc glyph + title.
  ctx.strokeStyle = T.ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + pad + 1, y + pad + 1);
  ctx.lineTo(x + pad + 1, y + pad + 12);
  ctx.moveTo(x + pad + 1, y + pad + 1);
  ctx.lineTo(x + pad + 9, y + pad + 1);
  ctx.moveTo(x + pad + 1, y + pad + 12);
  ctx.lineTo(x + pad + 9, y + pad + 12);
  ctx.moveTo(x + pad + 9, y + pad + 1);
  ctx.lineTo(x + pad + 9, y + pad + 12);
  ctx.stroke();
  ctx.font = `500 12.5px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  ctx.fillText(truncateToWidth(ctx, c.title || 'Doc', w - pad * 2 - 16), x + pad + 16, y + pad);
  let cy = y + pad + 24;
  const lines = Array.isArray(c.lines) ? c.lines : null;
  if (lines) {
    for (const l of lines) {
      if (cy > y + h - pad - 12) break;
      const isObj = l && typeof l === 'object';
      const t = isObj ? (l.t || l.text || '') : String(l ?? '');
      if (!t) { cy += 8; continue; }
      if (isObj && l.h === 1) { ctx.font = `600 14px ${FONT_SANS}`; ctx.fillStyle = T.ink0; }
      else if (isObj && l.h === 3) { ctx.font = `500 11px ${FONT_MONO}`; ctx.fillStyle = T.ink2; }
      else { ctx.font = `400 11.5px ${FONT_SANS}`; ctx.fillStyle = T.ink1; }
      const prefix = isObj && l.bullet ? '· ' : '';
      ctx.fillText(truncateToWidth(ctx, prefix + t, w - pad * 2), x + pad, cy);
      cy += (isObj && l.h === 1 ? 20 : 16);
    }
  } else {
    // Rich docs carry no preview lines in the snapshot — placeholder bars
    // so the card still reads as "a document".
    ctx.fillStyle = '#26262a';
    const barW = w - pad * 2;
    for (let i = 0; i < 4 && cy + 7 < y + h - pad; i++) {
      roundRectPath(ctx, x + pad, cy, barW * (i === 3 ? 0.55 : 0.92 - i * 0.06), 7, 2);
      ctx.fill();
      cy += 15;
    }
  }
  ctx.restore();
}

function drawScheduleInterior(ctx, c, x, y, w, h) {
  const pad = 12;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `500 12px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  ctx.fillText(truncateToWidth(ctx, c.title || 'Schedule', w - pad * 2), x + pad, y + pad);
  let cy = y + pad + 22;
  const rows = Array.isArray(c.rows) ? c.rows : [];
  for (let i = 0; i < rows.length; i++) {
    if (cy > y + h - pad - 12) break;
    const r = rows[i] || {};
    ctx.font = `500 10.5px ${FONT_MONO}`;
    ctx.fillStyle = T.ink3;
    ctx.fillText(truncateToWidth(ctx, String(r.day || r.when || ''), 34), x + pad, cy + 1);
    ctx.font = `400 11.5px ${FONT_SANS}`;
    ctx.fillStyle = T.ink1;
    const whatMax = w - pad * 2 - 42 - 50;
    ctx.fillText(truncateToWidth(ctx, String(r.what || r.title || ''), Math.max(20, whatMax)), x + pad + 40, cy);
    if (r.loc) {
      ctx.font = `400 10px ${FONT_MONO}`;
      ctx.fillStyle = T.ink3;
      ctx.textAlign = 'right';
      ctx.fillText(truncateToWidth(ctx, String(r.loc), 48), x + w - pad, cy + 1);
      ctx.textAlign = 'left';
    }
    cy += 24;
    if (i < rows.length - 1 && cy - 8 < y + h - pad) {
      ctx.strokeStyle = T.line1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + pad, cy - 8.5);
      ctx.lineTo(x + w - pad, cy - 8.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Shapes: free-floating SVG primitives, no card chrome, no shadow. Geometry
// mirrors ShapeCard's 100×100 viewBox with preserveAspectRatio=none; stroke
// is vector-effect: non-scaling-stroke ≈ board units at zoom 1, drawn 1:1.
const SHAPE_POINTS = {
  diamond:  [[50, 3], [97, 50], [50, 97], [3, 50]],
  triangle: [[50, 5], [95, 90], [5, 90]],
  hexagon:  [[25, 7], [75, 7], [95, 50], [75, 93], [25, 93], [5, 50]],
  star:     [[50, 5], [61, 38], [95, 38], [67, 58], [78, 92], [50, 72], [22, 92], [33, 58], [5, 38], [39, 38]],
};
function drawShape(ctx, c, x, y, w, h, ppu) {
  const shape = c.shape || 'rect';
  const isStrokeOnly = shape === 'line' || shape === 'arrow';
  let sw = (typeof c.strokeWidth === 'number') ? c.strokeWidth : 2;
  if (sw === 0 && isStrokeOnly) sw = 1;
  const hasStroke = sw > 0;
  const minSw = 1.2 / (ppu || 1);
  const drawSw = hasStroke ? Math.max(sw, minSw) : 0;
  const stroke = c.stroke || '#f5f5f6';
  const fill = (c.fill && c.fill !== 'transparent') ? c.fill : null;
  const dash = c.dash === 'dashed' ? [6, 4] : c.dash === 'dotted' ? [2, 3] : null;
  const nx = (px) => x + (px / 100) * w;
  const ny = (py) => y + (py / 100) * h;
  ctx.save();
  ctx.lineWidth = drawSw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);

  if (shape === 'line') {
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(nx(0), ny(0));
    ctx.lineTo(nx(100), ny(100));
    ctx.stroke();
  } else if (shape === 'arrow') {
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(nx(2), ny(50));
    ctx.lineTo(nx(92), ny(50));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx(80), ny(30));
    ctx.lineTo(nx(95), ny(50));
    ctx.lineTo(nx(80), ny(70));
    ctx.stroke();
  } else if (shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2 - sw / 2), Math.max(1, h / 2 - sw / 2), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (hasStroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  } else if (SHAPE_POINTS[shape]) {
    const pts = SHAPE_POINTS[shape];
    ctx.beginPath();
    ctx.moveTo(nx(pts[0][0]), ny(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(nx(pts[i][0]), ny(pts[i][1]));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (hasStroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  } else {
    // rect (default)
    const inset = sw / 2;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x + inset, y + inset, Math.max(1, w - sw), Math.max(1, h - sw)); }
    if (hasStroke) { ctx.strokeStyle = stroke; ctx.strokeRect(x + inset, y + inset, Math.max(1, w - sw), Math.max(1, h - sw)); }
  }
  ctx.setLineDash([]);
  // Centered label (fillable shapes only — mirrors ShapeCard).
  if (c.label && !isStrokeOnly) {
    ctx.font = `500 12px ${FONT_SANS}`;
    ctx.fillStyle = T.ink0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncateToWidth(ctx, String(c.label), w - 12), x + w / 2, y + h / 2);
  }
  ctx.restore();
}

function drawVideoInterior(ctx, c, x, y, w, h) {
  const titleH = c.title ? 26 : 0;
  const regionH = Math.max(1, h - titleH);
  ctx.fillStyle = T.bg2;
  ctx.fillRect(x, y, w, regionH);
  if (w > 60 && regionH > 30) {
    ctx.save();
    ctx.font = `600 10px ${FONT_MONO}`;
    const pw = ctx.measureText('VIDEO').width + 16;
    drawPill(ctx, 'VIDEO', x + (w - pw) / 2, y + regionH / 2 - 8, {
      font: `600 10px ${FONT_MONO}`, color: T.ink2, bg: 'rgba(10,10,12,.7)',
    });
    ctx.restore();
  }
  if (titleH) {
    ctx.save();
    ctx.fillStyle = T.bg3;
    ctx.fillRect(x, y + regionH, w, titleH);
    ctx.font = `500 11.5px ${FONT_SANS}`;
    ctx.fillStyle = T.ink1;
    ctx.textBaseline = 'top';
    ctx.fillText(truncateToWidth(ctx, String(c.title), w - 20), x + 10, y + regionH + 7);
    ctx.restore();
  }
}

function drawArtInterior(ctx, c, x, y, w, h, ppu) {
  ctx.fillStyle = c.bg || '#ffffff';
  ctx.fillRect(x, y, w, h);
  drawLocalStrokes(ctx, c.strokes, x, y, ppu);
}

// Card-local strokes (art cards + any card with a CardStrokesOverlay).
// Points are card-local coords; ctx is board-space, so offset by the card.
function drawLocalStrokes(ctx, strokes, offX, offY, ppu) {
  if (!Array.isArray(strokes)) return;
  for (const s of strokes) {
    if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = s.color || '#f5f5f6';
    ctx.lineWidth = Math.max(s.width || 3, 1.2 / (ppu || 1));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(offX + s.points[0][0], offY + s.points[0][1]);
    for (let j = 1; j < s.points.length; j++) ctx.lineTo(offX + s.points[j][0], offY + s.points[j][1]);
    ctx.stroke();
    ctx.restore();
  }
}

function drawGenericInterior(ctx, c, x, y, w, h, boards) {
  const lbl = labelForCard(c, boards);
  if (!lbl) return;
  ctx.save();
  ctx.font = `500 13px ${FONT_SANS}`;
  ctx.fillStyle = T.ink0;
  ctx.textBaseline = 'top';
  ctx.fillText(truncateToWidth(ctx, lbl, w - 28), x + 14, y + 14);
  ctx.restore();
}

// ── Plan + render ────────────────────────────────────────────────────────

// Build the actual draw plan synchronously (bounds + per-card ops) so we
// can do the async image loading in parallel up front, then draw in z-order.
function buildDrawPlan(cards, strokes, arrows, boards) {
  if ((!cards || cards.length === 0) && (!strokes || strokes.length === 0)) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const c of cards || []) {
    if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
    ext(c.x, c.y);
    ext(c.x + (c.w || 100), c.y + (c.h || 100));
  }
  // Freehand strokes — fold every point so a stroke extending past the
  // cards stays in frame.
  for (const s of strokes || []) {
    if (!s || !Array.isArray(s.points)) continue;
    for (const p of s.points) if (Array.isArray(p)) ext(p[0], p[1]);
  }
  // Arrows — resolve attachments ONCE here (threaded into drawArrows below)
  // and fold both resolved endpoints so connectors stay in frame too.
  let arrowPlacements = null;
  if (arrows && arrows.length) {
    arrowPlacements = computeArrowAttachments(arrows, buildArrowCtx(cards));
    for (const pl of arrowPlacements) {
      if (pl?.from?.point) ext(pl.from.point.x, pl.from.point.y);
      if (pl?.to?.point)   ext(pl.to.point.x,   pl.to.point.y);
    }
  }
  if (!isFinite(minX)) return null;

  // Breathing-room margin so content doesn't sit flush against the frame
  // even before letterboxing kicks in.
  const margin = Math.max(Math.min(maxX - minX, maxY - minY) * 0.04, 24);
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  // Sort cards by z (matches BoardCard render order).
  const sorted = (cards || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));

  return { sorted, strokes: strokes || [], arrows: arrows || [], arrowPlacements, minX, minY, contentW, contentH, boards };
}

// Async: render the plan to a real canvas, encode as a blob. Two-phase:
// first kick off all image loads in parallel, then draw everything in
// z-order. Returns a Blob or null.
async function planToBlob(plan, { width, height, allowImages, bgColor }) {
  const { sorted, strokes, arrows, arrowPlacements, minX, minY, contentW, contentH, boards } = plan;

  // Wait for webfonts once so the first thumbnails don't bake fallback
  // glyphs (resolved instantly after initial page load).
  try { await document.fonts.ready; } catch (_) {}

  const ss = SUPERSAMPLE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ss));
  canvas.height = Math.max(1, Math.round(height * ss));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Fit content into the frame; clamp zoom so tiny boards don't blow up.
  // Extreme-aspect boards (a long horizontal strip of cards) shouldn't
  // letterbox down to a sliver either — zoom until the content fills at
  // least MIN_FILL of the frame's minor axis and center-crop the major
  // axis instead, like a screenshot framing the middle of the board.
  const fitW = canvas.width / contentW;
  const fitH = canvas.height / contentH;
  let pxPerUnit = Math.min(fitW, fitH);
  const MIN_FILL = 0.62;   // content should fill ≥ this much of the minor axis…
  const MAX_CROP = 0.55;   // …but keep at least this fraction of the major axis visible
  if (pxPerUnit < MIN_FILL * Math.max(fitW, fitH)) {
    const cropLimit = (fitW < fitH)
      ? canvas.width / (contentW * MAX_CROP)
      : canvas.height / (contentH * MAX_CROP);
    pxPerUnit = Math.min(MIN_FILL * Math.max(fitW, fitH), cropLimit);
  }
  pxPerUnit = Math.min(pxPerUnit, MAX_ZOOM * ss);
  const offX = (canvas.width - contentW * pxPerUnit) / 2;
  const offY = (canvas.height - contentH * pxPerUnit) / 2;

  // ── Canvas background: bg_color (or --bg-0) + the dot grid. The live
  // grid lives on .canvas-wrap in SCREEN px (it doesn't scale with zoom),
  // so we draw it in frame-space: 24 logical px spacing, 1px dots.
  ctx.fillStyle = bgColor || T.bg0;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gridStep = 24 * ss;
  const dotR = 1 * ss;
  ctx.fillStyle = T.gridDot;
  ctx.beginPath();
  for (let gx = gridStep / 2; gx < canvas.width; gx += gridStep) {
    for (let gy = gridStep / 2; gy < canvas.height; gy += gridStep) {
      ctx.moveTo(gx + dotR, gy);
      ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // Board-space transform: all card/stroke/arrow drawing below uses board
  // units directly.
  ctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, offX - minX * pxPerUnit, offY - minY * pxPerUnit);

  // Pre-load all image cards (and link previews) in parallel before drawing.
  const imageMap = new Map(); // card.id → HTMLImageElement | null
  if (allowImages) {
    const loadJobs = [];
    for (const c of sorted) {
      const src = (c.kind === 'image' && c.src) ? c.src
        : (c.kind === 'pdf' && c.src) ? c.src
        : (c.kind === 'link' && c.image) ? c.image
        : null;
      if (!src) continue;
      loadJobs.push((async () => {
        const url = await resolveImageUrl(src);
        if (!url) return;
        const img = await loadCorsImage(url);
        if (img) imageMap.set(c.id, img);
      })());
    }
    await Promise.all(loadJobs);
  }

  ctx.textBaseline = 'top';

  // Draw everything in z-order. Each card = live `.card` wrapper (8px round
  // rect + shadow-1 + clip) with a kind-specific interior; shapes skip the
  // wrapper entirely (matches .card-kind-shape { box-shadow: none }).
  for (const c of sorted) {
    const x = c.x, y = c.y, w = c.w || 100, h = c.h || 100;
    const ppu = pxPerUnit;
    try {
      if (c.kind === 'shape') {
        drawShape(ctx, c, x, y, w, h, ppu);
        continue;
      }
      if (c.kind === 'note') {
        const isTransparent = c.bgColor === 'transparent';
        const fill = isTransparent ? null : (c.bgColor || T.bg0);
        beginCard(ctx, x, y, w, h, ppu, { fill, shadow: !isTransparent });
        drawNoteInterior(ctx, c, x, y, w, h);
        endCard(ctx);
        continue;
      }
      if (c.kind === 'image') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawImageInterior(ctx, c, x, y, w, h, imageMap.get(c.id) || null);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'video') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawVideoInterior(ctx, c, x, y, w, h);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'pdf') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        const thumb = imageMap.get(c.id) || null;
        if (thumb) drawImageInterior(ctx, c, x, y, w, h, thumb);
        else drawGenericInterior(ctx, c, x, y, w, h, boards);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'link') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawLinkInterior(ctx, c, x, y, w, h, imageMap.get(c.id) || null);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'boardlink') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawBoardLinkInterior(ctx, c, x, y, w, h, boards);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line3, { dashed: true });
        continue;
      }
      if (c.kind === 'board') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawBoardInterior(ctx, c, x, y, w, h, boards);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'palette') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawPaletteInterior(ctx, c, x, y, w, h);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'doc') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawDocInterior(ctx, c, x, y, w, h);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'schedule') {
        beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
        drawScheduleInterior(ctx, c, x, y, w, h);
        endCard(ctx);
        innerBorder(ctx, x, y, w, h, 8, T.line2);
        continue;
      }
      if (c.kind === 'art') {
        beginCard(ctx, x, y, w, h, ppu, { fill: null, shadow: false });
        drawArtInterior(ctx, c, x, y, w, h, ppu);
        endCard(ctx);
        continue;
      }
      // audio + anything unknown: quiet generic card with a label.
      beginCard(ctx, x, y, w, h, ppu, { fill: T.bg3 });
      drawGenericInterior(ctx, c, x, y, w, h, boards);
      endCard(ctx);
      innerBorder(ctx, x, y, w, h, 8, T.line2);
    } catch (e) {
      // CORS taint poisons the whole canvas — bail so the caller retries
      // without images. Anything else: skip just this card.
      if (e && e.message === 'TAINT') throw e;
      if (String(e?.name) === 'SecurityError') throw new Error('TAINT');
    }
    // Card-local stroke overlays (annotations drawn ON a card).
    if (c.kind !== 'art' && Array.isArray(c.strokes) && c.strokes.length) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, 8);
      ctx.clip();
      drawLocalStrokes(ctx, c.strokes, x, y, pxPerUnit);
      ctx.restore();
    }
  }

  // Arrows / connectors — drawn above cards, below freehand strokes.
  drawArrows(ctx, arrows, sorted, pxPerUnit, arrowPlacements);

  // Freehand strokes overlay — 1:1 with the live canvas (width as stored,
  // full opacity), floored so they stay visible at fit-to-content scale.
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = s.color || '#f5f5f6';
    ctx.lineWidth = Math.max(s.width || 3, 1.2 / pxPerUnit);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let j = 1; j < s.points.length; j++) {
      ctx.lineTo(s.points[j][0], s.points[j][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Encode. Prefer WebP for size; browsers reject the call for tainted
  // canvases with a SecurityError — caller retries with allowImages=false.
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('toBlob returned null'));
      }, 'image/webp', 0.8);
    } catch (e) {
      reject(e);
    }
  });
  return blob;
}

// Core renderer: returns a raw Blob (WebP) with a CORS-tainted fallback to
// placeholder rects. No caching — callers that upload the bytes use this
// directly (the URL cache below is only for the live <img> thumbnails).
//   { cards, strokes, arrows, boards, bgColor, width, height } → Promise<Blob | null>
export async function renderThumbnailBlob({ cards, strokes, arrows, boards = {}, bgColor = null, width = FRAME_W, height = FRAME_H } = {}) {
  const plan = buildDrawPlan(cards, strokes, arrows, boards);
  if (!plan) return null;
  try {
    return await planToBlob(plan, { width, height, allowImages: true, bgColor });
  } catch (e) {
    if (e && e.message === 'TAINT') {
      if (!_cacheTaintWarned) {
        _cacheTaintWarned = true;
        console.warn(
          '[renderThumbnail] CORS taint detected on a board image — falling back to placeholder rects. '
          + 'To fix, configure CORS on the R2 bucket so images can be drawn to canvas.',
        );
      }
      try {
        return await planToBlob(plan, { width, height, allowImages: false, bgColor });
      } catch (e2) {
        console.warn('[renderThumbnail] fallback render also failed', e2?.message || e2);
        return null;
      }
    }
    console.warn('[renderThumbnail] render failed', e?.message || e);
    return null;
  }
}

// Public entry for live <img> thumbnails. Renders to a blob URL with an
// in-memory cache keyed by content hash + dims + bg. Wraps renderThumbnailBlob.
//   { cards, strokes, arrows, boards, bgColor, width, height } → Promise<blobUrl | null>
export async function renderThumbnailToBlob({ cards, strokes, arrows, boards = {}, bgColor = null, width = FRAME_W, height = FRAME_H } = {}) {
  if ((!cards || cards.length === 0) && (!strokes || strokes.length === 0)) return null;

  const key = `${width}x${height}:${quickVisualHash(cards, strokes, arrows, bgColor || '')}`;
  const hit = _cacheGet(key);
  if (hit) return hit;

  const blob = await renderThumbnailBlob({ cards, strokes, arrows, boards, bgColor, width, height });
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  _cacheSet(key, url);
  return url;
}
