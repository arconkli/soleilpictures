// Tiny, theme-aware schematic "marks" for card kinds that have no cheap real
// thumbnail (grid / doc / schedule / shape / note / link). Grid / doc / schedule
// / shape are pure SVG (viewBox scales perfectly from the ~40px table thumb to
// the large gallery tile); note / link are HTML (real text + favicon). The goal
// isn't beauty — it's that every row is identifiable "from its little mark"
// instead of falling to a generic glyph.
import { useState } from 'react';
import { ShapeGlyph, KindIcon } from '../cards.jsx';
import { Icon } from '../Icon.jsx';
import { Link as LinkIcon } from '../../lib/icons.js';
import { contrastRatio } from '../../lib/readableColor.js';

// ── Grid ────────────────────────────────────────────────────────────────────
// The subdivision, drawn from normalized cell rects (0–1 box). A filled cell =
// has media, a lighter fill = other content, an outline = empty — so the layout
// (2×2, sidebar+main, …) reads at a glance. `cells` may be null (linked grid /
// over cap) → every cell draws as a neutral fill so the subdivision still reads.
function cellBucket(type) {
  if (type === 'image' || type === 'video') return 'media';
  if (type === 'text') return 'text';
  if (!type || type === 'empty') return 'empty';
  return 'other';
}
export function GridMark({ rects = [], cells = null }) {
  const G = 1.4; // gutter (viewBox units) → the visible divider between cells
  return (
    <svg className="cbp-mark cbp-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {rects.map((r, i) => {
        const bucket = cells ? cellBucket(cells[r.id]?.type) : 'plain';
        const x = r.x * 100 + G, y = r.y * 100 + G;
        const w = Math.max(0, r.w * 100 - 2 * G), h = Math.max(0, r.h * 100 - 2 * G);
        return <rect key={r.id || i} className={`gm-cell gm-${bucket}`} x={x} y={y} width={w} height={h} rx="1.5" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

// ── Doc ─────────────────────────────────────────────────────────────────────
// A little page: a title bar over a few text-line bars (headings wider/heavier,
// bullets get a leading dot, empty lines are short + faint).
export function DocMark({ title = '', lines = [] }) {
  const rows = lines.length ? lines : [{}, {}, {}];
  const startY = title ? 34 : 24;
  const step = Math.min(13, (90 - startY) / rows.length);
  return (
    <svg className="cbp-mark cbp-doc" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {title && <rect className="cbp-doc-title" x="18" y="18" width="46" height="8" rx="2" />}
      {rows.map((l, i) => {
        const y = startY + i * step;
        if (l.bullet) return (
          <g key={i}>
            <circle className="cbp-doc-dot" cx="20" cy={y + 2.5} r="2" />
            <rect className={`cbp-doc-bar${l.empty ? ' is-empty' : ''}`} x="26" y={y} width={l.empty ? 22 : 52} height="5" rx="2" />
          </g>
        );
        return <rect key={i} className={`cbp-doc-bar${l.heading ? ' is-h' : ''}${l.empty ? ' is-empty' : ''}`}
                     x="18" y={y} width={l.heading ? 58 : l.empty ? 26 : 64} height={l.heading ? 6.5 : 5} rx="2" />;
      })}
    </svg>
  );
}

// ── Schedule ────────────────────────────────────────────────────────────────
// Rows, each a small accent time-tick + a content line.
export function ScheduleMark({ rows = [] }) {
  const shown = (rows.length ? rows : [{}, {}, {}]).slice(0, 4);
  const startY = 22, step = shown.length >= 4 ? 18 : 20;
  return (
    <svg className="cbp-mark cbp-sched" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {shown.map((r, i) => {
        const y = startY + i * step;
        return (
          <g key={i}>
            <rect className="cbp-sched-tick" x="16" y={y} width="16" height="6" rx="2" />
            <rect className="cbp-sched-bar" x="38" y={y} width="46" height="6" rx="2" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Shape ───────────────────────────────────────────────────────────────────
// The real silhouette (reuses the canvas ShapeGlyph geometry). Falls back to a
// themed stroke so a transparent / white-stroked shape still reads on the
// frosted preview background.
export function ShapeMark({ shape = 'rect', fill = 'transparent', stroke = null, dash = 'solid' }) {
  const f = fill && fill !== 'transparent' ? fill : 'transparent';
  return (
    <div className="cbp-mark cbp-shape-mark" aria-hidden="true">
      <ShapeGlyph shape={shape} fill={f} stroke={stroke || 'var(--ink-2)'} strokeWidth={2} dash={dash} />
    </div>
  );
}

// ── Note ────────────────────────────────────────────────────────────────────
// Its real text on the note's tint. Empty notes are handled upstream. The ink is
// chosen for contrast against the (literal) tint so it stays legible either way.
function inkOn(tone) {
  if (!tone) return null;
  try { return contrastRatio('#17171b', tone) >= contrastRatio('#f5f5f7', tone) ? '#17171b' : '#f5f5f7'; }
  catch { return null; }
}
export function NoteMark({ text = '', tone = null, size = 'row' }) {
  const ink = inkOn(tone);
  const style = {};
  if (tone) style.background = tone;
  if (ink) style.color = ink;
  return (
    <div className={`cbp-mark cbp-note-mark cbp-note-${size}`} style={style}>
      <span className="cbp-note-text">{text}</span>
    </div>
  );
}

// ── Link ────────────────────────────────────────────────────────────────────
// The favicon (stored, or derived from the domain) with the bare domain
// underneath at tile size. onError → the link glyph, so a dead favicon never
// leaves a broken image.
function domainOf(source) {
  if (!source) return '';
  try {
    const u = new URL(/^https?:\/\//.test(source) ? source : `https://${source}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return String(source).replace(/^https?:\/\//, '').split('/')[0]; }
}
export function LinkMark({ favicon = null, source = '', size = 'row' }) {
  const [broken, setBroken] = useState(false);
  const domain = domainOf(source);
  const src = favicon || (domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null);
  return (
    <div className="cbp-mark cbp-link" aria-hidden="true">
      {src && !broken
        ? <img className="cbp-link-favicon" src={src} alt="" draggable="false" onError={() => setBroken(true)} />
        : <Icon as={LinkIcon} size={size === 'tile' ? 34 : 20} />}
      {size === 'tile' && domain && <span className="cbp-link-domain">{domain}</span>}
    </div>
  );
}
