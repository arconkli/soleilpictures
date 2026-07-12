// Schedule card — a real-date calendar container (kind:'schedule' with a
// `schedView`) whose slots are universal content holders, the calendar sibling
// of GridCard. Four switchable views per card (Month / Week / Day / Hour) with
// an in-card header (‹ title › nav + Today + view pill — INSIDE the card box,
// so the .card overflow:hidden/contain:paint clip never bites). Slots hold
// MULTIPLE items (standard grid cell records at `<slotPath>/i:<uid>` keys in
// the shared gridCells map): one item renders full-bleed like a grid cell;
// several stack as compact chips with a "+N more" drill-in. A broken-down day
// renders its hour rows INLINE (see lib/schedLayout.js) — zoom the canvas to
// work in small slots, exactly like deep grid grafts.
//
// Reactivity: like GridCard, item edits live in nested Y.Maps that don't bust
// the cards snapshot — useCardCellsVersion self-observes gridCells AND
// gridMeta (expand). Legacy schedule cards (rows table, no schedView) never
// reach this component (CanvasSurface renders the old table for them).

import { useState } from 'react';
import { readSchedModel } from '../../lib/schedState.js';
import {
  SCHED_TUNING, computeSchedSlots, itemsForSlot, chipCapacity, mintItemKey, newUid,
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
  ChevronLeft, ChevronRight, Plus, MoreHorizontal, X,
  Image as ImageIcon, Link as LinkIcon, FileText, Clapperboard,
} from '../../lib/icons.js';
import { GridCellMenu } from './GridCellMenu.jsx';
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

function SlotChip({ itemKey, cell, boards, onOpenBoard, onRemove = null }) {
  const type = cell?.type || 'empty';
  if (type === 'board' && cell.boardId) {
    const b = boards?.[cell.boardId];
    const missing = !b;
    const name = b?.name || cell.name || 'Cluster';
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
  const [menu, setMenu] = useState(null);            // { slotKey, anchorRect } — pop-out add/options menu
  const [editingItemKey, setEditingItemKey] = useState(null); // full-bleed text item being edited

  const editable = canEdit && !!gridActions;
  const model = readSchedModel(card, ydoc);
  const anchor = model.anchor || todayISO();
  const cellKeys = Object.keys(model.cells);

  const headerH = SCHED_TUNING.HEADER_H;
  const bodyW = Math.max(0, w);
  const bodyH = Math.max(0, h - headerH);
  const { slots, weekdayLabels } = computeSchedSlots({
    view: model.view, anchor, anchorHour: model.anchorHour,
    w: bodyW, h: bodyH, expand: model.expand, cellKeys,
  });

  const enterTextEdit = (itemKey) => { setEditingItemKey(itemKey); gridActions?.setCellEditing?.(card.id, itemKey); };
  const exitTextEdit = (itemKey) => { setEditingItemKey((p) => (p === itemKey ? null : p)); gridActions?.setCellEditing?.(null, null); };

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
  const uploadingSlots = new Set();
  if (cellUploads) {
    for (const k in cellUploads) {
      for (const s of slots) if (k === s.key || k.startsWith(`${s.key}/`)) uploadingSlots.add(s.key);
    }
  }

  // A minted-once add: every component-owned affordance writes ITEM keys, so
  // the generic grid mutators need no append semantics.
  const addText = (slotKey) => {
    const itemKey = mintItemKey(slotKey, newUid());
    gridActions.setCellContent(card.id, itemKey, { type: 'text', html: '' });
    enterTextEdit(itemKey);
  };
  const addImage = (slotKey) => gridActions.pickImageForCell(card.id, mintItemKey(slotKey, newUid()));
  const addLink = (slotKey) => gridActions.addLinkToCell(card.id, mintItemKey(slotKey, newUid()));

  const title = viewTitle(model.view, anchor, model.anchorHour);

  return (
    <>
      <div className="schedc" data-grid-id={card.id}>
        <div className="schedc-head">
          {editable && (
            <button type="button" className="schedc-nav" title="Previous" aria-label="Previous"
              onPointerDown={stop} onClick={(e) => { e.stopPropagation(); shift(-1); }}>
              <Icon as={ChevronLeft} size={13} />
            </button>
          )}
          <span className="schedc-title" title={title}>{title}</span>
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
          {slots.map((s) => {
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
            const editingHere = editingItemKey && itemKeys.includes(editingItemKey);
            const fullBleed = !editingHere && items.length === 1
              && (s.rect.h - labelH) >= 34 && !s.band && !s.expanded;
            const cap = chipCapacity(s.rect, s.kind === 'day' && !s.band ? 'day' : 'hour');
            const shown = fullBleed || editingHere ? [] : items.slice(0, Math.max(0, cap === 0 ? 0 : cap - (items.length > cap ? 1 : 0)));
            const overflow = fullBleed || editingHere ? 0 : items.length - shown.length;
            const timeLabel = (model.view === 'day' && s.kind === 'hour' && !s.band)
              || (model.view === 'hour' && s.kind === 'minute');
            return (
              <div key={s.key}
                className={[
                  'schedc-slot', `schedc-slot-${s.kind}`,
                  s.band ? 'is-band' : '', s.outside ? 'is-outside' : '',
                  s.isToday && s.kind === 'day' ? 'is-today' : '',
                  s.expanded ? 'is-expanded' : '',
                  isDrop ? 'is-drop' : '', isFocused ? 'is-focused' : '',
                ].filter(Boolean).join(' ')}
                data-cell-id={s.key}
                style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h }}
                onPointerDownCapture={editable && gridActions.focusCell ? (e) => {
                  // Clicking a chip focuses THAT item (paste replaces it); the
                  // slot background focuses the slot (paste appends).
                  const hit = e.target?.closest?.('[data-cell-id]');
                  gridActions.focusCell(card.id, hit?.getAttribute?.('data-cell-id') || s.key);
                } : undefined}
                onDoubleClick={editable ? (e) => {
                  e.stopPropagation();
                  // Double-tap an empty region of a slot → a fresh text item in
                  // edit mode (mirrors the grid's empty-cell double-tap). Item
                  // chrome (chips / full-bleed items / triggers) owns its own
                  // double-click, so never mint over it.
                  if (!editingItemKey && !e.target?.closest?.('.schedc-chip, .schedc-item-full, .schedc-count, .gridc-pill-mini')) addText(s.key);
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
                      html={model.cells[editingItemKey]?.html || ''}
                      autoFocus
                      onChangeHTML={(html) => gridActions.setCellContent(card.id, editingItemKey, { html })}
                      onEditingChange={(ed) => { if (!ed) exitTextEdit(editingItemKey); }}
                      awareness={getAwareness ? (getAwareness() || null) : null}
                      cardId={`${card.id}:${editingItemKey}`}
                      boardId={boardId}
                    />
                  </div>
                ) : fullBleed ? (
                  <div className="schedc-item-full" data-cell-id={items[0].k}
                    style={{ top: labelH }}
                    onDoubleClick={editable && items[0].cell.type === 'text' ? (e) => { e.stopPropagation(); enterTextEdit(items[0].k); } : undefined}>
                    <CellContent cell={items[0].cell} rect={{ ...s.rect, h: s.rect.h - labelH }}
                      boards={boards} onOpenBoard={onOpenBoard}
                      textStyle={cellTextStyle(effectiveCellStyle(null, items[0].cell))}
                      cardId={card.id} cellId={items[0].k} />
                    {editable && (
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
                        onRemove={editable ? () => gridActions.removeCellRecord?.(card.id, it.k) : null} />
                    ))}
                    {overflow > 0 && (
                      <button type="button" className="schedc-chip is-more" title={`${overflow} more — open day`}
                        onPointerDown={stop}
                        onClick={editable && onUpdate && s.date ? (e) => { e.stopPropagation(); onUpdate({ schedView: 'day', anchor: s.date }); } : undefined}>
                        <span className="schedc-chip-txt">+{overflow} more</span>
                      </button>
                    )}
                  </div>
                ) : (items.length > 0 && cap === 0) ? (
                  <button type="button" className="schedc-count" title={`${items.length} item${items.length > 1 ? 's' : ''} — open day`}
                    onPointerDown={stop}
                    onClick={editable && onUpdate && s.date ? (e) => { e.stopPropagation(); onUpdate({ schedView: 'day', anchor: s.date }); } : undefined}>
                    {items.length}
                  </button>
                ) : null}
                {cellUploads && uploadingSlots.has(s.key) && (
                  <div className="gridc-cell-uploading" aria-label="Uploading">
                    <Spinner size={16} tone="on-dark" label="Uploading" />
                  </div>
                )}
                {editable && !s.expanded && (
                  <div className="schedc-slottools">
                    <button type="button" className="gridc-pill-mini schedc-mini"
                      title="Add content" aria-label="Add content"
                      onPointerDown={stop}
                      onClick={(e) => { e.stopPropagation(); setMenu({ slotKey: s.key, anchorRect: (e.currentTarget.closest('.schedc-slot') || e.currentTarget).getBoundingClientRect() }); }}>
                      <span className="gridc-ico"><Icon as={items.length ? MoreHorizontal : Plus} size={14} /></span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {editable && menu && (
        <GridCellMenu
          anchorRect={menu.anchorRect}
          mode="empty"
          onText={() => addText(menu.slotKey)}
          onImage={() => addImage(menu.slotKey)}
          onLink={() => addLink(menu.slotKey)}
          onClose={() => setMenu(null)}
        />
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
