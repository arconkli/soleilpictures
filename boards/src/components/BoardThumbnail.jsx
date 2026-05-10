// Mini render of a board's contents — used inside BoardCard's cover.
// Cards are positioned proportionally inside a fixed aspect-ratio container.
// Board / boardlink cards render their target name as a label so the parent
// thumbnail reads as "what's inside" instead of anonymous gray boxes.

import { useEffect, useState } from 'react';
import { cachedUrl, resolveSrc } from '../lib/r2.js';

// Image cells in thumbnails used to render `<image href={c.src}>` directly,
// which fails for `r2:<key>` references because they're not real URLs.
// `cachedUrl` returns the signed URL synchronously when warmed by prefetch
// or a previous full-board render; on a cold miss we fire `resolveSrc`
// to populate the cache and re-render. While unresolved we draw a warm
// placeholder rect so missing images don't read as broken icons.
function ThumbImage({ x, y, w, h, src, fontSize, label, labelFill }) {
  const [url, setUrl] = useState(() => cachedUrl(src));
  useEffect(() => {
    if (url) return;
    let cancelled = false;
    resolveSrc(src).then(u => { if (!cancelled && u) setUrl(u); });
    return () => { cancelled = true; };
  }, [src, url]);

  return (
    <g>
      {url ? (
        <image x={x} y={y} width={w} height={h}
               href={url}
               preserveAspectRatio="xMidYMid slice"
               opacity={0.95} />
      ) : (
        <rect x={x} y={y} width={w} height={h} rx={3}
              fill="#3a322a" stroke="#5a4a32" strokeWidth={1} opacity={0.55} />
      )}
      {label && (
        <text x={x + 8} y={y + h - 8}
              fontSize={fontSize} fontWeight={600}
              fill={labelFill || '#f5f5f6'}
              style={{ paintOrder: 'stroke' }}
              stroke="rgba(0,0,0,.55)" strokeWidth={fontSize * 0.25}>
          {label}
        </text>
      )}
    </g>
  );
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

export function BoardThumbnail({ cards, strokes, boards = {} }) {
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

  return (
    <svg className="bc-thumb" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      {(cards || []).map(c => {
        const x = c.x, y = c.y, w = c.w || 100, h = c.h || 100;
        if (c.kind === 'image' && c.src) {
          return (
            <ThumbImage key={c.id}
                        x={x} y={y} w={w} h={h}
                        src={c.src}
                        fontSize={fontSize}
                        label={(c.title || c.label) ? labelForCard(c, boards) : ''} />
          );
        }
        if (c.kind === 'shape') {
          if (c.shape === 'ellipse') {
            return <ellipse key={c.id} cx={x + w/2} cy={y + h/2} rx={w/2} ry={h/2}
                            fill={c.fill && c.fill !== 'transparent' ? c.fill : 'none'}
                            stroke={c.stroke || '#999'}
                            strokeWidth={(c.strokeWidth || 2) * 2} />;
          }
          return <rect key={c.id} x={x} y={y} width={w} height={h}
                       fill={c.fill && c.fill !== 'transparent' ? c.fill : 'none'}
                       stroke={c.stroke || '#999'}
                       strokeWidth={(c.strokeWidth || 2) * 2} />;
        }
        const fill = c.kind === 'note' ? (c.bgColor || '#262626') : (KIND_FILL[c.kind] || '#3a3a3f');
        const label = labelForCard(c, boards);
        const isBoardKind = c.kind === 'board' || c.kind === 'boardlink';
        const labelFill = c.kind === 'note'
          ? '#1f1d1a'
          : isBoardKind ? '#f5f5f6' : '#0a0a0c';
        return (
          <g key={c.id}>
            <rect x={x} y={y} width={w} height={h} rx={5}
                  fill={fill} opacity={c.kind === 'note' ? 0.95 : 0.9} />
            {isBoardKind && (
              <rect x={x + 8} y={y + 8} width={Math.max(20, fontSize * 1.4)} height={fontSize * 0.9}
                    rx={2}
                    fill="rgba(255,255,255,.08)" />
            )}
            {label && (
              <text x={x + 12} y={y + 12 + fontSize}
                    fontSize={fontSize} fontWeight={600}
                    fill={labelFill}
                    style={{
                      letterSpacing: '-0.01em',
                    }}>
                {label.length > Math.floor(w / (fontSize * 0.55))
                  ? label.slice(0, Math.floor(w / (fontSize * 0.55)) - 1) + '…'
                  : label}
              </text>
            )}
          </g>
        );
      })}
      {(strokes || []).map((s, i) => {
        if (!s.points || s.points.length < 2) return null;
        let d = `M${s.points[0][0]},${s.points[0][1]}`;
        for (let j = 1; j < s.points.length; j++) d += ` L${s.points[j][0]},${s.points[j][1]}`;
        return <path key={'s'+i} d={d} fill="none"
                     stroke={s.color || '#fff'}
                     strokeWidth={(s.width || 3) * 2}
                     strokeLinecap="round" strokeLinejoin="round"
                     opacity={0.85} />;
      })}
    </svg>
  );
}
