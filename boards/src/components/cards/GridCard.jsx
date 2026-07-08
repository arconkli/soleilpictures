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
import { createPortal } from 'react-dom';
import { computeCellRects, collectDividers, resizeDivider, dividerSnapTargets, GRID_TUNING } from '../../lib/gridLayout.js';
import { resolveTagText, hasLabelTag } from '../../lib/gridSequence.js';
import { readGridModel, effectiveCellStyle } from '../../lib/gridState.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import { R2Image } from '../R2Image.jsx';
import { RichNoteEditor } from '../RichNoteEditor.jsx';
import { Spinner } from '../Spinner.jsx';
import { resolveSrc } from '../../lib/r2.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { FileCard } from './FileCard.jsx';
import { Icon } from '../Icon.jsx';
import { Columns2 as Columns, Plus, Trash2 as Trash, X, TextT, Image as ImageIcon, Link, ArrowsClockwise, MoreHorizontal, Edit as Pencil, Maximize2, Download } from '../../lib/icons.js';
import { GridCellMenu } from './GridCellMenu.jsx';
import { GridCellPhotoPopover } from './GridCellPhotoPopover.jsx';
import { ImageEditModal } from '../ImageEditModal.jsx';
import { ImageLightbox } from '../ImageLightbox.jsx';
import { buildImgStyle, hasFilterStages } from '../../lib/imageAdjust.js';
import { downloadImage } from '../../lib/imageExport.js';
import { PerCardFilter } from '../ImageAdjustFilters.jsx';
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

// Translate a resolved cell text style {fontFamily,fontSize,color,align,vAlign}
// into inline CSS. vAlign uses flex so text can sit dead-center (or bottom) in
// the box; align is text-align. Typed text stays plain html and inherits this,
// so a shared-style change re-flows every un-pinned cell live.
function cellTextStyle(eff) {
  if (!eff) return undefined;
  const s = {};
  if (eff.fontFamily) s.fontFamily = eff.fontFamily;
  if (eff.fontSize) s.fontSize = typeof eff.fontSize === 'number' ? `${eff.fontSize}px` : eff.fontSize;
  if (eff.color) s.color = eff.color;
  if (eff.align) s.textAlign = eff.align;
  if (eff.vAlign && eff.vAlign !== 'top') {
    s.display = 'flex';
    s.flexDirection = 'column';
    s.justifyContent = eff.vAlign === 'center' ? 'center' : eff.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  }
  return Object.keys(s).length ? s : undefined;
}

function CellText({ html, seqIndex, seqFormat, style }) {
  const resolved = (seqIndex != null && hasLabelTag(html))
    ? resolveTagText(html, { index: seqIndex, format: seqFormat || {} })
    : (html || '');
  return <div className="gc-text" style={style} dangerouslySetInnerHTML={{ __html: resolved }} />;
}

function CellVideo({ src }) {
  const url = useResolvedSrc(src);
  if (!url) return <div className="gc-loading" aria-hidden="true" />;
  return <video className="gc-video" src={url} controls preload="metadata" onPointerDown={stop} />;
}

function CellContent({ cell, rect, seqIndex, seqFormat, boards, onOpenBoard, textStyle, cardId, cellId, compare = false }) {
  const type = cell?.type || 'empty';
  if (type === 'board' && cell.boardId) {
    const b = boards?.[cell.boardId];
    const missing = !b;                                  // referenced cluster was deleted
    const name = b?.name || cell.name || 'Cluster';      // cell.name = snapshot at drop
    return (
      <button type="button" className={`gc-board${missing ? ' is-missing' : ''}`} onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); if (!missing) onOpenBoard?.(cell.boardId); }}
        disabled={missing}
        title={missing ? 'This cluster was removed' : `Open ${name}`}>
        {b?.thumb_key
          ? <R2Image src={b.thumb_key} w={Math.round(rect.w)} h={Math.round(rect.h)} className="gc-board-thumb" draggable="false" />
          : <span className="gc-board-ph" aria-hidden="true" />}
        <span className="gc-board-meta">
          <span className="gc-board-badge">{missing ? 'REMOVED' : 'CLUSTER'}</span>
          <span className="gc-board-name">{missing ? `${name} (removed)` : name}</span>
        </span>
      </button>
    );
  }
  if (type === 'image' && cell.src) {
    // Full image controls: object-fit (Fill/Fit) + object-position (Reposition) +
    // zoom (scale, cropping around the focal point) + non-destructive photo
    // adjustments (buildImgStyle → CSS filter/flip, byte-identical to a standalone
    // image card). `compare` nulls the adjust so a hold-to-compare shows the source.
    const objPos = cell.pos ? `${cell.pos.x}% ${cell.pos.y}%` : 'center';
    const base = buildImgStyle(compare ? null : cell.adjust, `${cardId}:${cellId}`) || {};
    // Zoom-crop only applies in Fill (cover) — in Fit (contain) the whole image
    // must fit, so ignore the stored zoom (it's preserved for switching back).
    const z = (cell.fit !== 'contain' && Number(cell.zoom) > 1) ? Number(cell.zoom) : 0;
    const transform = [base.transform, z ? `scale(${z})` : ''].filter(Boolean).join(' ');
    const style = {
      objectFit: cell.fit === 'contain' ? 'contain' : 'cover',
      objectPosition: objPos,
      ...(base.filter ? { filter: base.filter } : {}),
      ...(transform ? { transform, transformOrigin: objPos } : {}),
    };
    return (
      <R2Image
        src={cell.src}
        w={Math.round(rect.w)}
        h={Math.round(rect.h)}
        draggable="false"
        className="gc-img"
        style={style}
      />
    );
  }
  if (type === 'text') return <CellText html={cell.html} seqIndex={seqIndex} seqFormat={seqFormat} style={textStyle} />;
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

export function GridCard({ card, w, h, ydoc, cardYMap, templates, seqIndex, seqFormat, isSelected = false, canEdit = false, gridActions = null, getAwareness = null, boardId = null, annotationsVisible = true, focusedCellId = null, dropCellId = null, cellUploads = null, boards = null, onOpenBoard = null }) {
  useGridCellsVersion(cardYMap);
  const [preview, setPreview] = useState(null);        // { layout } during a divider drag
  const [dragId, setDragId] = useState(null);          // id of the divider being dragged
  const [editingCellId, setEditingCellId] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);
  const [swapCellId, setSwapCellId] = useState(null);   // a filled cell showing the "Replace" type chooser
  const [menu, setMenu] = useState(null);               // { cellId, anchorRect, mode } — pop-out menu for a too-small cell
  const [photoEdit, setPhotoEdit] = useState(null);     // { cellId, anchorRect } — image cell's photo/fit editor
  const [photoFullModal, setPhotoFullModal] = useState(null); // { cellId } — full-screen ImageEditModal
  const [lightbox, setLightbox] = useState(null);       // { cellId } — full-screen ImageLightbox viewer
  const [repositionOn, setRepositionOn] = useState(false); // reposition drag armed on the edited cell
  const [compareCellId, setCompareCellId] = useState(null); // cell showing its unadjusted source (hold-to-compare)

  const model = readGridModel(card, ydoc, templates);
  const layout = preview?.layout || model.layout;
  if (!layout) return <div className="gridc gridc-empty" aria-hidden="true" />;

  const editable = canEdit && !!gridActions;
  // Enter/leave a text cell's editor. Also tells CanvasSurface so the bottom
  // note formatting toolbar (font / size / style) shows scoped to this cell.
  const enterTextEdit = (cellId) => { setEditingCellId(cellId); gridActions?.setCellEditing?.(card.id, cellId); };
  const exitTextEdit = (cellId) => { setEditingCellId((p) => (p === cellId ? null : p)); gridActions?.setCellEditing?.(null, null); };
  // Open / close the image cell's photo + fit editor (portaled popover below).
  const openPhotoEdit = (cellId, anchorRect) => { setMenu(null); setRepositionOn(false); setCompareCellId(null); setPhotoEdit({ cellId, anchorRect }); };
  const closePhotoEdit = () => { setPhotoEdit(null); setRepositionOn(false); setCompareCellId(null); };
  const openFullEditor = (cellId) => { closePhotoEdit(); setPhotoFullModal({ cellId }); };
  const openLightbox = (cellId) => { setMenu(null); closePhotoEdit(); setLightbox({ cellId }); };
  // Drag-to-reposition (object-position pan) an image cell. Screen-space ratio
  // (dx / cell width) is zoom-invariant, so no getCanvasScale needed. Dragging the
  // image right reveals its left → object-position x decreases.
  const onRepositionDown = (e, cellId, cellEl) => {
    if (!editable || !cellEl) return;
    e.stopPropagation(); e.preventDefault();
    const rect = cellEl.getBoundingClientRect();
    const start = (model.cells[cellId] && model.cells[cellId].pos) || { x: 50, y: 50 };
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const x = Math.max(0, Math.min(100, start.x - ((ev.clientX - sx) / Math.max(1, rect.width)) * 100));
      const y = Math.max(0, Math.min(100, start.y - ((ev.clientY - sy) / Math.max(1, rect.height)) * 100));
      gridActions.setCellContent(card.id, cellId, { pos: { x: Math.round(x), y: Math.round(y) } });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
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
    <div className={`gridc${repositionOn ? ' is-repositioning' : ''}`} data-grid-id={card.id}>
      {linked && (
        // Purely informational (pointer-events:none in CSS) so it never swallows a
        // selection click or unlinks by accident — unlink via right-click → Unlink.
        // Per-family colour (by templateId) so distinct linked families read apart.
        // Hidden at rest and revealed only on grid hover/selection (CSS) so it never
        // persistently covers the top-left cell corner — no comments-eye toggle needed.
        <span className="gridc-linked-badge" style={{ '--link-color': pickPresenceColor(model.templateId) }}
              title="Linked layout — size & dividers reflow every linked Grid. Right-click → Unlink to detach.">Linked</span>
      )}
      {rects.map((r) => {
        const cell = model.cells[r.id];
        const type = (cell && cell.type) || 'empty';
        const empty = type === 'empty' || (type === 'image' && !cell.src);
        const isEditingText = editable && type === 'text' && editingCellId === r.id;
        // Effective text style = family (shared) style + this cell's override.
        const tstyle = cellTextStyle(effectiveCellStyle(model.familyTextStyle, cell));
        // Show the Text/Image/Link chooser when the cell is empty OR the user hit
        // "Replace" on a filled cell to swap its type in place.
        const showChooser = empty || swapCellId === r.id;
        // Too small (LOCAL px) to host the inline pill without overflowing the
        // .gridc clip → swap the pill for a compact trigger that opens the
        // portaled full-size menu. Local, not screen: the pill scales with the
        // cell, so fit is zoom-independent.
        const cellW = Math.max(0, r.w - gutter), cellH = Math.max(0, r.h - gutter);
        const compact = cellW < GRID_TUNING.PILL_MIN_W || cellH < GRID_TUNING.PILL_MIN_H;
        const isImage = type === 'image' && !!cell.src;   // gets the "Edit photo" affordance
        return (
          <div
            key={r.id}
            className={`gridc-cell${empty ? ' is-empty' : ''} gridc-cell-${type}${(dragOverCell === r.id || dropCellId === r.id) ? ' is-drop' : ''}${focusedCellId === r.id ? ' is-focused' : ''}`}
            data-cell-id={r.id}
            style={{ left: r.x + gutter / 2, top: r.y + gutter / 2, width: Math.max(0, r.w - gutter), height: Math.max(0, r.h - gutter) }}
            onPointerDownCapture={editable && gridActions.focusCell ? () => gridActions.focusCell(card.id, r.id) : undefined}
            onDoubleClick={editable && !isEditingText ? (e) => {
              e.stopPropagation();
              // Double-tap an EMPTY cell → it instantly becomes a note (unless an
              // upload is in flight). A text cell → edit. Other filled types →
              // no-op (never destroy content on a double-tap; use Replace/Clear).
              const uploading = cellUploads && cellUploads[r.id] !== undefined;
              if (empty && !uploading) { gridActions.setCellContent(card.id, r.id, { type: 'text', html: '' }); enterTextEdit(r.id); }
              else if (type === 'text') enterTextEdit(r.id);
            } : undefined}
            onPointerLeave={editable ? () => setSwapCellId((s) => (s === r.id ? null : s)) : undefined}
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
                <div className="gc-text-edit" style={tstyle} onPointerDown={stop}>
                  <RichNoteEditor
                    html={cell.html || ''}
                    autoFocus
                    onChangeHTML={(html) => gridActions.setCellContent(card.id, r.id, { html })}
                    onEditingChange={(ed) => { if (!ed) exitTextEdit(r.id); }}
                    awareness={getAwareness ? (getAwareness() || null) : null}
                    cardId={`${card.id}:${r.id}`}
                    boardId={boardId}
                  />
                </div>
              ) : (
                <CellContent cell={cell} rect={r} seqIndex={seqIndex} seqFormat={seqFormat} boards={boards} onOpenBoard={onOpenBoard} textStyle={tstyle}
                  cardId={card.id} cellId={r.id} compare={compareCellId === r.id} />
              )}
            </div>

            {editable && isImage && repositionOn && photoEdit?.cellId === r.id && (
              // Reposition mode: a drag layer over the image → pan object-position.
              <div className="gridc-reposition" title="Drag to reposition"
                onPointerDown={(e) => onRepositionDown(e, r.id, e.currentTarget.parentElement)} />
            )}

            {cellUploads && cellUploads[r.id] !== undefined && (
              // In-cell upload feedback (paste / drop / Image-picker) — spinner +
              // optional percentage so the user sees the upload is in flight.
              <div className="gridc-cell-uploading" aria-label="Uploading">
                <Spinner size={20} tone="on-dark" label="Uploading" />
                {cellUploads[r.id] > 0 && <span className="gridc-cell-pct">{Math.round(cellUploads[r.id] * 100)}%</span>}
              </div>
            )}

            {editable && !isEditingText && (
              // Wrapper is pointer-events:none (CSS) so the cell bg still selects
              // the card; only the pill / trigger is interactive.
              <div className="gridc-celltools">
                {compact ? (
                  // Too small for the inline pill → a single trigger opens the
                  // portaled full-size menu (every option, never clipped).
                  <button type="button" className="gridc-pill-mini"
                    title={empty ? 'Add content' : 'Cell options'} aria-label={empty ? 'Add content' : 'Cell options'}
                    onPointerDown={stop}
                    onClick={(e) => { e.stopPropagation(); setMenu({ cellId: r.id, anchorRect: e.currentTarget.getBoundingClientRect(), mode: empty ? 'empty' : 'filled' }); }}>
                    <span className="gridc-ico"><Icon as={empty ? Plus : MoreHorizontal} size={16} /></span>
                  </button>
                ) : (
                <div className="gridc-pill" onPointerDown={stop}>
                  {showChooser ? (
                    <>
                      {/* Icon-only choosers; accessible name (title + aria-label) kept as
                          "Text"/"Image"/"Link" so tooltips read and tests still resolve them.
                          Also the in-place "Replace" swap for a filled cell (keeps the cell,
                          its size/position and text style — see setGridCell REPLACE branch). */}
                      <button type="button" className="is-icon" title="Text" aria-label="Text"
                        onClick={(e) => { e.stopPropagation(); gridActions.setCellContent(card.id, r.id, { type: 'text', html: '' }); enterTextEdit(r.id); setSwapCellId(null); }}>
                        <span className="gridc-ico"><Icon as={TextT} size={15} /></span>
                      </button>
                      <button type="button" className="is-icon" title="Image" aria-label="Image"
                        onClick={(e) => { e.stopPropagation(); gridActions.pickImageForCell(card.id, r.id); setSwapCellId(null); }}>
                        <span className="gridc-ico"><Icon as={ImageIcon} size={15} /></span>
                      </button>
                      <button type="button" className="is-icon" title="Link" aria-label="Link"
                        onClick={(e) => { e.stopPropagation(); gridActions.addLinkToCell(card.id, r.id); setSwapCellId(null); }}>
                        <span className="gridc-ico"><Icon as={Link} size={15} /></span>
                      </button>
                      <span className="gridc-pill-sep" />
                    </>
                  ) : (
                    <>
                      {/* Filled cell at rest → "Edit photo" (image cells only) +
                          a single "Replace" swap that reveals the chooser above so
                          you can switch this cell's content type. */}
                      {isImage && (
                        <button type="button" className="is-icon" title="Edit photo" aria-label="Edit photo"
                          onClick={(e) => { e.stopPropagation(); openPhotoEdit(r.id, (e.currentTarget.closest('.gridc-cell') || e.currentTarget).getBoundingClientRect()); }}>
                          <span className="gridc-ico"><Icon as={Pencil} size={15} /></span>
                        </button>
                      )}
                      {isImage && (
                        <button type="button" className="is-icon" title="Open full screen" aria-label="Open full screen"
                          onClick={(e) => { e.stopPropagation(); openLightbox(r.id); }}>
                          <span className="gridc-ico"><Icon as={Maximize2} size={15} /></span>
                        </button>
                      )}
                      <button type="button" className="is-icon" title="Replace" aria-label="Replace"
                        onClick={(e) => { e.stopPropagation(); setSwapCellId(r.id); }}>
                        <span className="gridc-ico"><Icon as={ArrowsClockwise} size={15} /></span>
                      </button>
                      <span className="gridc-pill-sep" />
                    </>
                  )}
                  <SplitButtons cellId={r.id} />
                </div>
                )}
              </div>
            )}

            {editable && !isEditingText && !empty && !compact && (
              // Corner Clear only on normal cells; on compact cells Clear lives
              // in the pop-out menu (avoids a cramped/overlapping corner button).
              <button
                type="button"
                className="gridc-cell-x"
                title="Clear cell"
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); gridActions.clearCellContent(card.id, r.id); setSwapCellId(null); }}
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
    {menu && (
      // Pop-out full-size menu for a too-small cell. Portaled to <body>, so it
      // escapes .gridc { overflow:hidden } and stays comfortable at any zoom.
      // Every option reuses the SAME gridActions handlers as the inline pill.
      <GridCellMenu
        anchorRect={menu.anchorRect}
        mode={menu.mode}
        isImage={!!(model.cells[menu.cellId] && model.cells[menu.cellId].type === 'image' && model.cells[menu.cellId].src)}
        onEditPhoto={() => openPhotoEdit(menu.cellId, menu.anchorRect)}
        onOpenFullScreen={() => openLightbox(menu.cellId)}
        onDownload={() => { const c = model.cells[menu.cellId]; if (c && c.src) downloadImage({ src: c.src, title: c.title || '', adjust: c.adjust }); }}
        onText={() => { gridActions.setCellContent(card.id, menu.cellId, { type: 'text', html: '' }); enterTextEdit(menu.cellId); }}
        onImage={() => gridActions.pickImageForCell(card.id, menu.cellId)}
        onLink={() => gridActions.addLinkToCell(card.id, menu.cellId)}
        onSplitRow={() => gridActions.splitCell(card.id, menu.cellId, 'row')}
        onSplitCol={() => gridActions.splitCell(card.id, menu.cellId, 'col')}
        onClear={() => gridActions.clearCellContent(card.id, menu.cellId)}
        onClose={() => setMenu(null)}
      />
    )}
    {(() => {
      // Per-cell photo-adjust SVG filter defs (referenced by the cell <img>'s
      // filter:url(#…)). Owned by GridCard (NOT CanvasSurface's ImageAdjustFilters)
      // because a cell.adjust edit doesn't bust the top-level cards snapshot —
      // GridCard self-observes gridCells, so these defs track the adjust live.
      const adjusted = rects.filter((r) => { const c = model.cells[r.id]; return c && c.type === 'image' && c.src && hasFilterStages(c.adjust); });
      return adjusted.length ? (
        <svg width="0" height="0" aria-hidden="true" focusable="false"
             style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <defs>
            {adjusted.map((r) => <PerCardFilter key={r.id} cardId={`${card.id}:${r.id}`} adjust={model.cells[r.id].adjust} />)}
          </defs>
        </svg>
      ) : null;
    })()}
    {photoEdit && (() => {
      const c = model.cells[photoEdit.cellId];
      if (!c || c.type !== 'image' || !c.src) return null;
      const g = card.id, cid = photoEdit.cellId;
      return (
        <GridCellPhotoPopover
          anchorRect={photoEdit.anchorRect}
          fit={c.fit} zoom={c.zoom} adjust={c.adjust}
          repositionOn={repositionOn}
          onFit={(patch) => gridActions.setCellContent(g, cid, patch)}
          onAdjustChange={(next) => gridActions.setCellContent(g, cid, { adjust: next })}
          onAdjustReset={() => gridActions.setCellContent(g, cid, { adjust: null })}
          onOpenFullEditor={() => openFullEditor(cid)}
          onToggleReposition={() => setRepositionOn((v) => !v)}
          onResetFraming={() => gridActions.setCellContent(g, cid, { fit: 'cover', pos: null, zoom: 1 })}
          onCompareStart={() => setCompareCellId(cid)}
          onCompareEnd={() => setCompareCellId(null)}
          onClose={closePhotoEdit}
        />
      );
    })()}
    {photoFullModal && (() => {
      // Full-screen photo EDITOR for a cell image (all 12 sliders + big live
      // preview + Download). GridCard-owned so a cell.adjust edit re-renders live
      // (CanvasSurface's cards snapshot doesn't bust on a nested cell edit).
      const c = model.cells[photoFullModal.cellId];
      if (!c || c.type !== 'image' || !c.src) return null;
      const cid = photoFullModal.cellId;
      return (
        <ImageEditModal
          src={c.src} title={c.title || ''} adjust={c.adjust} cardId={`${card.id}:${cid}`}
          onChange={(next) => gridActions.setCellContent(card.id, cid, { adjust: next })}
          onReset={() => gridActions.setCellContent(card.id, cid, { adjust: null })}
          onDownload={() => downloadImage({ src: c.src, title: c.title || '', adjust: c.adjust })}
          onClose={() => setPhotoFullModal(null)}
        />
      );
    })()}
    {lightbox && (() => {
      // Full-screen VIEWER (zoom/pan) for a cell image, with its own Download.
      // Portal to <body>: ImageLightbox doesn't portal itself, and GridCard lives
      // inside the transformed .canvas / contain:paint .card — which would trap its
      // position:fixed to the grid's box. At <body> it's truly full-screen.
      const c = model.cells[lightbox.cellId];
      if (!c || c.type !== 'image' || !c.src) return null;
      return createPortal(
        <ImageLightbox
          src={c.src} title={c.title || ''} alt={c.title || ''} adjust={c.adjust}
          cardId={`${card.id}:${lightbox.cellId}`}
          onClose={() => setLightbox(null)}
        />,
        document.body);
    })()}
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
