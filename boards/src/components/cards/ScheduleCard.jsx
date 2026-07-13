// Schedule card — a real-date calendar container (kind:'schedule' with a
// `schedView`) whose slots are universal content holders, the calendar sibling
// of GridCard. Four switchable views per card (Month / Week / Day / Hour) with
// an in-card header (‹ title › nav + Today + view pill — INSIDE the card box,
// so the .card overflow:hidden/contain:paint clip never bites). Slots hold
// MULTIPLE items (standard grid cell records at `<slotPath>/i:<uid>` keys in
// the shared gridCells map): one item renders full-bleed like a grid cell;
// several stack as compact chips. A broken-down day renders its hour rows
// INLINE as glanceable stripes (see lib/schedLayout.js); working at small
// sizes goes through the Day/Hour Peek (SchedulePeek.jsx) — a local-only zoom
// panel any day slot opens (hover ⤢ / "+N more" / count pip / slot menu). The
// header title opens the date-jump popover (SchedDatePopover.jsx).
//
// Reactivity: like GridCard, item edits live in nested Y.Maps that don't bust
// the cards snapshot — useCardCellsVersion self-observes gridCells AND
// gridMeta (expand). Legacy schedule cards (rows table, no schedView) never
// reach this component (CanvasSurface renders the old table for them).

import { useEffect, useRef, useState } from 'react';
import { readSchedModel } from '../../lib/schedState.js';
import {
  SCHED_TUNING, computeSchedSlots, itemsForSlot, chipCapacity, mintItemKey, newUid, parseSlotKey,
  hourWindowForDay, dayKey,
} from '../../lib/schedLayout.js';
import {
  todayISO, addDays, addMonths, monthTitle, weekTitle, dayTitle, hourTitle,
} from '../../lib/schedDates.js';
import { effectiveCellStyle } from '../../lib/gridState.js';
import { hasFilterStages } from '../../lib/imageAdjust.js';
import { PerCardFilter } from '../ImageAdjustFilters.jsx';
import { RichNoteEditor } from '../RichNoteEditor.jsx';
import { Spinner } from '../Spinner.jsx';
import { Icon } from '../Icon.jsx';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, MoreHorizontal, X, Maximize2,
  Image as ImageIcon, Link as LinkIcon, FileText, Clapperboard,
} from '../../lib/icons.js';
import { GridCellMenu } from './GridCellMenu.jsx';
import { SchedulePeek } from './SchedulePeek.jsx';
import { SchedDatePopover } from './SchedDatePopover.jsx';
import { useCardCellsVersion, cellTextStyle, CellContent } from './gridCellShared.jsx';
import './gridCard.css';
import './scheduleCard.css';

const stop = (e) => e.stopPropagation();

const VIEWS = [
  { id: 'month', label: 'M', tip: 'Month' },
  { id: 'week', label: 'W', tip: 'Week' },
  { id: 'day', label: 'D', tip: 'Day' },
  { id: 'hour', label: 'H', tip: 'Hour' },
];

function viewTitle(view, anchor, anchorHour) {
  if (view === 'month') return monthTitle(anchor);
  if (view === 'week') return weekTitle(anchor);
  if (view === 'day') return dayTitle(anchor);
  return hourTitle(anchor, anchorHour);
}

// One compact chip row for an item in a multi-item slot. Board/link chips are
// their own click affordance; the rest read as labeled type chips. A hover ×
// removes the item (true key delete — not a {type:'empty'} tombstone).
function ChipX({ onRemove }) {
  if (!onRemove) return null;
  return (
    <button type="button" className="schedc-chip-x" title="Remove" aria-label="Remove"
      onPointerDown={stop} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}>
      <Icon as={X} size={9} />
    </button>
  );
}

function SlotChip({ itemKey, cell, boards, onOpenBoard, onRemove = null, passive = false }) {
  const type = cell?.type || 'empty';
  if (type === 'board' && cell.boardId) {
    const b = boards?.[cell.boardId];
    const missing = !b;
    const name = b?.name || cell.name || 'Cluster';
    if (passive) {
      // Month/week grid chips are pure ink — the CELL is the interactive
      // element (click opens the day); pointer-events:none in CSS makes
      // clicks fall through.
      return (
        <span className={`schedc-chip is-board${missing ? ' is-missing' : ''}`} data-cell-id={itemKey}>
          <span className="schedc-chip-dot" aria-hidden="true" />
          <span className="schedc-chip-txt">{missing ? `${name} (removed)` : name}</span>
        </span>
      );
    }
    return (
      <span className={`schedc-chip is-board${missing ? ' is-missing' : ''}`} data-cell-id={itemKey}
        role="button" tabIndex={missing ? -1 : 0} onPointerDown={stop}
        title={missing ? 'This cluster was removed' : `Open ${name}`}
        onClick={(e) => { e.stopPropagation(); if (!missing) onOpenBoard?.(cell.boardId); }}>
        <span className="schedc-chip-dot" aria-hidden="true" />
        <span className="schedc-chip-txt">{missing ? `${name} (removed)` : name}</span>
        <ChipX onRemove={onRemove} />
      </span>
    );
  }
  if (type === 'link') {
    if (passive) {
      return (
        <span className="schedc-chip is-link" data-cell-id={itemKey}>
          {cell.favicon
            ? <img className="schedc-chip-fav" src={cell.favicon} alt="" />
            : <span className="schedc-chip-ico"><Icon as={LinkIcon} size={10} /></span>}
          <span className="schedc-chip-txt">{cell.title || cell.source || cell.link}</span>
        </span>
      );
    }
    return (
      <a className="schedc-chip is-link" data-cell-id={itemKey} href={cell.source || cell.link || '#'}
        target="_blank" rel="noreferrer" onClick={stop} onPointerDown={stop}
        title={cell.title || cell.source || cell.link}>
        {cell.favicon
          ? <img className="schedc-chip-fav" src={cell.favicon} alt="" />
          : <span className="schedc-chip-ico"><Icon as={LinkIcon} size={10} /></span>}
        <span className="schedc-chip-txt">{cell.title || cell.source || cell.link}</span>
        <ChipX onRemove={onRemove} />
      </a>
    );
  }
  if (type === 'image' && cell.src) {
    return (
      <span className="schedc-chip is-image" data-cell-id={itemKey} title={cell.title || 'Image'}>
        <span className="schedc-chip-ico"><Icon as={ImageIcon} size={10} /></span>
        <span className="schedc-chip-txt">{cell.title || 'Image'}</span>
        <ChipX onRemove={onRemove} />
      </span>
    );
  }
  if (type === 'text') {
    const txt = String(cell.html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    return (
      <span className="schedc-chip is-text" data-cell-id={itemKey} title={txt}>
        <span className="schedc-chip-txt">{txt || 'Text'}</span>
        <ChipX onRemove={onRemove} />
      </span>
    );
  }
  if (type === 'video') {
    return (
      <span className="schedc-chip is-video" data-cell-id={itemKey} title="Video">
        <span className="schedc-chip-ico"><Icon as={Clapperboard} size={10} /></span>
        <span className="schedc-chip-txt">Video</span>
        <ChipX onRemove={onRemove} />
      </span>
    );
  }
  if (type === 'file') {
    return (
      <span className="schedc-chip is-file" data-cell-id={itemKey} title={cell.fileName || 'File'}>
        <span className="schedc-chip-ico"><Icon as={FileText} size={10} /></span>
        <span className="schedc-chip-txt">{cell.fileName || 'File'}</span>
        <ChipX onRemove={onRemove} />
      </span>
    );
  }
  return null;
}

export function ScheduleCard({ card, w, h, ydoc, cardYMap, isSelected = false, canEdit = false,
                               gridActions = null, getAwareness = null, boardId = null,
                               focusedCellId = null, dropCellId = null, cellUploads = null,
                               boards = null, onOpenBoard = null, onUpdate = null }) {
  useCardCellsVersion(cardYMap, ['gridCells', 'gridMeta']);
  const [menu, setMenu] = useState(null);            // { slotKey, anchorRect, surface } — pop-out add/options menu
  // Full-bleed text item in edit mode. Surface-scoped ('card' | 'peek') — the
  // same item key can render on BOTH surfaces at once, and only one may mount
  // a live RichNoteEditor for it.
  const [editing, setEditing] = useState(null);      // { itemKey, surface }
  // The Day/Hour Peek — LOCAL-ONLY zoom state (never written to the card, so
  // collaborators' views are untouched). hour == null → day peek (hour rows);
  // hour set → the same panel re-targeted to full-size minute rows.
  const [peek, setPeek] = useState(null);            // { date, hour, sourceRect }
  const [datePop, setDatePop] = useState(null);      // { anchorRect } — the title's date-jump popover
  // Where the last pointerdown landed on a passive grid cell — the click-vs-
  // drag guard (there is NO global click suppression after card drags; a >4px
  // drag that started on a cell still emits a native click on it).
  const downRef = useRef(null);                      // { key, x, y }

  const editable = canEdit && !!gridActions;
  const model = readSchedModel(card, ydoc);
  const anchor = model.anchor || todayISO();
  const cellKeys = Object.keys(model.cells);
  const todayIso = todayISO();

  // Live now-line (Day view + day peek, today only). A 60s tick re-renders so
  // the line tracks the clock; the interval only runs while a line is visible.
  const [, setNowTick] = useState(0);
  const nowLineActive = (model.view === 'day' && anchor === todayIso)
    || (peek != null && peek.hour == null && peek.date === todayIso);
  useEffect(() => {
    if (!nowLineActive) return undefined;
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [nowLineActive]);
  const renderNowLine = (slotList) => {
    const now = new Date();
    const s = slotList.find((x) => x.kind === 'hour' && !x.band
      && x.date === todayIso && x.hour === now.getHours());
    if (!s) return null;
    const y = s.rect.y + s.rect.h * (now.getMinutes() / 60);
    return (
      <div className="schedc-nowline" aria-hidden="true"
        style={{ top: y, left: s.rect.x, width: s.rect.w }}>
        <span className="schedc-nowline-dot" />
      </div>
    );
  };

  const headerH = SCHED_TUNING.HEADER_H;
  const bodyW = Math.max(0, w);
  const bodyH = Math.max(0, h - headerH);
  const { slots, weekdayLabels } = computeSchedSlots({
    view: model.view, anchor, anchorHour: model.anchorHour,
    w: bodyW, h: bodyH, expand: model.expand, cellKeys,
  });

  const enterTextEdit = (itemKey, surface = 'card') => { setEditing({ itemKey, surface }); gridActions?.setCellEditing?.(card.id, itemKey); };
  const exitTextEdit = (itemKey) => { setEditing((p) => (p?.itemKey === itemKey ? null : p)); gridActions?.setCellEditing?.(null, null); };

  // Header actions — schedView/anchor/anchorHour are plain card fields, so nav
  // is just updateCard (undo-tracked, snapshot-busting).
  const shift = (dir) => {
    if (!onUpdate) return;
    if (model.view === 'month') onUpdate({ anchor: addMonths(anchor, dir) });
    else if (model.view === 'week') onUpdate({ anchor: addDays(anchor, dir * 7) });
    else if (model.view === 'day') onUpdate({ anchor: addDays(anchor, dir) });
    else {
      const hh = model.anchorHour + dir;
      if (hh < 0) onUpdate({ anchor: addDays(anchor, -1), anchorHour: 23 });
      else if (hh > 23) onUpdate({ anchor: addDays(anchor, 1), anchorHour: 0 });
      else onUpdate({ anchorHour: hh });
    }
  };

  // Uploads arrive keyed by item path; surface a spinner on the slot that
  // contains each in-flight key (prefix match — keys are opaque elsewhere).
  const slotUploading = (slotKey) => {
    if (!cellUploads) return false;
    for (const k in cellUploads) if (k === slotKey || k.startsWith(`${slotKey}/`)) return true;
    return false;
  };

  // A minted-once add: every component-owned affordance writes ITEM keys, so
  // the generic grid mutators need no append semantics.
  const addText = (slotKey, surface = 'card') => {
    const itemKey = mintItemKey(slotKey, newUid());
    gridActions.setCellContent(card.id, itemKey, { type: 'text', html: '' });
    enterTextEdit(itemKey, surface);
  };
  const addImage = (slotKey) => gridActions.pickImageForCell(card.id, mintItemKey(slotKey, newUid()));
  const addLink = (slotKey) => gridActions.addLinkToCell(card.id, mintItemKey(slotKey, newUid()));

  // Open (or re-target) the peek from a slot's trigger/overflow affordance.
  // From the card, the panel anchors beside the source slot; from inside the
  // panel (hour → minutes), it stays where it is.
  const openPeek = (s, el, rectOverride = null) => {
    const rect = rectOverride || (el?.closest?.('.schedc-slot') || el)?.getBoundingClientRect?.() || null;
    setPeek((p) => ({
      date: s.date,
      hour: s.kind === 'hour' || s.kind === 'minute' ? s.hour : null,
      sourceRect: p?.sourceRect || rect,
    }));
  };
  const stepPeek = (dir) => setPeek((p) => {
    if (!p) return p;
    if (p.hour == null) return { ...p, date: addDays(p.date, dir) };
    const hh = p.hour + dir;
    if (hh < 0) return { ...p, date: addDays(p.date, -1), hour: 23 };
    if (hh > 23) return { ...p, date: addDays(p.date, 1), hour: 0 };
    return { ...p, hour: hh };
  });

  // One shared slot renderer for BOTH surfaces — the card body and the Day/Hour
  // Peek panel. Same keys, same data-cell-id wiring, same chips/menus/drops, so
  // panel slots engage every attribute-driven CanvasSurface pipeline for free.
  const renderSlotLayer = (slotList, surface) => slotList.map((s) => {
    // Click-into-day: the month/week grid is a read-only overview — cells are
    // buttons that open the Day Peek, chips are pure ink, and ALL slot editing
    // lives in the peek (or the Day/Hour views, which are already "inside").
    // Drag-drop onto cells stays live at every tier.
    const passive = surface === 'card' && (model.view === 'month' || model.view === 'week');
    const direct = itemsForSlot(s.key, cellKeys);
    // A collapsed day/hour aggregates everything under it so breakdown
    // content is never invisible; expanded slots show direct items only
    // (the nested rows render their own).
    const deepAgg = !s.expanded && !s.band;
    const itemKeys = deepAgg ? itemsForSlot(s.key, cellKeys, { deep: true }) : direct;
    const items = itemKeys
      .map((k) => ({ k, cell: model.cells[k] }))
      .filter((it) => it.cell && it.cell.type && it.cell.type !== 'empty'
        && !(it.cell.type === 'image' && !it.cell.src));
    const isDrop = dropCellId === s.key || (dropCellId && dropCellId.startsWith(`${s.key}/i:`));
    const isFocused = focusedCellId === s.key || (focusedCellId && focusedCellId.startsWith(`${s.key}/i:`));
    const labelH = s.kind === 'day' && !s.band ? SCHED_TUNING.DAY_LABEL_H : 0;
    // One item in a comfortable slot renders full-bleed like a grid
    // cell (image cover, board thumb + open); otherwise compact chips.
    const editingHere = editing && editing.surface === surface && itemKeys.includes(editing.itemKey);
    const fullBleed = !editingHere && items.length === 1
      && (s.rect.h - labelH) >= 34 && !s.band && !s.expanded;
    // Hour/minute rows in the peek and the Day/Hour views run the taller,
    // legible ROW_CHIP_H chips (CSS mirror: the 22px row-chip rules); month
    // cells and bands keep the compact CHIP_H.
    const rowChips = (s.kind === 'hour' || s.kind === 'minute') && !s.band
      && (surface === 'peek' || model.view === 'day' || model.view === 'hour');
    const cap = chipCapacity(s.rect, s.kind === 'day' && !s.band ? 'day' : 'hour',
      rowChips ? { chipH: SCHED_TUNING.ROW_CHIP_H } : undefined);
    const shown = fullBleed || editingHere ? [] : items.slice(0, Math.max(0, cap === 0 ? 0 : cap - (items.length > cap ? 1 : 0)));
    const overflow = fullBleed || editingHere ? 0 : items.length - shown.length;
    const timeLabel = surface === 'peek'
      ? (s.kind === 'hour' || s.kind === 'minute') && !s.band
      : (model.view === 'day' && s.kind === 'hour' && !s.band)
        || (model.view === 'hour' && s.kind === 'minute');
    // The ⤢ button survives only where the cell isn't already the button:
    // the Day-view all-day band on the card, and hour rows inside a day peek
    // (re-target the panel to full-size minutes). Month/week cells open the
    // peek by plain click; minute slots never peek.
    const peekable = surface === 'card'
      ? model.view === 'day' && s.kind === 'day'
      : s.kind === 'hour' && !s.band && peek?.hour == null;
    return (
      <div key={s.key}
        className={[
          'schedc-slot', `schedc-slot-${s.kind}`,
          s.band ? 'is-band' : '', s.outside ? 'is-outside' : '',
          s.isToday && s.kind === 'day' ? 'is-today' : '',
          s.weekend ? 'is-weekend' : '',
          s.kind === 'hour' && !s.band && s.hour % 2 === 1 ? 'is-alt' : '',
          (s.kind === 'hour' || s.kind === 'minute') && !s.band && s.rect.h < 8 ? 'is-sliver' : '',
          s.expanded ? 'is-expanded' : '',
          isDrop ? 'is-drop' : '', isFocused ? 'is-focused' : '',
        ].filter(Boolean).join(' ')}
        data-cell-id={s.key}
        style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h }}
        onPointerDownCapture={(e) => {
          if (passive) {
            // Read-only grid: never focus cells here (kills month-level paste
            // AND any stale Day-view focus — CanvasSurface skips clearing when
            // the pointerdown target is a [data-cell-id]). Just remember where
            // the press started for the click-vs-drag guard.
            downRef.current = { key: s.key, x: e.clientX, y: e.clientY };
            gridActions?.focusCell?.(null, null);
            return;
          }
          if (!editable || !gridActions.focusCell) return;
          // Clicking a chip focuses THAT item (paste replaces it); the
          // slot background focuses the slot (paste appends).
          const hit = e.target?.closest?.('[data-cell-id]');
          gridActions.focusCell(card.id, hit?.getAttribute?.('data-cell-id') || s.key);
        }}
        onClick={passive && s.date ? (e) => {
          // The cell is the button — but only for a true click: a >4px card
          // drag that started here still emits a native click, and a click
          // whose pointerdown landed on a different slot is a drag artifact.
          const d = downRef.current;
          if (!d || d.key !== s.key) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
          e.stopPropagation();
          // Nested inline hour/minute rows open their DAY — grid granularity
          // is glanceable only; the peek is where hours are worked.
          openPeek({ kind: 'day', date: s.date }, e.currentTarget);
        } : undefined}
        onDoubleClick={editable && !passive ? (e) => {
          e.stopPropagation();
          // Double-tap an empty region of a slot → a fresh text item in
          // edit mode (mirrors the grid's empty-cell double-tap). Item
          // chrome (chips / full-bleed items / triggers) owns its own
          // double-click, so never mint over it.
          if (!editing && !e.target?.closest?.('.schedc-chip, .schedc-item-full, .schedc-count, .gridc-pill-mini, .schedc-peek-btn')) addText(s.key, surface);
        } : undefined}
        onDragOver={editable ? (e) => { e.preventDefault(); } : undefined}
        onDrop={editable ? (e) => {
          const files = e.dataTransfer?.files;
          if (files && files.length) {
            e.preventDefault(); e.stopPropagation();
            gridActions.fillCellFromFiles(card.id, mintItemKey(s.key, newUid()), files);
          }
        } : undefined}
      >
        {s.kind === 'day' && !s.band && (
          <span className="schedc-slot-label">{s.label}</span>
        )}
        {(s.band || timeLabel) && (
          <span className="schedc-time-label">{s.label}</span>
        )}
        {editingHere ? (
          <div className="schedc-item-full gc-text-edit" onPointerDown={stop}>
            <RichNoteEditor
              html={model.cells[editing.itemKey]?.html || ''}
              autoFocus
              onChangeHTML={(html) => gridActions.setCellContent(card.id, editing.itemKey, { html })}
              onEditingChange={(ed) => { if (!ed) exitTextEdit(editing.itemKey); }}
              awareness={getAwareness ? (getAwareness() || null) : null}
              cardId={`${card.id}:${editing.itemKey}`}
              boardId={boardId}
            />
          </div>
        ) : fullBleed ? (
          <div className="schedc-item-full" data-cell-id={items[0].k}
            style={{ top: labelH }}
            onDoubleClick={editable && !passive && items[0].cell.type === 'text' ? (e) => { e.stopPropagation(); enterTextEdit(items[0].k, surface); } : undefined}>
            <CellContent cell={items[0].cell} rect={{ ...s.rect, h: s.rect.h - labelH }}
              boards={boards} onOpenBoard={onOpenBoard}
              textStyle={cellTextStyle(effectiveCellStyle(null, items[0].cell))}
              cardId={card.id} cellId={items[0].k} />
            {editable && !passive && (
              <button type="button" className="schedc-item-x" title="Remove" aria-label="Remove"
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); gridActions.removeCellRecord?.(card.id, items[0].k); }}>
                <Icon as={X} size={11} />
              </button>
            )}
          </div>
        ) : (shown.length || overflow > 0) && cap > 0 ? (
          <div className="schedc-chips" style={{ top: labelH || undefined }}>
            {shown.map((it) => (
              <SlotChip key={it.k} itemKey={it.k} cell={it.cell} boards={boards} onOpenBoard={onOpenBoard}
                passive={passive}
                onRemove={editable && !passive ? () => gridActions.removeCellRecord?.(card.id, it.k) : null} />
            ))}
            {overflow > 0 && (passive ? (
              // Passive marker on the grid — the CELL opens the day.
              <span className="schedc-chip is-more">
                <span className="schedc-chip-txt">+{overflow} more</span>
              </span>
            ) : (
              <button type="button" className="schedc-chip is-more" title={`${overflow} more — open day`}
                onPointerDown={stop}
                onClick={s.date ? (e) => { e.stopPropagation(); openPeek(s, e.currentTarget); } : undefined}>
                <span className="schedc-chip-txt">+{overflow} more</span>
              </button>
            ))}
          </div>
        ) : (items.length > 0 && cap === 0) ? (
          passive ? (
            <span className="schedc-count">{items.length}</span>
          ) : (
            <button type="button" className="schedc-count" title={`${items.length} item${items.length > 1 ? 's' : ''} — open day`}
              onPointerDown={stop}
              onClick={s.date ? (e) => { e.stopPropagation(); openPeek(s, e.currentTarget); } : undefined}>
              {items.length}
            </button>
          )
        ) : null}
        {slotUploading(s.key) && (
          <div className="gridc-cell-uploading" aria-label="Uploading">
            <Spinner size={16} tone="on-dark" label="Uploading" />
          </div>
        )}
        {!passive && (peekable || (editable && (!s.expanded || s.band))) && (
          <div className="schedc-slottools">
            {peekable && (
              <button type="button" className="schedc-peek-btn"
                title={s.kind === 'hour' ? 'Open hour' : 'Open day'}
                aria-label={s.kind === 'hour' ? 'Open hour' : 'Open day'}
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); openPeek(s, e.currentTarget); }}>
                <Icon as={Maximize2} size={11} />
              </button>
            )}
            {editable && (!s.expanded || s.band) && (
              // Bands are "expanded" by construction but ARE the day/hour-level
              // slot — with the grid read-only they're the only menu-based
              // day-level add left, so they keep the mini.
              <button type="button" className="gridc-pill-mini schedc-mini"
                title="Add content" aria-label="Add content"
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); setMenu({ slotKey: s.key, anchorRect: (e.currentTarget.closest('.schedc-slot') || e.currentTarget).getBoundingClientRect(), surface, band: !!s.band }); }}>
                <span className="gridc-ico"><Icon as={items.length ? MoreHorizontal : Plus} size={14} /></span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  });

  const title = viewTitle(model.view, anchor, model.anchorHour);

  // Peek geometry — the SAME pure layout engine as the card body, just fed a
  // GENEROUS height (PEEK_ROW_H per hour / PEEK_MINUTE_ROW_H per quarter) so
  // rows come out big; the panel body scrolls if the window overflows.
  let peekSlots = null, peekContentH = 0, peekTitle = '';
  if (peek) {
    const G = SCHED_TUNING.GUTTER_PX;
    const isHourPeek = peek.hour != null;
    const rows = isHourPeek
      ? Math.max(1, Math.floor(60 / SCHED_TUNING.MINUTE_STEP))
      : (() => { const w2 = hourWindowForDay(peek.date, cellKeys, model.expand); return w2.to - w2.from; })();
    const rowH = isHourPeek ? SCHED_TUNING.PEEK_MINUTE_ROW_H : SCHED_TUNING.PEEK_ROW_H;
    peekContentH = SCHED_TUNING.BAND_H + G + rows * rowH + G * (rows - 1);
    peekSlots = computeSchedSlots({
      view: isHourPeek ? 'hour' : 'day', anchor: peek.date, anchorHour: peek.hour ?? 9,
      w: SCHED_TUNING.PEEK_W, h: peekContentH, expand: model.expand, cellKeys,
    }).slots;
    peekTitle = isHourPeek ? hourTitle(peek.date, peek.hour) : dayTitle(peek.date);
  }

  return (
    <>
      <div className={`schedc is-view-${model.view}`} data-grid-id={card.id}>
        <div className="schedc-head">
          {editable && (
            <button type="button" className="schedc-nav" title="Previous" aria-label="Previous"
              onPointerDown={stop} onClick={(e) => { e.stopPropagation(); shift(-1); }}>
              <Icon as={ChevronLeft} size={13} />
            </button>
          )}
          {editable ? (
            <button type="button" className="schedc-title" title={`${title} — jump to date`}
              aria-haspopup="dialog"
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                // Read the rect EAGERLY — updaters run after React nulls
                // e.currentTarget, and this crashed in longer sessions.
                const anchorRect = e.currentTarget.getBoundingClientRect();
                setDatePop((p) => (p ? null : { anchorRect }));
              }}>
              <span className="schedc-title-txt">{title}</span>
              <Icon as={ChevronDown} size={9} />
            </button>
          ) : (
            <span className="schedc-title" title={title}>{title}</span>
          )}
          {editable && (
            <button type="button" className="schedc-nav" title="Next" aria-label="Next"
              onPointerDown={stop} onClick={(e) => { e.stopPropagation(); shift(1); }}>
              <Icon as={ChevronRight} size={13} />
            </button>
          )}
          <span className="schedc-spring" />
          {editable && (
            <button type="button" className="schedc-today" title="Go to today" aria-label="Go to today"
              onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onUpdate?.({ anchor: todayISO() }); }}>
              <span className="schedc-today-dot" aria-hidden="true" />
            </button>
          )}
          {editable && (
            <span className="schedc-pill" role="group" aria-label="Schedule view">
              {VIEWS.map((v) => (
                <button key={v.id} type="button"
                  className={`schedc-pill-btn${model.view === v.id ? ' is-active' : ''}`}
                  title={v.tip} aria-label={`${v.tip} view`}
                  onPointerDown={stop}
                  onClick={(e) => { e.stopPropagation(); if (model.view !== v.id) onUpdate?.({ schedView: v.id }); }}>
                  {v.label}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="schedc-body" style={{ height: bodyH }}>
          {weekdayLabels && (
            <div className="schedc-weekdays" style={{ height: SCHED_TUNING.WEEKDAY_H }}>
              {weekdayLabels.map((d) => <span key={d} className="schedc-wd">{d}</span>)}
            </div>
          )}
          {renderSlotLayer(slots, 'card')}
          {model.view === 'day' && anchor === todayIso && renderNowLine(slots)}
        </div>
      </div>
      {editable && menu && (
        <GridCellMenu
          anchorRect={menu.anchorRect}
          mode="empty"
          onText={() => addText(menu.slotKey, menu.surface)}
          onImage={() => addImage(menu.slotKey)}
          onLink={() => addLink(menu.slotKey)}
          extraItems={(() => {
            // Breakdown straight from the slot menu (collapse lives in the
            // card's right-click menu — expanded slots hide the trigger),
            // plus the peek as a menu affordance for slots too small to hover.
            const slot = parseSlotKey(menu.slotKey);
            const items = [];
            // Bands ARE the surface they'd "open"/"break" — plain add only.
            if (slot?.kind === 'day' && !menu.band) {
              items.push({ id: 'open-day', label: 'Open day', icon: Maximize2, onClick: () => openPeek({ kind: 'day', date: slot.date }, null, menu.anchorRect) });
              if (gridActions.setSlotExpand) items.push({ id: 'break-hours', label: 'Break into hours', onClick: () => gridActions.setSlotExpand(card.id, menu.slotKey, 'hours') });
            }
            if (slot?.kind === 'hour' && !menu.band) {
              items.push({ id: 'open-hour', label: 'Open hour', icon: Maximize2, onClick: () => openPeek({ kind: 'hour', date: slot.date, hour: slot.hour }, null, menu.anchorRect) });
              if (gridActions.setSlotExpand) items.push({ id: 'break-minutes', label: 'Break into minutes', onClick: () => gridActions.setSlotExpand(card.id, menu.slotKey, 'minutes') });
            }
            return items.length ? items : null;
          })()}
          onClose={() => setMenu(null)}
        />
      )}
      {editable && datePop && (
        <SchedDatePopover anchorRect={datePop.anchorRect} anchor={anchor}
          onPick={(date) => { onUpdate?.({ anchor: date }); setDatePop(null); }}
          onClose={() => setDatePop(null)} />
      )}
      {peek && peekSlots && (
        <SchedulePeek cardId={card.id} title={peekTitle} sourceRect={peek.sourceRect}
          contentH={peekContentH} hourMode={peek.hour != null}
          onPrev={() => stepPeek(-1)} onNext={() => stepPeek(1)}
          onBack={peek.hour != null ? () => setPeek((p) => (p ? { ...p, hour: null } : p)) : null}
          onOpenAsDayView={editable && onUpdate ? () => { onUpdate({ schedView: 'day', anchor: peek.date }); setPeek(null); } : null}
          gridHours={peek.hour == null && model.expand[dayKey(peek.date)] === 'hours'}
          onToggleGridHours={peek.hour == null && editable && gridActions?.setSlotExpand ? () => {
            const k = dayKey(peek.date);
            gridActions.setSlotExpand(card.id, k, model.expand[k] === 'hours' ? null : 'hours');
          } : null}
          onClose={() => setPeek(null)}>
          {renderSlotLayer(peekSlots, 'peek')}
          {peek.hour == null && peek.date === todayIso && renderNowLine(peekSlots)}
        </SchedulePeek>
      )}
      {(() => {
        // Per-item photo-adjust SVG filter defs — owned HERE (not CanvasSurface's
        // ImageAdjustFilters) because a nested adjust edit doesn't bust the cards
        // snapshot; this card self-observes gridCells (same pattern as GridCard).
        const adjusted = cellKeys.filter((k) => {
          const c = model.cells[k];
          return c && c.type === 'image' && c.src && hasFilterStages(c.adjust);
        });
        return adjusted.length ? (
          <svg width="0" height="0" aria-hidden="true" focusable="false"
               style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <defs>
              {adjusted.map((k) => <PerCardFilter key={k} cardId={`${card.id}:${k}`} adjust={model.cells[k].adjust} />)}
            </defs>
          </svg>
        ) : null;
      })()}
    </>
  );
}
