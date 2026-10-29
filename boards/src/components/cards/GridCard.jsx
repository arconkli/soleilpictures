// Grid card — a single container card (kind:'grid') holding a nested fraction-
// tree of cells. Each cell is a universal content slot (image / rich text / link
// / video / file). The layout math lives in lib/gridLayout.js (pure); this
// component renders the computed cell rects in LOCAL coordinates inside the card
// box (no per-cell .card chrome). When editable it adds: draggable divider
// grips (the shared-edge constraint), an empty-box content chooser + file drop
// (several files fill the empty boxes in reading order), corner tools on a
// filled box (full screen, the ··· menu, the ⠿ grip that moves / swaps it),
// and in-place rich-text editing. Read-only when canEdit is false (view-only /
// public).
//
// Spacing: a grid is flush (the contact-sheet look) unless its card carries a
// `gridGap` (right-click → Spacing). With a gap the frame pads by the gap, the
// boxes sit apart by it and round their corners — the gallery look.
//
// Reactivity note: a cell's content lives in the card's nested gridCells Y.Map,
// which readCards hashes to 'Y|' — so the card object identity does NOT change on
// a cell edit. Like RichDocCard, GridCard self-observes its own gridCells so cell
// edits re-render. Layout / templateId / seqId / gridGap arrive as plain props.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCellRects, collectDividers, resizeDivider, dividerSnapTargets, planCellFill, GRID_TUNING } from '../../lib/gridLayout.js';
import { readGridModel, effectiveCellStyle, readGridHints } from '../../lib/gridState.js';
import { isCellFilled } from '../../lib/gridCount.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import { RichNoteEditor } from '../RichNoteEditor.jsx';
import { Spinner } from '../Spinner.jsx';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { Icon } from '../Icon.jsx';
import { Plus, TextT, Image as ImageIcon, Link, MoreHorizontal, Maximize2 } from '../../lib/icons.js';
import { GridCellMenu } from './GridCellMenu.jsx';
import { GridCellPhotoPopover } from './GridCellPhotoPopover.jsx';
import { ImageEditModal } from '../ImageEditModal.jsx';
import { ImageLightbox } from '../ImageLightbox.jsx';
import { hasFilterStages } from '../../lib/imageAdjust.js';
import { downloadImage } from '../../lib/imageExport.js';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { startTouchScrollGesture } from '../../lib/touchScroll.js';
import { PerCardFilter } from '../ImageAdjustFilters.jsx';
import { useCardCellsVersion, cellTextStyle, CellContent } from './gridCellShared.jsx';
import './gridCard.css';

// The move grip's six dots, drawn here rather than as a Phosphor icon: the
// grip sits on every filled box, so its icon would join the app's first
// download in all six weights for one shape.
const GripDots = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="3" r="1.25" /><circle cx="9" cy="3" r="1.25" />
    <circle cx="5" cy="7" r="1.25" /><circle cx="9" cy="7" r="1.25" />
    <circle cx="5" cy="11" r="1.25" /><circle cx="9" cy="11" r="1.25" />
  </svg>
);

const stop = (e) => e.stopPropagation();
// Same as `stop`, but first lets a one-finger drag scroll the clipped editor
// body. Everything inside `.canvas-wrap { touch-action: none }` needs this —
// see lib/touchScroll.js.
const stopWithTouchScroll = (e) => { startTouchScrollGesture(e); e.stopPropagation(); };

// The right-click Spacing choices (card field `gridGap`, LOCAL px). Missing or
// 0 = flush. Exported so the canvas menu and the docs read the same values.
export const GRID_SPACING = Object.freeze([
  { id: 'none', label: 'None', gap: 0 },
  { id: 'small', label: 'Small', gap: 4 },
  { id: 'medium', label: 'Medium', gap: 8 },
  { id: 'large', label: 'Large', gap: 14 },
]);
export const gridGapOf = (card) => Math.max(0, Math.min(24, Math.round(Number(card && card.gridGap)) || 0));

// Box tool sizes (LOCAL px — the tools scale with the cell, so fit is
// zoom-independent). An empty box at least LABELLED_W × LABELLED_H names its
// choosers ("Text", "Image", "Link"); one at least PILL_MIN_W × PILL_MIN_H gets
// the icon row; smaller boxes get one compact trigger that opens the portaled
// menu. A filled box needs FILLED_MIN_W × FILLED_MIN_H for its corner tools.
const LABELLED_W = 220, LABELLED_H = 108;
const DROP_LINE_H = 140;          // tall enough to add "or drop a file here"
const FILLED_MIN_W = 100, FILLED_MIN_H = 40;
const FULLSCREEN_MIN_W = 130;     // room for ⤢ beside ···
const GRIP_MIN_SEG = 36;          // a line segment this long shows its grip

// Files in a drag, counted while it's still over the box (the File objects
// themselves only arrive on drop, but their entries are listed meanwhile).
const draggedFileCount = (dt) => {
  if (!dt) return 0;
  if (dt.items && dt.items.length) { let n = 0; for (const it of dt.items) if (it.kind === 'file') n += 1; return n; }
  return dt.files ? dt.files.length : 0;
};

export function GridCard({ card, w, h, ydoc, cardYMap, templates, seqIndex, seqFormat, isSelected = false, canEdit = false, gridActions = null, getAwareness = null, boardId = null, annotationsVisible = true, focusedCellId = null, dropCellId = null, dropCount = 1, cellUploads = null, boards = null, onOpenBoard = null }) {
  // gridMeta as well as gridCells: cell hints live there, so a template applied
  // to this grid must repaint it.
  useCardCellsVersion(cardYMap, ['gridCells', 'gridMeta']);
  const [preview, setPreview] = useState(null);        // { layout } during a divider drag
  const [dragId, setDragId] = useState(null);          // id of the divider being dragged
  const [editingCellId, setEditingCellId] = useState(null);
  const [dragOver, setDragOver] = useState(null);      // { cellId, count } — a file drag over a box
  const [moveDrag, setMoveDrag] = useState(null);      // { fromId, overId, x, y } — a box dragged by its grip
  const [menu, setMenu] = useState(null);               // { cellId, anchorRect, mode } — the box's ··· / + menu
  const [photoEdit, setPhotoEdit] = useState(null);     // { cellId, anchorRect } — image cell's photo/fit editor
  const [photoFullModal, setPhotoFullModal] = useState(null); // { cellId } — full-screen ImageEditModal
  const [lightbox, setLightbox] = useState(null);       // { cellId } — full-screen ImageLightbox viewer
  const [repositionOn, setRepositionOn] = useState(false); // reposition drag armed on the edited cell
  const [compareCellId, setCompareCellId] = useState(null); // cell showing its unadjusted source (hold-to-compare)
  const feedback = useOptionalFeedback();
  const downloadingRef = useRef(false);                 // a cell download in flight
  const rootRef = useRef(null);
  const enterRef = useRef(null);                        // latest Enter-key handler (see the effect below)

  // The keyboard lives in the canvas (it owns selection and box focus); Enter on
  // a focused box arrives here as a DOM event so this card can open its own
  // editor or menu. Registered once; the handler reads the latest render.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const on = (e) => enterRef.current?.(e.detail && e.detail.cellId);
    el.addEventListener('gridc-enter', on);
    return () => el.removeEventListener('gridc-enter', on);
  }, []);

  const model = readGridModel(card, ydoc, templates);
  // Cell labels carried in from the template this grid was made from. They are
  // NOT content: they live in gridMeta, never in gridCells, and render only
  // while a cell is empty — which is why they vanish exactly when the cell has
  // something in it and come back if it is cleared again.
  const hints = readGridHints(cardYMap, card);
  const layout = preview?.layout || model.layout;
  if (!layout) return <div className="gridc gridc-empty" aria-hidden="true" />;

  const editable = canEdit && !!gridActions;
  // Enter/leave a text cell's editor. Also tells CanvasSurface so the bottom
  // note formatting toolbar (font / size / style) shows scoped to this cell.
  const enterTextEdit = (cellId) => { setEditingCellId(cellId); gridActions?.setCellEditing?.(card.id, cellId); };
  const exitTextEdit = (cellId) => {
    setEditingCellId((p) => (p === cellId ? null : p));
    gridActions?.setCellEditing?.(null, null);
    // A double-click turns an empty cell into a text cell at once; left without
    // a word typed, it would keep none of an empty cell's hint, styling or
    // direct Image / Link buttons. Read live (the editor has just committed),
    // and keep any pinned style: setCellContent with a type preserves it.
    // isCellFilled strips tags, so it would also call an empty checklist or a
    // lone rule "empty"; only revert when nothing but paragraphs and breaks
    // was left behind.
    const live = readGridModel(card, ydoc, templates).cells[cellId];
    const bare = (html) => !String(html || '').replace(/<\/?(p|br)\b[^>]*>/gi, '').replace(/&nbsp;|\s/g, '');
    if (live && live.type === 'text' && !isCellFilled(live) && bare(live.html)) gridActions?.setCellContent?.(card.id, cellId, { type: 'empty' });
  };
  // Deletes in here get the house Undo toast (gridActions.withUndoToast);
  // without it they fall back to the bare mutator.
  const withUndo = (message, fn) => (gridActions?.withUndoToast ? gridActions.withUndoToast(message, fn) : fn());
  // A cell's photo download resolves false when it fails; say so (audit
  // MEDIA-15), and don't start a second one while the first is still going.
  const downloadCell = async (c) => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    try {
      const ok = await downloadImage({ src: c.src, title: c.title || '', adjust: c.adjust });
      if (!ok) feedback?.toast?.({ type: 'error', code: 'image_download_failed', message: 'Couldn’t download this image. Try again.' });
    } finally {
      downloadingRef.current = false;
    }
  };
  const clearCell = (cellId) => withUndo('Box cleared', () => gridActions.clearCellContent(card.id, cellId));
  // Removing a line deletes the right / bottom side's cells. Content moves
  // into an empty neighbour; what can't is counted, and only then is there a
  // toast — a line between two empty cells costs nothing.
  const removeLine = (d) => withUndo(
    (res) => (res?.dropped ? (res.dropped === 1 ? 'Removed a filled box' : `Removed ${res.dropped} filled boxes`) : null),
    () => gridActions.removeDivider?.(card.id, d.path, d.childIndex),
  );
  // Open / close the image cell's photo + fit editor (portaled popover below).
  const openPhotoEdit = (cellId, anchorRect) => { setMenu(null); setRepositionOn(false); setCompareCellId(null); setPhotoEdit({ cellId, anchorRect }); };
  const closePhotoEdit = () => { setPhotoEdit(null); setRepositionOn(false); setCompareCellId(null); };
  const openFullEditor = (cellId) => { closePhotoEdit(); setPhotoFullModal({ cellId }); };
  const openLightbox = (cellId) => { setMenu(null); closePhotoEdit(); setLightbox({ cellId }); };
  const cellElOf = (cellId) => rootRef.current?.querySelector?.(`.gridc-cell[data-cell-id="${CSS.escape(cellId)}"]`) || null;
  const openMenu = (cellId, anchorEl, mode) => {
    const el = anchorEl || cellElOf(cellId);
    if (!el) return;
    setMenu({ cellId, anchorRect: el.getBoundingClientRect(), mode });
  };
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

  // Spacing: the frame pads by gap/2 and every box insets by gap/2, so boxes sit
  // a full gap apart and a full gap off the frame. Rects still tile the inner
  // box exactly (computeCellRects stays a pure tiling), so the divider maths and
  // the hit zones are unchanged — the seams simply fall in the middle of a gap.
  const gap = gridGapOf(card);
  const gutter = gap || GRID_TUNING.GUTTER_PX || 0;
  const box = gap ? { x: gap / 2, y: gap / 2, w: Math.max(0, w - gap), h: Math.max(0, h - gap) } : { x: 0, y: 0, w, h };
  const rects = computeCellRects(layout, box);
  const dividers = collectDividers(layout, box);
  const isEmptyRec = (c) => !c || !c.type || c.type === 'empty' || (c.type === 'image' && !c.src);

  // Several things dropped at once fill the empty boxes in reading order from
  // the box under the pointer (lib/gridLayout.js planCellFill); the numbers show
  // where each one will land before it's let go. A file drag counts its own
  // entries; a drag of canvas cards arrives as dropCellId + dropCount.
  const fillTarget = dragOver ? { cellId: dragOver.cellId, count: dragOver.count } : (dropCellId ? { cellId: dropCellId, count: dropCount || 1 } : null);
  const fillIds = (fillTarget && fillTarget.count > 1) ? planCellFill(rects, model.cells, fillTarget.cellId, fillTarget.count) : null;
  const fillIndex = fillIds ? new Map(fillIds.map((id, i) => [id, i + 1])) : null;
  const fillExtra = fillIds ? Math.max(0, fillTarget.count - fillIds.length) : 0;

  // Enter on the focused box (from the canvas keyboard): a text box starts
  // editing, anything else opens its menu — the chooser on an empty box.
  enterRef.current = (cellId) => {
    if (!editable || !cellId) return;
    const c = model.cells[cellId];
    const type = (c && c.type) || 'empty';
    if (type === 'text') { enterTextEdit(cellId); return; }
    openMenu(cellId, null, isEmptyRec(c) ? 'empty' : 'filled');
  };

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

  // Move / swap: drag a filled box by its ⠿ grip onto another box of this grid.
  // Onto an empty box it moves; onto a filled one the two trade places — one
  // undo step either way (gridActions.swapCells). Esc or a release outside the
  // grid puts it back. The ghost is portaled so the canvas transform and the
  // grid's clip can't hold it.
  const onGripDown = (e, fromId) => {
    if (!editable || !gridActions.swapCells || (e.button != null && e.button > 0)) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let started = false, overId = null;
    const hit = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cellEl = el && el.closest ? el.closest('.gridc-cell') : null;
      const gridEl = cellEl ? cellEl.closest('[data-grid-id]') : null;
      if (!gridEl || gridEl.getAttribute('data-grid-id') !== card.id) return null;
      const id = cellEl.getAttribute('data-cell-id');
      return id === fromId ? null : id;
    };
    const move = (ev) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      started = true;
      overId = hit(ev);
      setMoveDrag({ fromId, overId, x: ev.clientX, y: ev.clientY });
    };
    const end = (commit, ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      setMoveDrag(null);
      if (commit && started) {
        const target = ev ? hit(ev) : overId;
        if (target) gridActions.swapCells(card.id, fromId, target);
      }
    };
    const up = (ev) => end(true, ev);
    const cancel = () => end(false);
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); end(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  };

  const linked = !!model.templateId;
  const dragging = !!moveDrag;
  const movingCell = moveDrag ? model.cells[moveDrag.fromId] : null;

  return (
    <>
    <div ref={rootRef}
         className={`gridc${repositionOn ? ' is-repositioning' : ''}${gap ? ' is-spaced' : ''}${dragging ? ' is-moving' : ''}`}
         style={gap ? { '--gridc-gap': `${gap}px` } : undefined}
         data-grid-id={card.id}>
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
        const empty = isEmptyRec(cell);
        const isEditingText = editable && type === 'text' && editingCellId === r.id;
        // Effective text style = family (shared) style + this cell's override.
        const effStyle = effectiveCellStyle(model.familyTextStyle, cell);
        const tstyle = cellTextStyle(effStyle);
        // Painted-cell surface (drives the readable-ink remap + editor tone).
        const cellBg = (effStyle?.bg && effStyle.bg !== 'transparent') ? effStyle.bg : null;
        // Tool tiers by the box's LOCAL size (see the constants above). Too
        // small for the inline tools → one compact trigger that opens the
        // portaled full-size menu, never clipped by .gridc.
        const cellW = Math.max(0, r.w - gutter), cellH = Math.max(0, r.h - gutter);
        const compact = empty
          ? (cellW < GRID_TUNING.PILL_MIN_W || cellH < GRID_TUNING.PILL_MIN_H)
          : (cellW < FILLED_MIN_W || cellH < FILLED_MIN_H);
        const labelled = empty && cellW >= LABELLED_W && cellH >= LABELLED_H;
        const isImage = type === 'image' && !!cell.src;   // gets the "Edit photo" affordance
        const uploading = cellUploads && cellUploads[r.id] !== undefined;
        const hint = hints && hints[r.id];
        const order = fillIndex ? fillIndex.get(r.id) : null;
        const singleDrop = !fillIndex && ((dragOver && dragOver.cellId === r.id) || dropCellId === r.id);
        const isLifted = moveDrag && moveDrag.fromId === r.id;
        const isMoveTarget = moveDrag && moveDrag.overId === r.id;
        const cls = ['gridc-cell', empty ? 'is-empty' : '', `gridc-cell-${type}`,
          (singleDrop || order) ? 'is-drop' : '', focusedCellId === r.id ? 'is-focused' : '',
          isLifted ? 'is-lifted' : '', isMoveTarget ? 'is-move-target' : ''].filter(Boolean).join(' ');
        const textChoice = (e) => { e.stopPropagation(); gridActions.setCellContent(card.id, r.id, { type: 'text', html: '' }); enterTextEdit(r.id); };
        const imageChoice = (e) => { e.stopPropagation(); gridActions.pickImageForCell(card.id, r.id); };
        const linkChoice = (e) => { e.stopPropagation(); gridActions.addLinkToCell(card.id, r.id); };
        const moreBtn = (
          <button type="button" className="gridc-sq" title="Box options" aria-label="Box options"
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); openMenu(r.id, e.currentTarget, empty ? 'empty' : 'filled'); }}>
            <span className="gridc-ico"><Icon as={MoreHorizontal} size={16} /></span>
          </button>
        );
        return (
          <div
            key={r.id}
            className={cls}
            data-cell-id={r.id}
            style={{ left: r.x + gutter / 2, top: r.y + gutter / 2, width: cellW, height: cellH }}
            onPointerDownCapture={editable && gridActions.focusCell ? () => gridActions.focusCell(card.id, r.id) : undefined}
            onDoubleClick={editable && !isEditingText ? (e) => {
              e.stopPropagation();
              // Double-tap an EMPTY cell → it instantly becomes a note (unless an
              // upload is in flight). A text cell → edit. Other filled types →
              // no-op (never destroy content on a double-tap; use Replace/Clear).
              if (empty && !uploading) { gridActions.setCellContent(card.id, r.id, { type: 'text', html: '' }); enterTextEdit(r.id); }
              else if (type === 'text') enterTextEdit(r.id);
            } : undefined}
            onDragOver={editable ? (e) => {
              e.preventDefault();
              const count = Math.max(1, draggedFileCount(e.dataTransfer));
              setDragOver((p) => (p && p.cellId === r.id && p.count === count ? p : { cellId: r.id, count }));
            } : undefined}
            onDragLeave={editable ? () => setDragOver((p) => (p && p.cellId === r.id ? null : p)) : undefined}
            onDrop={editable ? (e) => {
              const files = e.dataTransfer?.files;
              setDragOver(null);
              if (!files || !files.length) return;
              e.preventDefault(); e.stopPropagation();
              if (files.length > 1 && gridActions.fillCellsFromFiles) gridActions.fillCellsFromFiles(card.id, r.id, files, e.clientX, e.clientY);
              else gridActions.fillCellFromFiles(card.id, r.id, files);
            } : undefined}
          >
            {/* Content sits in a clipping body so the box tools (siblings) can
                overflow a small cell instead of being cut off. */}
            <div className="gridc-cell-body">
              {isEditingText ? (
                <div className="gc-text-edit" style={tstyle} onPointerDown={stopWithTouchScroll}>
                  <RichNoteEditor
                    html={cell.html || ''}
                    autoFocus
                    bgColor={cellBg || undefined}
                    textColor={effStyle?.color || undefined}
                    onChangeHTML={(html) => gridActions.setCellContent(card.id, r.id, { html })}
                    onEditingChange={(ed) => { if (!ed) exitTextEdit(r.id); }}
                    awareness={getAwareness ? (getAwareness() || null) : null}
                    cardId={`${card.id}:${r.id}`}
                    boardId={boardId}
                  />
                </div>
              ) : (
                <CellContent cell={cell} rect={r} seqIndex={seqIndex} seqFormat={seqFormat} boards={boards} onOpenBoard={onOpenBoard} textStyle={tstyle} effBg={cellBg}
                  cardId={card.id} cellId={r.id} compare={compareCellId === r.id} />
              )}
            </div>

            {/* What an empty box says at rest. A template's label names what the
                box is FOR ("WIDE SHOT"); a bare box shows one faint +, and only
                where it can be filled. aria-hidden: guidance about an empty
                region, not content a screen reader should announce. */}
            {empty && !isEditingText && !order && (hint
              ? <div className="gridc-hint" aria-hidden="true">{hint}</div>
              : (editable && !uploading && <div className="gridc-plus" aria-hidden="true"><Icon as={Plus} size={15} /></div>))}

            {editable && isImage && repositionOn && photoEdit?.cellId === r.id && (
              // Reposition mode: a drag layer over the image → pan object-position.
              <div className="gridc-reposition" title="Drag to reposition"
                onPointerDown={(e) => onRepositionDown(e, r.id, e.currentTarget.parentElement)} />
            )}

            {uploading && (
              // In-cell upload feedback (paste / drop / Image-picker) — spinner +
              // optional percentage so the user sees the upload is in flight.
              <div className="gridc-cell-uploading" aria-label="Uploading">
                <Spinner size={20} tone="on-dark" label="Uploading" />
                {cellUploads[r.id] > 0 && <span className="gridc-cell-pct">{Math.round(cellUploads[r.id] * 100)}%</span>}
              </div>
            )}

            {editable && !isEditingText && !dragging && !uploading && (
              // Wrapper covers the box but is pointer-events:none (CSS) so the
              // cell bg still selects the card; only the tools are interactive.
              <div className="gridc-celltools">
                {compact ? (
                  <button type="button" className="gridc-pill-mini"
                    title={empty ? 'Add content' : 'Box options'} aria-label={empty ? 'Add content' : 'Box options'}
                    onPointerDown={stop}
                    onClick={(e) => { e.stopPropagation(); openMenu(r.id, e.currentTarget, empty ? 'empty' : 'filled'); }}>
                    <span className="gridc-ico"><Icon as={empty ? Plus : MoreHorizontal} size={16} /></span>
                  </button>
                ) : empty ? (
                  <>
                    {/* The chooser, by name when there's room. Accessible names
                        stay "Text" / "Image" / "Link" at every size. */}
                    <div className={`gridc-chooser${labelled ? ' is-labelled' : ''}`}>
                      <div className="gridc-pill" onPointerDown={stop}>
                        <button type="button" className={labelled ? undefined : 'is-icon'} title="Text" aria-label="Text" onClick={textChoice}>
                          <span className="gridc-ico"><Icon as={TextT} size={15} /></span>{labelled && <span className="gridc-lbl">Text</span>}
                        </button>
                        <button type="button" className={labelled ? undefined : 'is-icon'} title="Image" aria-label="Image" onClick={imageChoice}>
                          <span className="gridc-ico"><Icon as={ImageIcon} size={15} /></span>{labelled && <span className="gridc-lbl">Image</span>}
                        </button>
                        <button type="button" className={labelled ? undefined : 'is-icon'} title="Link" aria-label="Link" onClick={linkChoice}>
                          <span className="gridc-ico"><Icon as={Link} size={15} /></span>{labelled && <span className="gridc-lbl">Link</span>}
                        </button>
                        {!labelled && <><span className="gridc-pill-sep" />{moreBtn}</>}
                      </div>
                      {labelled && cellH >= DROP_LINE_H && <div className="gridc-drop-line" aria-hidden="true">or drop a file here</div>}
                    </div>
                    {labelled && <div className="gridc-corner gridc-corner-tr">{moreBtn}</div>}
                  </>
                ) : (
                  <>
                    <div className="gridc-corner gridc-corner-tr">
                      {isImage && cellW >= FULLSCREEN_MIN_W && (
                        <button type="button" className="gridc-sq" title="Open full screen" aria-label="Open full screen"
                          onPointerDown={stop}
                          onClick={(e) => { e.stopPropagation(); openLightbox(r.id); }}>
                          <span className="gridc-ico"><Icon as={Maximize2} size={14} /></span>
                        </button>
                      )}
                      {moreBtn}
                    </div>
                    {gridActions.swapCells && (
                      <div className="gridc-corner gridc-corner-tl">
                        <button type="button" className="gridc-sq gridc-grip" title="Drag to move or swap" aria-label="Drag to move or swap"
                          onPointerDown={(e) => onGripDown(e, r.id)} onClick={stop}>
                          <span className="gridc-ico"><GripDots /></span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {isLifted && <div className="gridc-lifted-ring" aria-hidden="true" />}
            {isMoveTarget && (
              <div className="gridc-move-chip" aria-hidden="true">
                {empty ? 'Move here' : 'Swap'}
              </div>
            )}
            {order && <div className="gridc-order" aria-hidden="true">{order}</div>}
          </div>
        );
      })}
      {dividers.map((d) => {
        const grab = editable && isSelected;   // resize after select (standard, avoids mis-grabs)
        const seg = d.axis === 'x' ? d.h : d.w;
        return (
          <div
            key={d.id}
            className={`gridc-divider gridc-divider-${d.axis}${grab ? ' is-grabbable' : ''}${dragId === d.id ? ' is-dragging' : ''}`}
            style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
            onPointerDown={grab ? (e) => onDividerDown(e, d) : undefined}
            onDoubleClick={grab ? (e) => { e.stopPropagation(); removeLine(d); } : undefined}
            title={grab ? 'Drag to resize · double-click to remove this line' : undefined}
          >
            {grab && seg >= GRIP_MIN_SEG && <span className="gridc-divider-grip" aria-hidden="true" />}
          </div>
        );
      })}
      {fillExtra > 0 && (
        <div className="gridc-fill-note" aria-hidden="true">
          {fillExtra === 1 ? '1 more goes beside the grid' : `${fillExtra} more go beside the grid`}
        </div>
      )}
    </div>
    {moveDrag && moveDrag.overId !== undefined && typeof document !== 'undefined' && createPortal(
      // The box in hand, following the pointer. Not interactive, so the hit
      // test underneath it sees the boxes.
      <div className="gridc-move-ghost" style={{ left: moveDrag.x + 14, top: moveDrag.y + 10 }} aria-hidden="true">
        {movingCell && movingCell.type === 'image' && movingCell.src
          ? <img src={movingCell.src} alt="" draggable={false} />
          : <span className="gridc-move-ghost-txt">{movingCell && movingCell.type === 'text'
            ? (String(movingCell.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Text')
            : (movingCell && (movingCell.title || movingCell.fileName || movingCell.name)) || 'Box'}</span>}
      </div>,
      document.body,
    )}
    {menu && (
      // The box's ··· menu (and the + menu of a box too small for its chooser).
      // Portaled to <body>, so it escapes .gridc { overflow:hidden } and stays
      // comfortable at any zoom. Every option reuses the same gridActions handlers.
      <GridCellMenu
        anchorRect={menu.anchorRect}
        mode={menu.mode}
        isImage={!!(model.cells[menu.cellId] && model.cells[menu.cellId].type === 'image' && model.cells[menu.cellId].src)}
        onEditPhoto={() => openPhotoEdit(menu.cellId, (cellElOf(menu.cellId) || { getBoundingClientRect: () => menu.anchorRect }).getBoundingClientRect())}
        onOpenFullScreen={() => openLightbox(menu.cellId)}
        onDownload={() => { const c = model.cells[menu.cellId]; if (c && c.src) downloadCell(c); }}
        onText={() => { gridActions.setCellContent(card.id, menu.cellId, { type: 'text', html: '' }); enterTextEdit(menu.cellId); }}
        onImage={() => gridActions.pickImageForCell(card.id, menu.cellId)}
        onLink={() => gridActions.addLinkToCell(card.id, menu.cellId)}
        onSplitRow={() => gridActions.splitCell(card.id, menu.cellId, 'row')}
        onSplitCol={() => gridActions.splitCell(card.id, menu.cellId, 'col')}
        onClear={() => clearCell(menu.cellId)}
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
          onDownload={() => downloadCell(c)}
          onClose={() => setPhotoFullModal(null)}
        />
      );
    })()}
    {lightbox && (() => {
      // Full-screen VIEWER (zoom/pan) for a cell image, with its own Download.
      // ImageLightbox portals itself to <body> (the transformed .canvas /
      // contain:paint .card would trap its position:fixed to the grid's box) and
      // stops its presses from bubbling back to this card.
      const c = model.cells[lightbox.cellId];
      if (!c || c.type !== 'image' || !c.src) return null;
      return (
        <ImageLightbox
          src={c.src} title={c.title || ''} alt={c.title || ''} adjust={c.adjust}
          cardId={`${card.id}:${lightbox.cellId}`}
          onClose={() => setLightbox(null)}
        />
      );
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
