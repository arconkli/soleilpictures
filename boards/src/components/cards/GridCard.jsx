// Grid card — a single container card (kind:'grid') holding a nested fraction-
// tree of cells. Each cell is a universal content slot (image / rich text / link
// / video / file). The layout math lives in lib/gridLayout.js (pure); this
// component renders the computed cell rects in LOCAL coordinates inside the card
// box (no per-cell .card chrome). When editable it adds: draggable divider
// handles (the shared-edge constraint), an empty-cell content chooser + file
// drop, in-place rich-text editing, and per-cell split/merge controls. Read-only
// when canEdit is false (view-only / public).
//
// Reactivity note: a cell's content lives in the card's nested gridCells Y.Map,
// which readCards hashes to 'Y|' — so the card object identity does NOT change on
// a cell edit. Like RichDocCard, GridCard self-observes its own gridCells so cell
// edits re-render. Layout / templateId / seqId arrive as plain props.

import { useEffect, useReducer, useState } from 'react';
import { computeCellRects, collectDividers, resizeDivider, dividerSnapTargets, GRID_TUNING } from '../../lib/gridLayout.js';
import { resolveTagText, hasLabelTag } from '../../lib/gridSequence.js';
import { readGridModel } from '../../lib/gridState.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import { R2Image } from '../R2Image.jsx';
import { RichNoteEditor } from '../RichNoteEditor.jsx';
import { resolveSrc } from '../../lib/r2.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { FileCard } from './FileCard.jsx';
import { Icon } from '../Icon.jsx';
import { Columns2 as Columns, Plus, Trash2 as Trash, X, TextT, Image as ImageIcon, Link } from '../../lib/icons.js';
import './gridCard.css';

const stop = (e) => e.stopPropagation();

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
  return <video className="gc-video" src={url} controls preload="metadata" onPointerDown={stop} />;
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
      <a className="gc-link" href={cell.source || cell.link || '#'} target="_blank" rel="noreferrer" onClick={stop}>
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
  return null; // empty cell — placeholder/chooser drawn by the wrapper
}

export function GridCard({ card, w, h, ydoc, cardYMap, templates, seqIndex, seqFormat, isSelected = false, canEdit = false, gridActions = null, getAwareness = null, boardId = null, annotationsVisible = true }) {
  useGridCellsVersion(cardYMap);
  const [preview, setPreview] = useState(null);        // { layout } during a divider drag
  const [dragId, setDragId] = useState(null);          // id of the divider being dragged
  const [editingCellId, setEditingCellId] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);

  const model = readGridModel(card, ydoc, templates);
  const layout = preview?.layout || model.layout;
  if (!layout) return <div className="gridc gridc-empty" aria-hidden="true" />;

  const editable = canEdit && !!gridActions;
  const box = { x: 0, y: 0, w, h };
  const rects = computeCellRects(layout, box);
  const dividers = collectDividers(layout, box);
  const gutter = GRID_TUNING.GUTTER_PX || 0;
  const canMerge = rects.length > 1;

  const onDividerDown = (e, d) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const zoom = getCanvasScale() || 1;
    const baseLayout = model.layout;
    // Snap: lock the dragged line onto other parallel lines + the equal-split.
    const line0 = d.axis === 'x' ? d.x + d.w / 2 : d.y + d.h / 2;
    const targets = dividerSnapTargets(baseLayout, box, d);
    const thresh = (GRID_TUNING.SNAP_PX || 6) / zoom;
    let lastDf = 0;
    setDragId(d.id);
    const move = (ev) => {
      const deltaScreen = d.axis === 'x' ? (ev.clientX - startX) : (ev.clientY - startY);
      let line = line0 + deltaScreen / zoom;
      let best = thresh, snapped = line;
      for (const t of targets) { const dist = Math.abs(line - t); if (dist < best) { best = dist; snapped = t; } }
      line = snapped;
      const df = (line - line0) / (d.parentExtent || 1);
      lastDf = df;
      setPreview({ layout: resizeDivider(baseLayout, d.path, d.childIndex, df) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      setDragId(null);
      if (Math.abs(lastDf) > 1e-4) gridActions.resizeDivider(card.id, d.path, d.childIndex, lastDf);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Split control: a vertical line (split into columns = a 'row' of two cells) or
  // a horizontal line (split into rows = a 'col'). Real icons (Columns, rotated).
  const SplitButtons = ({ cellId }) => (
    <>
      <button type="button" className="is-icon" title="Add a vertical line (split into columns)"
        onPointerDown={stop} onClick={(e) => { e.stopPropagation(); gridActions.splitCell(card.id, cellId, 'row'); }}>
        <span className="gridc-ico"><Icon as={Columns} size={15} /></span>
      </button>
      <button type="button" className="is-icon" title="Add a horizontal line (split into rows)"
        onPointerDown={stop} onClick={(e) => { e.stopPropagation(); gridActions.splitCell(card.id, cellId, 'col'); }}>
        <span className="gridc-ico gridc-rot90"><Icon as={Columns} size={15} /></span>
      </button>
    </>
  );

  const linked = !!model.templateId;

  return (
    <>
    <div className="gridc" data-grid-id={card.id}>
      {linked && annotationsVisible && (
        // Purely informational (pointer-events:none in CSS) so it never swallows a
        // selection click or unlinks by accident — unlink via right-click → Unlink.
        // Per-family colour (by templateId) so distinct linked families read apart;
        // follows the top-left comments-eye toggle (hidden when annotations are off).
        <span className="gridc-linked-badge" style={{ '--link-color': pickPresenceColor(model.templateId) }}
              title="Linked layout — size & dividers reflow every linked Grid. Right-click → Unlink to detach.">Linked</span>
      )}
      {rects.map((r) => {
        const cell = model.cells[r.id];
        const type = (cell && cell.type) || 'empty';
        const empty = type === 'empty' || (type === 'image' && !cell.src);
        const isEditingText = editable && type === 'text' && editingCellId === r.id;
        return (
          <div
            key={r.id}
            className={`gridc-cell${empty ? ' is-empty' : ''} gridc-cell-${type}${dragOverCell === r.id ? ' is-drop' : ''}`}
            data-cell-id={r.id}
            style={{ left: r.x + gutter / 2, top: r.y + gutter / 2, width: Math.max(0, r.w - gutter), height: Math.max(0, r.h - gutter) }}
            onDoubleClick={editable && type === 'text' && !isEditingText ? (e) => { e.stopPropagation(); setEditingCellId(r.id); } : undefined}
            onDragOver={editable ? (e) => { e.preventDefault(); setDragOverCell(r.id); } : undefined}
            onDragLeave={editable ? () => setDragOverCell((p) => (p === r.id ? null : p)) : undefined}
            onDrop={editable ? (e) => {
              const files = e.dataTransfer?.files;
              if (files && files.length) { e.preventDefault(); e.stopPropagation(); setDragOverCell(null); gridActions.fillCellFromFiles(card.id, r.id, files); }
              else setDragOverCell(null);
            } : undefined}
          >
            {/* Content sits in a clipping body so the hover toolbar (a sibling)
                can overflow a small cell instead of being cut off. */}
            <div className="gridc-cell-body">
              {isEditingText ? (
                <div className="gc-text-edit" onPointerDown={stop}>
                  <RichNoteEditor
                    html={cell.html || ''}
                    autoFocus
                    onChangeHTML={(html) => gridActions.setCellContent(card.id, r.id, { html })}
                    onEditingChange={(ed) => { if (!ed) setEditingCellId((p) => (p === r.id ? null : p)); }}
                    awareness={getAwareness ? (getAwareness() || null) : null}
                    cardId={`${card.id}:${r.id}`}
                    boardId={boardId}
                  />
                </div>
              ) : (
                <CellContent cell={cell} rect={r} seqIndex={seqIndex} seqFormat={seqFormat} />
              )}
            </div>

            {editable && !isEditingText && (
              // Wrapper is pointer-events:none (CSS) so the cell bg still selects
              // the card; only the pill is interactive.
              <div className="gridc-celltools">
                <div className="gridc-pill" onPointerDown={stop}>
                  {empty && (
                    <>
                      {/* Icon-only choosers; accessible name (title + aria-label) kept as
                          "Text"/"Image"/"Link" so tooltips read and tests still resolve them. */}
                      <button type="button" className="is-icon" title="Text" aria-label="Text"
                        onClick={(e) => { e.stopPropagation(); gridActions.setCellContent(card.id, r.id, { type: 'text', html: '' }); setEditingCellId(r.id); }}>
                        <span className="gridc-ico"><Icon as={TextT} size={15} /></span>
                      </button>
                      <button type="button" className="is-icon" title="Image" aria-label="Image"
                        onClick={(e) => { e.stopPropagation(); gridActions.pickImageForCell(card.id, r.id); }}>
                        <span className="gridc-ico"><Icon as={ImageIcon} size={15} /></span>
                      </button>
                      <button type="button" className="is-icon" title="Link" aria-label="Link"
                        onClick={(e) => { e.stopPropagation(); gridActions.addLinkToCell(card.id, r.id); }}>
                        <span className="gridc-ico"><Icon as={Link} size={15} /></span>
                      </button>
                      <span className="gridc-pill-sep" />
                    </>
                  )}
                  <SplitButtons cellId={r.id} />
                </div>
              </div>
            )}

            {editable && !isEditingText && !empty && (
              <button
                type="button"
                className="gridc-cell-x"
                title="Clear cell"
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); gridActions.clearCellContent(card.id, r.id); }}
              ><span className="gridc-ico"><Icon as={Trash} size={13} /></span></button>
            )}
          </div>
        );
      })}
      {dividers.map((d) => {
        const grab = editable && isSelected;   // resize after select (standard, avoids mis-grabs)
        const remove = (e) => { e.stopPropagation(); gridActions.removeDivider?.(card.id, d.path, d.childIndex); };
        return (
          <div
            key={d.id}
            className={`gridc-divider gridc-divider-${d.axis}${grab ? ' is-grabbable' : ''}${dragId === d.id ? ' is-dragging' : ''}`}
            style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
            onPointerDown={grab ? (e) => onDividerDown(e, d) : undefined}
            onDoubleClick={grab ? remove : undefined}
            title={grab ? 'Drag to resize · double-click to remove this line' : undefined}
          >
            {grab && (
              <button type="button" className="gridc-divider-rm" title="Remove this line"
                onPointerDown={stop} onClick={remove}>
                <span className="gridc-ico"><Icon as={X} size={11} /></span>
              </button>
            )}
          </div>
        );
      })}
    </div>
    {/* Directional "+" live OUTSIDE .gridc (a sibling overlay in the card box) so
        they straddle the edges and never cover interior cell tools. Shown when the
        Grid is selected; the selected card has overflow:visible so they paint. */}
    {editable && isSelected && gridActions.stampNeighbor && (
      <div className="gridc-edges" aria-hidden="false">
        {['top', 'bottom', 'left', 'right'].map((dir) => (
          <button
            key={dir}
            type="button"
            className={`gridc-add gridc-add-${dir}`}
            title={`Stamp a Grid ${dir}`}
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); gridActions.stampNeighbor(card.id, dir); }}
          ><span className="gridc-ico"><Icon as={Plus} size={13} /></span></button>
        ))}
      </div>
    )}
    </>
  );
}
