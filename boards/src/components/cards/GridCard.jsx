// Grid card — a single container card (kind:'grid') holding a nested fraction-
// tree of cells. Each cell is a universal content slot (image / rich text / link
// / video / file). The layout math lives in lib/gridLayout.js (pure); this
// component renders the computed cell rects in LOCAL coordinates inside the card
// box (no per-cell .card chrome) and, when editable, the divider drag handles +
// directional edge "+". Read-only when onUpdate is null (view-only / public).
//
// Reactivity note: a cell's content lives in the card's nested gridCells Y.Map,
// which readCards hashes to 'Y|' — so the card object identity does NOT change on
// a cell edit. Like RichDocCard, GridCard self-observes its own gridCells so cell
// edits re-render. Layout / templateId / seqId arrive as plain props.

import { useEffect, useReducer, useState } from 'react';
import { computeCellRects, collectDividers, GRID_TUNING } from '../../lib/gridLayout.js';
import { resolveTagText, hasLabelTag } from '../../lib/gridSequence.js';
import { readGridModel } from '../../lib/gridState.js';
import { R2Image } from '../R2Image.jsx';
import { resolveSrc } from '../../lib/r2.js';
import { FileCard } from './FileCard.jsx';
import './gridCard.css';

// Force a re-render when this Grid's gridCells Y.Map changes (deep). Cheap no-op
// in local mode (no Y type → no observer).
function useGridCellsVersion(cardYMap) {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const cm = cardYMap && cardYMap.get && cardYMap.get('gridCells');
    if (!cm || typeof cm.observeDeep !== 'function') return;
    const cb = () => bump();
    cm.observeDeep(cb);
    return () => { try { cm.unobserveDeep(cb); } catch (_) {} };
  }, [cardYMap]);
}

function useResolvedSrc(src) {
  const [url, setUrl] = useState(src && !String(src).startsWith('r2:') ? src : null);
  useEffect(() => {
    let alive = true;
    if (!src) { setUrl(null); return; }
    if (!String(src).startsWith('r2:')) { setUrl(src); return; }
    Promise.resolve(resolveSrc(src)).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [src]);
  return url;
}

function CellText({ html, seqIndex, seqFormat }) {
  const resolved = (seqIndex != null && hasLabelTag(html))
    ? resolveTagText(html, { index: seqIndex, format: seqFormat || {} })
    : (html || '');
  return <div className="gc-text" dangerouslySetInnerHTML={{ __html: resolved }} />;
}

function CellVideo({ src }) {
  const url = useResolvedSrc(src);
  if (!url) return <div className="gc-loading" aria-hidden="true" />;
  return <video className="gc-video" src={url} controls preload="metadata" onPointerDown={(e) => e.stopPropagation()} />;
}

function CellContent({ cell, rect, seqIndex, seqFormat }) {
  const type = cell?.type || 'empty';
  if (type === 'image' && cell.src) {
    return (
      <R2Image
        src={cell.src}
        w={Math.round(rect.w)}
        h={Math.round(rect.h)}
        draggable="false"
        className="gc-img"
        style={{ objectFit: cell.fit === 'contain' ? 'contain' : 'cover', objectPosition: cell.pos ? `${cell.pos.x}% ${cell.pos.y}%` : 'center' }}
      />
    );
  }
  if (type === 'text') return <CellText html={cell.html} seqIndex={seqIndex} seqFormat={seqFormat} />;
  if (type === 'link') {
    return (
      <a className="gc-link" href={cell.source || cell.link || '#'} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {cell.image ? <img className="gc-link-img" src={cell.image} alt="" draggable="false" /> : null}
        <span className="gc-link-meta">
          {cell.favicon ? <img className="gc-link-fav" src={cell.favicon} alt="" /> : null}
          <span className="gc-link-title">{cell.title || cell.source || cell.link}</span>
        </span>
      </a>
    );
  }
  if (type === 'video' && cell.src) return <CellVideo src={cell.src} />;
  if (type === 'file') {
    return <FileCard fileSrc={cell.fileSrc} fileName={cell.fileName} mime={cell.mime} sizeBytes={cell.sizeBytes} ext={cell.ext} title={cell.title} onUpdate={null} />;
  }
  return null; // empty cell — the placeholder is drawn by the wrapper
}

export function GridCard({ card, w, h, ydoc, cardYMap, templates, seqIndex, seqFormat, isSelected = false, canEdit = false }) {
  useGridCellsVersion(cardYMap);
  const model = readGridModel(card, ydoc, templates);
  const layout = model.layout;
  if (!layout) return <div className="gridc gridc-empty" aria-hidden="true" />;

  const box = { x: 0, y: 0, w, h };
  const rects = computeCellRects(layout, box);
  const dividers = collectDividers(layout, box);
  const gutter = GRID_TUNING.GUTTER_PX || 0;

  return (
    <div className="gridc" data-grid-id={card.id}>
      {rects.map((r) => {
        const cell = model.cells[r.id];
        const empty = !cell || cell.type === 'empty' || (cell.type === 'image' && !cell.src);
        return (
          <div
            key={r.id}
            className={`gridc-cell${empty ? ' is-empty' : ''} gridc-cell-${(cell && cell.type) || 'empty'}`}
            data-cell-id={r.id}
            style={{ left: r.x + gutter / 2, top: r.y + gutter / 2, width: Math.max(0, r.w - gutter), height: Math.max(0, r.h - gutter) }}
          >
            <CellContent cell={cell} rect={r} seqIndex={seqIndex} seqFormat={seqFormat} />
          </div>
        );
      })}
      {dividers.map((d) => (
        <div
          key={d.id}
          className={`gridc-divider gridc-divider-${d.axis}`}
          style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
