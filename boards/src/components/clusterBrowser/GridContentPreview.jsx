// A grid card's REAL content in miniature — the actual cell images/text/links,
// laid out by the grid's own fraction tree — so a grid reads as what it *is* and
// *contains*, not an abstract "grid" glyph. Given a resolved model
// ({ layout, cells } from readGridModel), each computeCellRects rect becomes an
// absolutely-positioned cell painted by its content type. Presign URLs are
// batched + cached (lib/r2.js) so tens of these are cheap.
import { R2Image } from '../R2Image.jsx';
import { Icon } from '../Icon.jsx';
import { iconForFile } from '../cards/FileCard.jsx';
import { computeCellRects } from '../../lib/gridLayout.js';
import { Link as LinkIcon, Clapperboard } from '../../lib/icons.js';

const GRID_RECT_CAP = 64;

// Cheap DOM-free HTML→text for a text cell's tiny label.
function stripText(html, max) {
  if (!html) return '';
  const t = String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function CellContent({ cell, rect, basePx, size }) {
  if (!cell) return null;
  const w = Math.max(8, Math.round(basePx * rect.w));
  const h = Math.max(8, Math.round(basePx * rect.h));
  const glyph = size === 'tile' ? 18 : 11;

  if (cell.type === 'image' && cell.src) {
    return <R2Image src={cell.src} w={w} h={h} className="cbg-img" draggable="false" />;
  }
  if (cell.type === 'video') {
    if (cell.poster) return <R2Image src={cell.poster} w={w} h={h} className="cbg-img" draggable="false" />;
    return <span className="cbg-glyph"><Icon as={Clapperboard} size={glyph} /></span>;
  }
  if (cell.type === 'link') {
    if (cell.image) return <R2Image src={cell.image} w={w} h={h} className="cbg-img" draggable="false" />;
    if (cell.favicon) return <img className="cbg-favicon" src={cell.favicon} alt="" draggable="false" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
    return <span className="cbg-glyph"><Icon as={LinkIcon} size={glyph} /></span>;
  }
  if (cell.type === 'text') {
    const t = stripText(cell.html, size === 'tile' ? 140 : 44);
    return t ? <span className="cbg-text">{t}</span> : null;
  }
  if (cell.type === 'file') {
    return <span className="cbg-glyph"><Icon as={iconForFile(cell.ext, cell.mime)} size={glyph} /></span>;
  }
  if (cell.type === 'board') {
    return <span className="cbg-text cbg-board">{cell.name || 'Cluster'}</span>;
  }
  return null; // empty
}

export function GridContentPreview({ model, size = 'row' }) {
  const layout = model && model.layout;
  if (!layout) return null;
  const rects = computeCellRects(layout, { x: 0, y: 0, w: 1, h: 1 }).slice(0, GRID_RECT_CAP);
  const cells = model.cells || {};
  const basePx = size === 'tile' ? 320 : 64;
  return (
    <div className="cbg" aria-hidden="true">
      {rects.map((r, i) => (
        <div key={r.id || i} className={`cbg-cell cbg-${(cells[r.id] && cells[r.id].type) || 'empty'}`}
             style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
          <CellContent cell={cells[r.id]} rect={r} basePx={basePx} size={size} />
        </div>
      ))}
    </div>
  );
}
