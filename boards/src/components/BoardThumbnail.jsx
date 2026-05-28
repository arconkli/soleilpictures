// Mini render of a board's contents — used inside BoardCard's cover.
//
// Round 20 rewrite: renders to an <img> element backed by a data URL of
// the SVG instead of inline JSX SVG. Why: when the canvas zooms in, the
// browser was re-rasterizing inline-SVG content at HIGH_RESOLUTION for
// 300-700 ms per tile (the user's reported "first-zoom hitch" and
// continuing hitches in Rounds 17-19). An <img> backed by SVG-data-URL
// gets rasterized once when the img loads; subsequent canvas zooms just
// GPU-stretch the cached bitmap (cheap). Trade-off: minor blur at
// extreme zoom (>500%); the user has consistently prioritized
// smoothness over pixel-sharpness across 19 rounds.

import { memo, useMemo } from 'react';
import { cachedUrl } from '../lib/r2.js';

// XML attribute escape — labels coming from user-named boards / cards
// can contain &, <, >, " which would break the SVG markup if inlined raw.
function xmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// XML text-node escape (no quote handling needed inside text content).
function xmlText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
    // Notes: title from the first words of the body (HTML preferred so
    // formatting + headings show up in plaintext form). Manual title is
    // intentionally not consulted — the listing should reflect content.
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

// Build the SVG markup as a string. Translates the same primitives the
// pre-Round-20 JSX produced. The returned string is base64-encoded and
// stuffed into an <img src="data:image/svg+xml;base64,..."> element.
function buildSvgString(cards, strokes, boards) {
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
  const viewBox = `${minX} ${minY} ${contentW} ${contentH}`;
  // Label font size tracks the viewBox so text is legible at thumbnail scale.
  const fontSize = Math.max(12, Math.min(contentW, contentH) * 0.04);

  let body = '';
  for (const c of (cards || [])) {
    const x = c.x, y = c.y, w = c.w || 100, h = c.h || 100;

    if (c.kind === 'image' && c.src) {
      // Image cards: use the synchronously-cached presigned R2 URL when
      // available (useBoardPreview pre-warms these per Round 11). If not
      // cached yet, draw the same placeholder rect ThumbImage used to.
      let url = null;
      try { url = cachedUrl(c.src); } catch (_) {}
      const label = (c.title || c.label) ? labelForCard(c, boards) : '';
      body += `<g>`;
      if (url) {
        body += `<image x="${x}" y="${y}" width="${w}" height="${h}" `
              + `href="${xmlAttr(url)}" preserveAspectRatio="xMidYMid slice" opacity="0.95"/>`;
      } else {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" `
              + `fill="#3a322a" stroke="#5a4a32" stroke-width="1" opacity="0.55"/>`;
      }
      if (label) {
        const strokeW = (fontSize * 0.25).toFixed(2);
        body += `<text x="${x + 8}" y="${y + h - 8}" font-size="${fontSize}" font-weight="600" `
              + `fill="#f5f5f6" paint-order="stroke" stroke="rgba(0,0,0,.55)" stroke-width="${strokeW}">`
              + xmlText(label) + `</text>`;
      }
      body += `</g>`;
      continue;
    }

    if (c.kind === 'shape') {
      const fill = c.fill && c.fill !== 'transparent' ? c.fill : 'none';
      const stroke = c.stroke || '#999';
      const strokeWidth = (c.strokeWidth || 2) * 2;
      if (c.shape === 'ellipse') {
        body += `<ellipse cx="${x + w/2}" cy="${y + h/2}" rx="${w/2}" ry="${h/2}" `
              + `fill="${xmlAttr(fill)}" stroke="${xmlAttr(stroke)}" stroke-width="${strokeWidth}"/>`;
      } else {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" `
              + `fill="${xmlAttr(fill)}" stroke="${xmlAttr(stroke)}" stroke-width="${strokeWidth}"/>`;
      }
      continue;
    }

    // Default: filled rect + optional inner board-badge + optional label.
    const fill = c.kind === 'note' ? (c.bgColor || '#262626') : (KIND_FILL[c.kind] || '#3a3a3f');
    const label = labelForCard(c, boards);
    const isBoardKind = c.kind === 'board' || c.kind === 'boardlink';
    const labelFill = c.kind === 'note'
      ? '#1f1d1a'
      : isBoardKind ? '#f5f5f6' : '#0a0a0c';
    const opacity = c.kind === 'note' ? 0.95 : 0.9;
    body += `<g>`;
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" `
          + `fill="${xmlAttr(fill)}" opacity="${opacity}"/>`;
    if (isBoardKind) {
      const badgeW = Math.max(20, fontSize * 1.4);
      const badgeH = fontSize * 0.9;
      body += `<rect x="${x + 8}" y="${y + 8}" width="${badgeW}" height="${badgeH}" rx="2" `
            + `fill="rgba(255,255,255,.08)"/>`;
    }
    if (label) {
      const maxChars = Math.floor(w / (fontSize * 0.55));
      const display = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
      body += `<text x="${x + 12}" y="${y + 12 + fontSize}" font-size="${fontSize}" font-weight="600" `
            + `fill="${xmlAttr(labelFill)}" letter-spacing="-0.01em">`
            + xmlText(display) + `</text>`;
    }
    body += `</g>`;
  }

  for (const s of (strokes || [])) {
    if (!s.points || s.points.length < 2) continue;
    let d = `M${s.points[0][0]},${s.points[0][1]}`;
    for (let j = 1; j < s.points.length; j++) d += ` L${s.points[j][0]},${s.points[j][1]}`;
    const color = s.color || '#fff';
    const strokeWidth = (s.width || 3) * 2;
    body += `<path d="${xmlAttr(d)}" fill="none" stroke="${xmlAttr(color)}" `
          + `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" `
       + `preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

// btoa requires Latin-1; handle Unicode labels by UTF-8 encoding first.
function toBase64Utf8(s) {
  try {
    return btoa(unescape(encodeURIComponent(s)));
  } catch (_) {
    return null;
  }
}

function BoardThumbnailImpl({ cards, strokes, boards = {} }) {
  const dataUrl = useMemo(() => {
    const svg = buildSvgString(cards, strokes, boards);
    if (!svg) return null;
    const b64 = toBase64Utf8(svg);
    if (!b64) return null;
    return `data:image/svg+xml;base64,${b64}`;
  }, [cards, strokes, boards]);

  if (!dataUrl) return null;
  return (
    <img
      className="bc-thumb"
      src={dataUrl}
      alt=""
      draggable={false}
      // alt is intentional empty — decorative.
    />
  );
}

// Memoized. cards / strokes / boards come from useBoardPreview's cache —
// stable refs unless the underlying data changes — so the default
// shallow compare prevents re-renders when CanvasSurface re-renders for
// unrelated reasons (pan, presence ticks).
export const BoardThumbnail = memo(BoardThumbnailImpl);
