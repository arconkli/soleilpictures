// Canvas2D renderer for sub-board thumbnails.
//
// Round 21 — replaces Round 20's `buildSvgString` → `<img src=data:svg+xml>`
// approach. The SVG-data-URL trick worked beautifully for the perf problem
// (the browser treats the img as a bitmap and GPU-stretches on zoom — no
// re-raster cost), but SVGs loaded as <img> can't fetch external resources,
// so cross-origin image cards rendered as placeholder rects.
//
// This module draws the same primitives to a real <canvas> instead. The
// canvas can load external images via cross-origin <img>; the output is a
// real PNG/WebP blob that the browser also treats as a cached bitmap.
// Best of both worlds: photos render, zoom stays smooth.
//
// Returns a blob: URL (caller is responsible for revokeObjectURL).

import { resolveSrc, cachedUrl } from './r2.js';
import {
  computeArrowAttachments, buildArrowPath, arrowHeadPolygon,
  arrowStrokeWidth, arrowHeadSize, arrowHeadStyle,
} from './arrowGeometry.js';

// Reused from BoardThumbnail.jsx (Round 20). Kept in sync deliberately —
// any visual change should touch both files until Round 22 deprecates
// BoardThumbnail's SVG fallback.
const KIND_FILL = {
  image:    '#3b82f6',
  note:     '#fde68a',
  link:     '#a78bfa',
  doc:      '#cbd5e1',
  palette:  '#34d399',
  shape:    '#94a3b8',
  schedule: '#f472b6',
  board:    '#3a3a44',
  boardlink:'#3a3a44',
};

function labelForCard(c, boards) {
  if (!c) return '';
  if (c.kind === 'board')     return boards?.[c.id]?.name || 'Board';
  if (c.kind === 'boardlink') return boards?.[c.target]?.name || 'Linked';
  if (c.kind === 'link')      return c.title || c.source || 'Link';
  if (c.kind === 'note') {
    if (c.html) {
      const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
      if (tmp) {
        tmp.innerHTML = c.html;
        const t = (tmp.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (t) return t;
      }
    }
    if (c.body) return String(c.body).replace(/\s+/g, ' ').trim().slice(0, 40);
    return '';
  }
  if (c.kind === 'image')    return c.title || c.label || '';
  if (c.kind === 'palette')  return c.title || 'Palette';
  if (c.kind === 'doc')      return c.title || 'Doc';
  if (c.kind === 'schedule') return c.title || 'Schedule';
  return '';
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
// Cheap and stable; not collision-proof but fine for change detection.
export function quickVisualHash(cards, strokes, arrows) {
  let h = quickHashCards(cards, strokes);
  for (let i = 0; i < (arrows || []).length; i++) {
    const a = arrows[i] || {};
    h += `a${i}:${JSON.stringify(a.from)},${JSON.stringify(a.to)},${a.color || ''},`
       + `${a.customStroke || ''},${a.thickness || ''},${a.straight ? 1 : 0},${a.head || ''},${a.label || ''}|`;
  }
  // Note bodies/colors aren't in quickHashCards (it only samples title/src);
  // fold them in so an edited note re-renders.
  for (const c of (cards || [])) {
    if (c?.kind === 'note') h += `n${c.id}:${(c.html || c.body || '').length},${c.bgColor || ''},${c.textColor || ''}|`;
  }
  return h;
}

// ── "more faithful" rendering helpers (Round 23: stored previews) ─────────

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
  // buildDrawPlan already resolves attachments to fold endpoints into the
  // bounds; reuse them here instead of recomputing the same fan-out.
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
// font. Preserves explicit newlines.
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
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

// Pick a readable note text color: explicit textColor wins; else contrast
// against the note's fill (light fill → dark ink, dark fill → light ink).
function readableNoteTextColor(bgHex, explicit) {
  if (explicit) return explicit;
  const rgb = _hexToRgb(bgHex);
  if (!rgb) return '#e8e8ea';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.6 ? '#1f1d1a' : '#e8e8ea';
}

// In-memory cache of rendered thumbnails. Keyed by quickHash(cards,strokes).
// Values: blob URL strings. Capped to avoid leak.
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

// Resolve an r2: src to a presigned URL. Synchronous if cached; otherwise
// awaits the async resolveSrc. Returns null on failure.
async function resolveImageUrl(src) {
  if (!src || typeof src !== 'string') return null;
  if (!src.startsWith('r2:')) return src; // already a URL or data: scheme
  const cached = cachedUrl(src);
  if (cached) return cached;
  try { return await resolveSrc(src); } catch (_) { return null; }
}

// Load a remote URL into an HTMLImageElement with CORS enabled so we can
// drawImage it to a canvas without tainting. On any failure (network,
// CORS, decode) returns null and the caller falls back to a placeholder.
function loadCorsImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Draw the placeholder rect for an image card that didn't load (matches
// the visual the SVG path used in Round 20).
function drawImagePlaceholder(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#3a322a';
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#5a4a32';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

// Roughly truncate a label to fit within `w` at the given font size. Same
// formula buildSvgString used in Round 20.
function fitLabel(label, fontSize, w) {
  const max = Math.floor(w / (fontSize * 0.55));
  if (!label) return '';
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

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
  // cards stays in frame (cards alone used to define the bounds, which
  // clipped any drawing/arrow outside the card cluster).
  for (const s of strokes || []) {
    if (!s || !Array.isArray(s.points)) continue;
    for (const p of s.points) if (Array.isArray(p)) ext(p[0], p[1]);
  }
  // Arrows — resolve attachments ONCE here (threaded into drawArrows below
  // so we don't compute them twice) and fold both resolved endpoints so
  // connectors and arrowheads stay in frame too.
  let arrowPlacements = null;
  if (arrows && arrows.length) {
    arrowPlacements = computeArrowAttachments(arrows, buildArrowCtx(cards));
    for (const pl of arrowPlacements) {
      if (pl?.from?.point) ext(pl.from.point.x, pl.from.point.y);
      if (pl?.to?.point)   ext(pl.to.point.x,   pl.to.point.y);
    }
  }
  if (!isFinite(minX)) return null;

  // fontSize keys off the TRUE content span (pre-margin) so labels keep a
  // sane size on small boards.
  const fontSize = Math.max(12, Math.min(Math.max(1, maxX - minX), Math.max(1, maxY - minY)) * 0.04);
  // Uniform breathing-room margin so nothing renders flush to the tile edge.
  // planToBlob preserves aspect ratio, so a uniform board-space margin stays
  // visually uniform in the output.
  const margin = Math.max(Math.min(maxX - minX, maxY - minY) * 0.04, 24);
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  // Sort cards by z (matches BoardCard render order).
  const sorted = (cards || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));

  return { sorted, strokes: strokes || [], arrows: arrows || [], arrowPlacements, minX, minY, contentW, contentH, fontSize, boards };
}

// Async: render the plan to a real canvas, encode as a blob. Two-phase:
// first kick off all image loads in parallel, then draw everything in
// order. Returns a Blob URL or null.
async function planToBlob(plan, { width, height, allowImages }) {
  const { sorted, strokes, arrows, arrowPlacements, minX, minY, contentW, contentH, fontSize, boards } = plan;

  // Choose canvas size to preserve aspect ratio inside the target box.
  const contentAspect = contentW / contentH;
  const targetAspect = width / height;
  let canvasW = width;
  let canvasH = height;
  if (contentAspect > targetAspect) {
    canvasH = Math.round(width / contentAspect);
  } else {
    canvasW = Math.round(height * contentAspect);
  }
  // Devicepixelratio bump for sharpness on hidpi displays. Cap at 2 to
  // keep the bitmap reasonable on 3x screens.
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(canvasW * dpr));
  canvas.height = Math.max(1, Math.round(canvasH * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Scale so all subsequent draw calls use canvas-space coords directly.
  ctx.scale((canvas.width) / contentW, (canvas.height) / contentH);
  ctx.translate(-minX, -minY);
  // Backing px per board unit — used to floor thin arrow strokes so they
  // stay visible at fit-to-content scale.
  const pxPerUnit = canvas.width / contentW;

  // Pre-load all image cards in parallel before drawing, so they appear
  // in the rendered output. Failed loads fall back to placeholder.
  const imageMap = new Map(); // card.id → HTMLImageElement | null
  if (allowImages) {
    const loadJobs = [];
    for (const c of sorted) {
      if (c.kind === 'image' && c.src) {
        loadJobs.push((async () => {
          const url = await resolveImageUrl(c.src);
          if (!url) return;
          const img = await loadCorsImage(url);
          if (img) imageMap.set(c.id, img);
        })());
      }
    }
    await Promise.all(loadJobs);
  }

  // Default font.
  ctx.textBaseline = 'top';

  // Now draw everything in z-order.
  for (const c of sorted) {
    const x = c.x, y = c.y, w = c.w || 100, h = c.h || 100;

    if (c.kind === 'image' && c.src) {
      const img = imageMap.get(c.id);
      if (img) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        // preserveAspectRatio="xMidYMid slice" equivalent — crop-fill.
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const targetAR = w / h;
        const srcAR = iw / ih;
        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (srcAR > targetAR) {
          sw = ih * targetAR;
          sx = (iw - sw) / 2;
        } else {
          sh = iw / targetAR;
          sy = (ih - sh) / 2;
        }
        try {
          ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        } catch (e) {
          // CORS taint detected — bail and let the caller retry without
          // images. Don't continue drawing; we're already poisoned.
          ctx.restore();
          throw new Error('TAINT');
        }
        ctx.restore();
      } else {
        drawImagePlaceholder(ctx, x, y, w, h);
      }
      // Image label.
      const lbl = (c.title || c.label) ? labelForCard(c, boards) : '';
      if (lbl) {
        ctx.save();
        ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineWidth = fontSize * 0.25;
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#f5f5f6';
        const textY = y + h - 8 - fontSize;
        ctx.strokeText(lbl, x + 8, textY);
        ctx.fillText(lbl, x + 8, textY);
        ctx.restore();
      }
      continue;
    }

    if (c.kind === 'shape') {
      const fill = c.fill && c.fill !== 'transparent' ? c.fill : null;
      const stroke = c.stroke || '#999';
      const strokeWidth = (c.strokeWidth || 2) * 2;
      ctx.save();
      ctx.lineWidth = strokeWidth;
      if (c.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        ctx.strokeStyle = stroke;
        ctx.stroke();
      } else {
        if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
      continue;
    }

    if (c.kind === 'note') {
      // Faithful note: painted rounded rect + wrapped real text, clipped to
      // the card. Text color honors c.textColor, else auto-contrasts.
      const bg = (c.bgColor && c.bgColor !== 'transparent') ? c.bgColor : '#262626';
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = bg;
      if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); }
      else ctx.fillRect(x, y, w, h);
      ctx.restore();

      const text = extractNoteText(c);
      if (text) {
        const padX = Math.min(12, w * 0.08);
        const padY = Math.min(12, h * 0.08);
        const innerW = Math.max(1, w - padX * 2);
        const noteFont = Math.max(10, fontSize * 0.95);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + padX, y + padY, innerW, Math.max(1, h - padY * 2));
        ctx.clip();
        ctx.font = `400 ${noteFont}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = readableNoteTextColor(bg, c.textColor);
        ctx.textBaseline = 'top';
        const lineH = noteFont * 1.32;
        let ty = y + padY;
        const bottom = y + h - padY;
        for (const line of wrapText(ctx, text, innerW)) {
          if (ty > bottom) break;
          if (line) ctx.fillText(line, x + padX, ty);
          ty += lineH;
        }
        ctx.restore();
      }
      continue;
    }

    // Default: rect + optional badge + label.
    const fill = c.kind === 'note' ? (c.bgColor || '#262626') : (KIND_FILL[c.kind] || '#3a3a3f');
    const isBoardKind = c.kind === 'board' || c.kind === 'boardlink';
    const labelFill = c.kind === 'note' ? '#1f1d1a' : isBoardKind ? '#f5f5f6' : '#0a0a0c';
    const opacity = c.kind === 'note' ? 0.95 : 0.9;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill;
    // Rounded rect — Canvas2D has roundRect in modern browsers; fall back.
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 5);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();

    if (isBoardKind) {
      const badgeW = Math.max(20, fontSize * 1.4);
      const badgeH = fontSize * 0.9;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(x + 8, y + 8, badgeW, badgeH);
      ctx.restore();
    }

    const lbl = labelForCard(c, boards);
    if (lbl) {
      const display = fitLabel(lbl, fontSize, w);
      ctx.save();
      ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = labelFill;
      ctx.fillText(display, x + 12, y + 12);
      ctx.restore();
    }
  }

  // Arrows / connectors — drawn above cards, below freehand strokes.
  drawArrows(ctx, arrows, sorted, pxPerUnit, arrowPlacements);

  // Strokes overlay.
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = s.color || '#fff';
    ctx.lineWidth = (s.width || 3) * 2;
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

  // Encode. Prefer WebP for size; PNG fallback. Browsers reject the call
  // for tainted canvases with a SecurityError — caller retries with
  // allowImages=false.
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('toBlob returned null'));
      }, 'image/webp', 0.85);
    } catch (e) {
      reject(e);
    }
  });
  return blob;
}

// Core renderer: returns a raw Blob (WebP) with a CORS-tainted fallback to
// placeholder rects. No caching — callers that upload the bytes use this
// directly (the URL cache below is only for the live <img> thumbnails).
//   { cards, strokes, arrows, boards, width, height } → Promise<Blob | null>
export async function renderThumbnailBlob({ cards, strokes, arrows, boards = {}, width = 800, height = 600 } = {}) {
  const plan = buildDrawPlan(cards, strokes, arrows, boards);
  if (!plan) return null;
  try {
    return await planToBlob(plan, { width, height, allowImages: true });
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
        return await planToBlob(plan, { width, height, allowImages: false });
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
// in-memory cache keyed by content hash + dims. Wraps renderThumbnailBlob.
//   { cards, strokes, arrows, boards, width, height } → Promise<blobUrl | null>
export async function renderThumbnailToBlob({ cards, strokes, arrows, boards = {}, width = 800, height = 600 } = {}) {
  if ((!cards || cards.length === 0) && (!strokes || strokes.length === 0)) return null;

  // Cache key includes target dims so different consumers can ask for
  // different sizes without colliding. Arrows fold into the hash too.
  const key = `${width}x${height}:${quickVisualHash(cards, strokes, arrows)}`;
  const hit = _cacheGet(key);
  if (hit) return hit;

  const blob = await renderThumbnailBlob({ cards, strokes, arrows, boards, width, height });
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  _cacheSet(key, url);
  return url;
}
