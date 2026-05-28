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
function buildDrawPlan(cards, strokes, boards) {
  if ((!cards || cards.length === 0) && (!strokes || strokes.length === 0)) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards || []) {
    if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + (c.w || 100));
    maxY = Math.max(maxY, c.y + (c.h || 100));
  }
  if (!isFinite(minX)) return null;
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const fontSize = Math.max(12, Math.min(contentW, contentH) * 0.04);

  // Sort cards by z (matches BoardCard render order).
  const sorted = (cards || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));

  return { sorted, strokes: strokes || [], minX, minY, contentW, contentH, fontSize, boards };
}

// Async: render the plan to a real canvas, encode as a blob. Two-phase:
// first kick off all image loads in parallel, then draw everything in
// order. Returns a Blob URL or null.
async function planToBlobUrl(plan, { width, height, allowImages }) {
  const { sorted, strokes, minX, minY, contentW, contentH, fontSize, boards } = plan;

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
  return URL.createObjectURL(blob);
}

// Public entry. Renders to a blob URL with cache + CORS-tainted fallback.
//   { cards, strokes, boards, width, height } → Promise<blobUrl | null>
export async function renderThumbnailToBlob({ cards, strokes, boards = {}, width = 800, height = 600 } = {}) {
  const plan = buildDrawPlan(cards, strokes, boards);
  if (!plan) return null;

  // Cache key includes target dims so different consumers can ask for
  // different sizes without colliding.
  const key = `${width}x${height}:${quickHashCards(cards, strokes)}`;
  const hit = _cacheGet(key);
  if (hit) return hit;

  try {
    const url = await planToBlobUrl(plan, { width, height, allowImages: true });
    if (url) _cacheSet(key, url);
    return url;
  } catch (e) {
    if (e && e.message === 'TAINT') {
      if (!_cacheTaintWarned) {
        _cacheTaintWarned = true;
        console.warn(
          '[renderThumbnail] CORS taint detected on a board image — falling back to placeholder rects. '
          + 'To fix, configure CORS on the R2 bucket so images can be drawn to canvas. '
          + 'Round 22 will queue server-rendered thumbnails as the long-term fix.',
        );
      }
      try {
        const url = await planToBlobUrl(plan, { width, height, allowImages: false });
        if (url) _cacheSet(key, url);
        return url;
      } catch (e2) {
        console.warn('[renderThumbnail] fallback render also failed', e2?.message || e2);
        return null;
      }
    }
    console.warn('[renderThumbnail] render failed', e?.message || e);
    return null;
  }
}
