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
import { createPortal } from 'react-dom';
import { readSchedModel } from '../../lib/schedState.js';
import {
  SCHED_TUNING, computeSchedSlots, itemsForSlot, chipCapacity, mintItemKey, newUid, parseSlotKey,
  hourWindowForDay, dayKey, hourKey, schedLodTier, schedDayCounts,
  schedVisibleRange, schedDayRows, schedNextDay, schedSizeForMonths,
} from '../../lib/schedLayout.js';
import { dayTypesFor, dayTypeColor } from '../../lib/dayTypes.js';
import { ScheduleRail } from './ScheduleRail.jsx';
import { ScheduleRundown } from './ScheduleRundown.jsx';
import { ScheduleWall } from './ScheduleWall.jsx';
import { ScheduleTiles } from './ScheduleTiles.jsx';
import {
  normalizeDensity, CAL_DENSITIES, productionSpan, calWeeks,
} from '../../lib/schedCalendar.js';
import {
  rundownFromCells, rundownKey, materializeLegacy, computeRundown,
  ordForIndex, ordForMove, RUNDOWN_TUNING,
} from '../../lib/rundown.js';
import { setViewAnchor, clearViewAnchor } from '../../lib/schedViewRegistry.js';
import { nextDayNumber as nextShootDayNumber } from '../../lib/productionDayPlan.js';
import {
  todayISO, addDays, addMonths, monthTitle, weekTitle, dayTitle, hourTitle,
  monthMatrix, startOfWeek, daysBetween,
} from '../../lib/schedDates.js';
import { getCanvasScale } from '../../lib/canvasScale.js';
import { useCanvasSettleTick } from '../../hooks/useCanvasSettleTick.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { effectiveCellStyle } from '../../lib/gridState.js';
import { hasFilterStages } from '../../lib/imageAdjust.js';
import { PerCardFilter } from '../ImageAdjustFilters.jsx';
import { RichNoteEditor } from '../RichNoteEditor.jsx';
import { Spinner } from '../Spinner.jsx';
import { Icon } from '../Icon.jsx';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, MoreHorizontal, X, Maximize2,
  Image as ImageIcon, Link as LinkIcon, FileText, Clapperboard, Minimize2,
} from '../../lib/icons.js';
import { GridCellMenu } from './GridCellMenu.jsx';
import { SchedulePeek } from './SchedulePeek.jsx';
import { SchedDatePopover } from './SchedDatePopover.jsx';
import { ShootDayRange } from './ShootDayRange.jsx';
import { useCardCellsVersion, cellTextStyle, CellContent } from './gridCellShared.jsx';
import { startTouchScrollGesture } from '../../lib/touchScroll.js';
import './gridCard.css';
import './scheduleCard.css';

const stop = (e) => e.stopPropagation();
// Same as `stop`, but first lets a one-finger drag scroll the clipped editor
// body — see lib/touchScroll.js for why the browser can't do it here.
const stopWithTouchScroll = (e) => { startTouchScrollGesture(e); e.stopPropagation(); };

// How many months a month-view card can tile at once. 3 is a block of
// principal photography, which is the case this exists for.
const MONTH_SPANS = [1, 3, 6];

// Three densities of the same calendar, one control. Grid is kept rather than
// traded away: a release plan or a prep calendar IS sparse, and sparse is the
// one thing a month grid is genuinely good at. Tiles is the production default
// because in a production nearly every day is a board, and a tile can show it.
const DENSITIES = [
  { id: 'tiles', label: '▦', tip: 'Day tiles' },
  { id: 'list',  label: '☰', tip: 'List' },
  { id: 'grid',  label: '▤', tip: 'Month grid' },
];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Hour view is gone. Its whole job was subdividing one hour into four
// 15-minute buckets, which is meaningless once an item can be 2h15 — it only
// ever existed as a workaround for not having durations. A stored
// schedView:'hour' coerces to 'day' in readSchedModel so old cards still open.
const VIEWS = [
  { id: 'month', label: 'M', tip: 'Month' },
  { id: 'week', label: 'W', tip: 'Week' },
  { id: 'day', label: 'D', tip: 'Day' },
];

function viewTitle(view, anchor, anchorHour, months = 1) {
  if (view === 'month') {
    if (months <= 1) return monthTitle(anchor);
    // A production strip spans a block, so name the block: "August – October
    // 2026", dropping the repeated year when both ends share one.
    const last = addMonths(anchor, months - 1);
    const a = monthTitle(anchor), b = monthTitle(last);
    const ay = a.slice(a.lastIndexOf(' ') + 1), by = b.slice(b.lastIndexOf(' ') + 1);
    return ay === by ? `${a.slice(0, a.lastIndexOf(' '))} – ${b}` : `${a} – ${b}`;
  }
  if (view === 'week') return weekTitle(anchor);
  if (view === 'day') return dayTitle(anchor);
  return hourTitle(anchor, anchorHour);
}

// Dated child clusters indexed by every date they occupy — a multi-day block
// (travel, a company move) appears on each day it covers. Only DIRECT children
// of the cluster holding this calendar: a production's days are its children,
// and walking deeper would pull unrelated dated clusters onto the grid.
function shootDaysByDate(boards, parentId) {
  const out = {};
  if (!boards || !parentId) return out;
  for (const id in boards) {
    const b = boards[id];
    if (!b || b.parent_board_id !== parentId || !b.scheduled_date) continue;
    let d = b.scheduled_date;
    const end = b.scheduled_end && b.scheduled_end >= d ? b.scheduled_end : d;
    // Bounded: a mis-entered range must not spin here.
    for (let i = 0; i < 400 && d <= end; i++) {
      (out[d] || (out[d] = [])).push(b);
      if (d === end) break;
      d = addDays(d, 1);
    }
  }
  for (const k in out) {
    out[k].sort((x, y) => String(x.day_label || x.name).localeCompare(String(y.day_label || y.name)));
  }
  return out;
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

// A shoot day sitting on a date. THE deliberate exception to the read-only
// month grid: content chips there stay pure ink (pointer-events:none) because
// inline editing in a dense calendar produced constant mis-clicks, but moving a
// whole day is the one thing a production schedule exists to do, and making
// people open a panel to change a date would miss the entire point. The tile is
// a distinct element, so the rule for CONTENT is untouched.
// Colour is PHASE now, not publish state (lib/dayTypes.js). Hue on a calendar
// should answer "what is the shape of this schedule" — three weeks of prep,
// eight of production, a hiatus — and publish state cannot: once a shoot is
// running every day is published and the whole grid is one wall of green. The
// version badge moved to the rail row, where there is room to read it.
function DayTile({ board, hue, compact = false, draggable, dragging, onPointerDown, onOpen }) {
  const label = board.day_label || board.name || 'Day';
  const status = board.sched_status || 'draft';
  const published = status === 'published' && board.sched_version > 0;
  const title = status === 'cancelled'
    ? `${label} — cancelled`
    : `${label}${published ? ` — call sheet v${board.sched_version}` : ' — not published yet'}`
      + (draggable ? ' · drag to another date to move it' : '');
  return (
    <span
      className={[
        'schedc-daytile', `is-${status}`, compact ? 'is-compact' : '',
        dragging ? 'is-dragging' : '', draggable ? 'is-draggable' : '',
      ].filter(Boolean).join(' ')}
      style={hue ? { '--daytile-hue': hue } : undefined}
      title={title} role="button" tabIndex={0} aria-label={title}
      // When draggable, the OPEN happens on pointerup-without-movement inside
      // startTileDrag — preventDefault there can swallow the click event.
      onPointerDown={draggable ? onPointerDown : stop}
      onClick={(e) => { e.stopPropagation(); if (!draggable) onOpen?.(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); onOpen?.();
      }}>
      {/* Below ~64px a label is not a label, it is "Day…". A 3-month strip
          gives a tile about 46px, which is where the old design ellipsised the
          product's core noun into three characters and a full stop. The bar
          still says a day is here and which phase it is; the rail beside it
          says which day, at a size you can read. */}
      {!compact && <span className="schedc-daytile-txt">{label}</span>}
    </span>
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

// Full-screen is refcounted on the body the same way DocCard's overlay is, so
// the (body-portaled) notifications panel can lift above it while it's up and
// drop back below ordinary modals when it isn't.
let openSchedOverlays = 0;

export function ScheduleCard({ card, w, h, ydoc, cardYMap, canEdit = false,
                               gridActions = null, getAwareness = null, boardId = null,
                               focusedCellId = null, dropCellId = null, cellUploads = null,
                               boards = null, onOpenBoard = null, onUpdate = null,
                               // Dated child clusters — the shoot days. Moving one is a
                               // Postgres write (set_board_schedule), not a Y.Doc edit, so it
                               // arrives as a callback rather than through gridActions.
                               onSetSchedule = null, onAddShootDay = null }) {
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
  const [rangePop, setRangePop] = useState(null);    // { anchorRect, date } — "Add shoot days"
  // Where the last pointerdown landed on a passive grid cell — the click-vs-
  // drag guard (there is NO global click suppression after card drags; a >4px
  // drag that started on a cell still emits a native click on it).
  const downRef = useRef(null);                      // { key, x, y }
  const rootRef = useRef(null);

  const editable = canEdit && !!gridActions;
  const model = readSchedModel(card, ydoc);
  const cellKeys = Object.keys(model.cells);
  const todayIso = todayISO();

  // WHERE THIS VIEWER IS LOOKING — local, never written to the card.
  //
  // Navigation used to be updateCard({anchor}), so paging to next month moved
  // the view for every collaborator and pushed an undo entry. On a production
  // calendar shared with a crew that is unusable. The card field is now the
  // SAVED DEFAULT (where the card opens); these two decide what you see.
  // Both move together or the hour view splits its brain across midnight, so
  // every nav affordance — ‹ ›, Today, the date popover, the peek's "Day view"
  // — goes through goTo() and nothing else writes them.
  const [viewAnchor, setViewAnchor_] = useState(null);
  const [viewHour, setViewHour] = useState(null);
  // A dated day cluster mid-drag: { boardId, overDate } — see startTileDrag.
  const [tileDrag, setTileDrag] = useState(null);
  // Which date the rail is showing as selected. Local for the same reason the
  // anchor is: a schedule shared with fifty people must not scroll under
  // everyone else because one person clicked a cell.
  const [selDate, setSelDate] = useState(null);
  // Full screen. A production calendar is a wall chart; on a canvas among other
  // cards it is always negotiating for width with everything around it, and the
  // two-pane layout wants more room than a card politely takes. Local state:
  // nothing about it is written to the card, so it never moves for a
  // collaborator (same rule as the anchor and the selection).
  const [full, setFull] = useState(false);
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  // A schedule card inside a shoot day derives its date from the cluster it
  // lives on, so moving the day re-anchors its hour-by-hour with no cascade and
  // nothing to keep in sync.
  const boardDate = card?.anchorMode === 'board'
    ? (boards?.[boardId]?.scheduled_date || null) : null;
  const anchor = boardDate || viewAnchor || model.anchor || todayISO();
  const anchorHour = viewHour ?? model.anchorHour;
  const months = model.view === 'month'
    ? Math.max(1, Math.min(12, Math.round(card?.months) || 1)) : 1;
  // Which of the three calendar surfaces the month/week body renders as. Only
  // meaningful at full detail — mid is a density map and far is a poster, and
  // neither has room for a thumbnail.
  const density = normalizeDensity(card?.calDensity);

  const goTo = (nextAnchor, nextHour) => {
    if (boardDate) return;                       // the cluster's date owns this card
    setViewAnchor_(nextAnchor);
    if (nextHour != null) setViewHour(nextHour);
  };

  // Publish the live position so graftScheduleIntoSlot lifts the day the user
  // can actually SEE. Without this, local nav makes the graft read a stale
  // persisted anchor and silently refuse or lift the wrong day.
  useEffect(() => {
    setViewAnchor(card.id, { anchor, anchorHour });
    return () => clearViewAnchor(card.id);
  }, [card.id, anchor, anchorHour]);

  // Full-screen lifecycle: track the viewport, flag the body (so the
  // notifications panel can stack above), and take Escape on CAPTURE — the
  // canvas clears its selection on a bubbled Escape, and closing the overlay
  // must not also deselect whatever is underneath it. Yields to the peek and
  // to any open menu so one press closes one layer.
  useEffect(() => {
    if (!full) return undefined;
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.gridc-cell-menu, .schedc-peekpanel, .schedc-range')) return;
      e.stopPropagation();
      setFull(false);
    };
    openSchedOverlays += 1;
    document.body.setAttribute('data-doc-overlay', '1');
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
      openSchedOverlays = Math.max(0, openSchedOverlays - 1);
      if (openSchedOverlays === 0) document.body.removeAttribute('data-doc-overlay');
    };
  }, [full]);

  // The shoot days. These are real clusters with a date column, not Y.Doc
  // items — so they survive outside this card, every crew member sees the same
  // set, and moving one is a single authoritative write.
  const shootDays = shootDaysByDate(boards, boardId);
  const canMoveDays = editable && !!onSetSchedule;

  // Dragging a day tile to another date.
  //
  // The house pattern for an in-card gesture (GridCard.onDividerDown): stop the
  // event before the canvas wrapper's onCardPointerDown sees it, then listen on
  // WINDOW — the canvas deliberately doesn't use setPointerCapture, so a
  // capture here would fight it. The 4px arm distance matches the canvas's own
  // drag threshold, so a tile press that never moves stays a plain click.
  const tileDateAt = (ev) => {
    const el = document.elementsFromPoint(ev.clientX, ev.clientY)
      .find((n) => n?.matches?.('.schedc-slot-day[data-cell-id]'));
    const slot = el ? parseSlotKey(el.getAttribute('data-cell-id')) : null;
    return slot?.kind === 'day' ? slot.date : null;
  };
  const startTileDrag = (e, b) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    // The passive cell recorded this pointerdown for its click-into-day guard.
    // Clearing it is what stops a completed tile drag from also opening the peek.
    downRef.current = null;
    let armed = false;
    const move = (ev) => {
      if (!armed && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 4) return;
      armed = true;
      setTileDrag({ boardId: b.id, overDate: tileDateAt(ev) });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTileDrag(null);
      if (!armed) { onOpenBoard?.(b.id); return; }     // a click, not a drag
      const date = tileDateAt(ev);
      if (!date || date === b.scheduled_date) return;  // dropped nowhere, or home
      // A multi-day block keeps its length: dragging it moves the whole span.
      const span = daysBetween(b.scheduled_date, b.scheduled_end || b.scheduled_date);
      onSetSchedule?.(b.id, date, span > 0 ? addDays(date, span) : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Dragging a day OUT OF THE RAIL and onto a calendar date. Same gesture and
  // the same drop resolution as a tile drag — the rail is a second grip on the
  // same object, not a second way of moving it.
  const startRowDrag = (e, b) => startTileDrag(e, b);

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

  // LOD: how much detail this card can honestly show at its ON-SCREEN size
  // (layout px × settled canvas zoom). full = normal render · mid = density
  // map (counter-scaled date numbers + item dots) · far = poster. The peek
  // panel is screen-space and always renders full. Zoom reactivity comes from
  // an explicit settle subscription — never from parent re-renders.
  //
  // Measured against the CARD, not the calendar pane. The tier answers "how big
  // is this card on screen", and a card that grew a rail did not get less
  // legible — pushing the pane width in here would demote a perfectly readable
  // calendar the moment the rail appeared.
  useCanvasSettleTick();
  // Full screen is SCREEN space: the portal escapes the canvas transform, so
  // the zoom is 1 no matter where the canvas is, and the box is the viewport
  // less the 24px frame.
  const scale = full ? 1 : (getCanvasScale() || 1);
  const effW = full ? Math.max(320, vp.w - 48) : w;
  const effH = full ? Math.max(240, vp.h - 48) : h;
  const lod = schedLodTier({ view: model.view, w: effW, h: effH, scale, months });

  // HEADER CHROME COUNTER-SCALES WITH CANVAS ZOOM.
  //
  // A 32px control at canvas zoom 0.5 is 16px on screen, against Apple's 44pt
  // floor — on a card whose whole point is a crew member checking a call sheet
  // on an iPad on set. The LOD text already solves this with lodPx(); the
  // controls simply never adopted it.
  //
  // Capped at 2×, not unbounded: below zoom 0.5 an honest 44pt header would eat
  // a fifth of the card, and the card is on its way to the mid tier (which
  // replaces the whole header with a title) anyway.
  //
  // --chrome-k can only stop zoom from shrinking a control; it cannot raise the
  // resting size, and it shouldn't — a 44px button in a 44px header is cramped
  // with a mouse. The floor itself is a TOUCH requirement, so the base grows
  // only on a coarse pointer. The two multiply: 44 x 2 at zoom 0.5 is 44 on
  // screen. useBreakpoint is the house source of truth for this (never a bare
  // innerWidth read), and it must agree with the (pointer: coarse) block in
  // scheduleCard.css or the body overflows the box JS reserved for it.
  const { isTouch } = useBreakpoint();
  const chromeK = Math.min(2, Math.max(1, 1 / scale));
  const headerH = Math.round((isTouch ? 56 : SCHED_TUNING.HEADER_H) * chromeK);
  const bodyW = Math.max(0, effW);
  const bodyH = Math.max(0, effH - headerH);
  // Tiles and List are their own scrolling surfaces and want the whole body;
  // Grid goes through the slot engine. Mid and far always take the slot path —
  // a density map and a poster are what a card renders when it is too small for
  // any of this, and neither has room for a thumbnail.
  const showCal = lod === 'full' && model.view !== 'day' && density !== 'grid';
  const calRect = { x: 0, y: 0, w: bodyW, h: bodyH };
  const { slots, weekRules, weekdayLabels, monthBlocks } = computeSchedSlots({
    view: model.view, anchor, anchorHour, months,
    w: calRect.w, h: calRect.h, expand: model.expand, cellKeys,
  });

  // The rail needs counts on every date; the LOD density map only needs them
  // when it is the thing being drawn.
  const allDayCounts = schedDayCounts(model.cells);
  // Zoomed out, a date's dots must count its DATED CLUSTERS as well as its
  // loose Yjs items. schedDayCounts only knows about the Y.Doc, so a production
  // calendar — where every date's content IS a day cluster — used to go
  // completely blank the moment it demoted to the density map: twelve weeks of
  // work rendering as an empty lattice of numbers.
  const dayCounts = lod === 'full' ? null : (() => {
    const out = { ...allDayCounts };
    for (const d in shootDays) out[d] = (out[d] || 0) + shootDays[d].length;
    return out;
  })();

  // What the rail lists. Only computed when there IS a rail — schedDayRows
  // walks the whole visible range, which is 366 iterations for a 12-month card.
  const range = schedVisibleRange({ view: model.view, anchor, months, todayIso });
  const railRows = showCal
    ? schedDayRows({ ...range, shootDays, dayCounts: allDayCounts, todayIso }) : [];
  const railNext = showCal ? schedNextDay(shootDays, todayIso) : null;
  // The chart spans the whole PRODUCTION, not the month in view — its only job
  // is the shape of this shoot, and clipping it to what you happen to be
  // looking at would answer a question nobody asked.
  const wallSpan = showCal && model.view === 'month'
    ? productionSpan(shootDays, range) : null;
  // The palette belongs to the production — the cluster the dated days hang
  // off, which is the one holding this card.
  const dayTypes = dayTypesFor(boards?.[boardId]);
  // "Add days…" opened from the rail has no slot to anchor to, so it places
  // against the card itself.
  const railAnchorRect = () => rootRef.current?.getBoundingClientRect()
    || { left: 0, top: 0, width: 0, height: 0 };

  // ── The rundown ────────────────────────────────────────────────────────────
  // Which dated cluster this day belongs to, if any — it carries the day's
  // start time, planned wrap and place (0247), which is what turns a bare list
  // of durations into a schedule with a call time on it.
  const dayBoard = (shootDays[anchor] || []).find((b) => b.sched_status !== 'cancelled')
    || (card?.anchorMode === 'board' ? boards?.[boardId] : null)
    || null;
  const rundown = rundownFromCells(model.cells, anchor);

  // Every edit goes through here so the legacy rewrite can happen exactly once,
  // on the first touch, ahead of whatever the edit was.
  const rd = (() => {
    const flush = () => {
      if (!rundown.hasLegacy || !gridActions?.applyRundownPlan) return false;
      gridActions.applyRundownPlan(card.id, materializeLegacy(model.cells, anchor, newUid));
      return true;
    };
    // After a rewrite the old key is gone, so an edit aimed at it has nothing to
    // land on. Re-read and match the row by position instead.
    const keyAfterFlush = (key) => {
      if (!rundown.hasLegacy) return key;
      const before = computeRundown(rundown.items).rows.findIndex((r) => r.key === key);
      if (before < 0) return key;
      const after = computeRundown(rundownFromCells(readSchedModel(card, ydoc).cells, anchor).items).rows;
      return after[before]?.key || key;
    };
    const patch = (key, fields) => {
      const migrated = flush();
      const k = migrated ? keyAfterFlush(key) : key;
      gridActions?.setCellContent?.(card.id, k, fields);
    };
    return {
      patch,
      remove: (key) => {
        const migrated = flush();
        gridActions?.removeCellRecord?.(card.id, migrated ? keyAfterFlush(key) : key);
      },
      add: (index) => {
        flush();
        const rows = computeRundown(
          rundownFromCells(readSchedModel(card, ydoc).cells, anchor).items).rows;
        const key = rundownKey(anchor, newUid());
        gridActions?.setCellContent?.(card.id, key, {
          type: 'text', html: '', kind: 'item',
          dur: RUNDOWN_TUNING.DEFAULT_DUR, ord: ordForIndex(rows, index),
        });
        setEditing({ itemKey: key, surface: 'rundown' });
      },
      move: (from, to) => {
        flush();
        const rows = computeRundown(
          rundownFromCells(readSchedModel(card, ydoc).cells, anchor).items).rows;
        const ord = ordForMove(rows, from, to);
        if (!ord) return;                       // dropped where it already was
        gridActions?.setCellContent?.(card.id, rows[from].key, { ord });
      },
      editTitle: (key) => {
        const migrated = flush();
        setEditing({ itemKey: migrated ? keyAfterFlush(key) : key, surface: 'rundown' });
      },
    };
  })();
  // Counter-scaled sizes: layout px = target screen px / zoom, clamped so a
  // number can never overflow its cell.
  const lodPx = (targetPx, max) => Math.min(targetPx / scale, max);

  const enterTextEdit = (itemKey, surface = 'card') => { setEditing({ itemKey, surface }); gridActions?.setCellEditing?.(card.id, itemKey); };
  const exitTextEdit = (itemKey) => { setEditing((p) => (p?.itemKey === itemKey ? null : p)); gridActions?.setCellEditing?.(null, null); };

  // Header nav — LOCAL only. A month strip steps by its whole span so paging a
  // 3-month production calendar advances a quarter, not a month into the middle
  // of what you were already looking at.
  const shift = (dir) => {
    if (model.view === 'month') goTo(addMonths(anchor, dir * months));
    else if (model.view === 'week') goTo(addDays(anchor, dir * 7));
    else if (model.view === 'day') goTo(addDays(anchor, dir));
    else {
      const hh = anchorHour + dir;
      if (hh < 0) goTo(addDays(anchor, -1), 23);
      else if (hh > 23) goTo(addDays(anchor, 1), 0);
      else goTo(anchor, hh);
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
  //
  // YOU CANNOT MINT AN ITEM UNDER AN ITEM. The rundown row menu passes the ROW's
  // key here (`d:<date>/r:<uid>`), and minting under it produced
  // `d:<date>/r:<uid>/i:<uid>` — a key whose slot path parses as nothing, so
  // schedItems and schedDayCounts skip it and the row it was typed into never
  // shows it, while cellsWeight still charges a card for it. Typing produced
  // nothing; an upload vanished. Refusing is not the finished answer — the row
  // menu should be calling the rundown's own add — but a mint that cannot be
  // read is never the right write.
  const mintUnder = (slotKey) => (parseSlotKey(slotKey) ? mintItemKey(slotKey, newUid()) : null);
  const addText = (slotKey, surface = 'card') => {
    const itemKey = mintUnder(slotKey);
    if (!itemKey) return;
    gridActions.setCellContent(card.id, itemKey, { type: 'text', html: '' });
    enterTextEdit(itemKey, surface);
  };
  const addImage = (slotKey) => {
    const k = mintUnder(slotKey);
    if (k) gridActions.pickImageForCell(card.id, k);
  };
  const addLink = (slotKey) => {
    const k = mintUnder(slotKey);
    if (k) gridActions.addLinkToCell(card.id, k);
  };

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
    // Shoot days sit above the ad-hoc content and take their space out of the
    // chip budget, so a busy day degrades to "+N more" instead of overflowing.
    const tiles = s.kind === 'day' && !s.band && lod === 'full' ? (shootDays[s.date] || []) : [];
    // How many tiles honestly fit under the date strip. The old code laid out
    // ALL of them and let overflow:hidden eat the remainder, so a fourth day on
    // a busy date simply vanished.
    const tileCompact = s.rect.w < SCHED_TUNING.DAYTILE_COMPACT_W;
    const tileH = tileCompact ? SCHED_TUNING.DAYTILE_COMPACT_H : SCHED_TUNING.DAYTILE_H;
    const tileRoom = Math.max(0, Math.floor((s.rect.h - labelH - 2) / tileH));
    const tileCap = Math.max(1, tiles.length > tileRoom ? tileRoom - 1 : tileRoom);
    const tilesH = Math.min(tiles.length, tileCap + (tiles.length > tileCap ? 1 : 0)) * tileH;
    const isTileTarget = tileDrag && tileDrag.overDate === s.date;
    // One item in a comfortable slot renders full-bleed like a grid
    // cell (image cover, board thumb + open); otherwise compact chips.
    const editingHere = editing && editing.surface === surface && itemKeys.includes(editing.itemKey);
    const fullBleed = !editingHere && !tiles.length && items.length === 1
      && (s.rect.h - labelH) >= 34 && !s.band && !s.expanded;
    // Hour/minute rows in the peek and the Day/Hour views run the taller,
    // legible ROW_CHIP_H chips (CSS mirror: the 22px row-chip rules); month
    // cells and bands keep the compact CHIP_H.
    const rowChips = (s.kind === 'hour' || s.kind === 'minute') && !s.band
      && (surface === 'peek' || model.view === 'day' || model.view === 'hour');
    const cap = chipCapacity({ ...s.rect, h: Math.max(0, s.rect.h - tilesH) },
      s.kind === 'day' && !s.band ? 'day' : 'hour',
      rowChips ? { chipH: SCHED_TUNING.ROW_CHIP_H } : undefined);
    // MID tier: this slot renders as a density-map cell (counter-scaled date
    // number + item dots) instead of chips/labels/tools. Drops and the
    // click-into-day handler ride the identical outer div.
    const lodCell = surface === 'card' && lod === 'mid';
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
          lodCell ? 'is-lod' : '',
          isTileTarget ? 'is-tile-target' : '',
          s.kind === 'day' && !s.band && selDate === s.date ? 'is-selected' : '',
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
          // Clicking a cell SELECTS its day. In Grid density the peek is still
          // the detail surface, so a double-click opens it; in Tiles and List
          // the detail is already on screen and a popover over it would be
          // worse than useless.
          //
          // Nested inline hour/minute rows resolve to their DAY either way:
          // grid granularity is glanceable only.
          setSelDate(s.date);
        } : undefined}
        onDoubleClick={passive && s.date ? (e) => {
          // Single click selects the day; double click goes INTO it. The peek
          // is a zoom to hour resolution — still the only way to work an hour
          // of loose content, so it needs a door, just not the first one a
          // click reaches for.
          e.stopPropagation();
          openPeek({ kind: 'day', date: s.date }, e.currentTarget);
        } : editable && !passive ? (e) => {
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
        {lodCell ? (() => {
          // Density map: a readable date number + dots (or a count) sized in
          // SCREEN px via counter-scaling, clamped to the cell.
          const n = (s.kind === 'day' && !s.band ? dayCounts?.[s.date] : items.length) || 0;
          const dotPx = lodPx(SCHED_TUNING.LOD_DOT_PX, Math.max(2, s.rect.h * 0.14));
          return (
            <>
              {s.kind === 'day' && !s.band && (
                <span className="schedc-lod-num"
                  style={{ fontSize: lodPx(SCHED_TUNING.LOD_NUM_PX, Math.min(s.rect.h * 0.5, s.rect.w * 0.45)) }}>
                  {s.label}
                </span>
              )}
              {n > 0 && (n <= 4 ? (
                <span className="schedc-lod-dots">
                  {Array.from({ length: n }).map((_, i) => (
                    <span key={i} className="schedc-lod-dot" style={{ width: dotPx, height: dotPx }} />
                  ))}
                </span>
              ) : (
                <span className="schedc-lod-count"
                  style={{ fontSize: lodPx(SCHED_TUNING.LOD_COUNT_PX, s.rect.h * 0.4) }}>
                  {n}
                </span>
              ))}
            </>
          );
        })() : (<>
        {s.kind === 'day' && !s.band && (
          <span className="schedc-slot-label">{s.label}</span>
        )}
        {tiles.length > 0 && (
          <div className="schedc-daytiles" style={{ top: labelH }}>
            {tiles.slice(0, tileCap).map((b) => (
              <DayTile key={b.id} board={b} hue={dayTypeColor(b, dayTypes)}
                compact={tileCompact}
                draggable={canMoveDays}
                dragging={tileDrag?.boardId === b.id}
                onPointerDown={(e) => startTileDrag(e, b)}
                onOpen={() => onOpenBoard?.(b.id)} />
            ))}
            {tiles.length > tileCap && (
              // Previously the overflow was simply clipped by the slot's
              // overflow:hidden, so a fourth day on a busy date vanished with
              // nothing to say it existed.
              <span className="schedc-daytile is-more"
                title={`${tiles.length - tileCap} more on this date`}>
                <span className="schedc-daytile-txt">+{tiles.length - tileCap}</span>
              </span>
            )}
          </div>
        )}
        {(s.band || timeLabel) && (
          <span className="schedc-time-label">{s.label}</span>
        )}
        {editingHere ? (
          <div className="schedc-item-full gc-text-edit" onPointerDown={stopWithTouchScroll}>
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
          <div className="schedc-chips" style={{ top: (labelH + tilesH) || undefined }}>
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
        </>)}
      </div>
    );
  });

  const title = viewTitle(model.view, anchor, anchorHour, months);

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
      // PEEK_CONTENT_W, not PEEK_W. The panel is border-box and its body is
      // padded, so laying rows out at the OUTER width made every one of them
      // 14px wider than its container and `overflow:hidden` amputated the
      // right edge and the 6px radius of all of them.
      view: isHourPeek ? 'hour' : 'day', anchor: peek.date, anchorHour: peek.hour ?? 9,
      w: SCHED_TUNING.PEEK_CONTENT_W, h: peekContentH, expand: model.expand, cellKeys,
    }).slots;
    peekTitle = isHourPeek ? hourTitle(peek.date, peek.hour) : dayTitle(peek.date);
  }

  // FAR tier: the whole card becomes a poster — big counter-scaled title +
  // a dot lattice. Poster cells are REAL drop targets (data-cell-id + file
  // drop) and open the peek on a guarded click, so the card keeps its powers
  // at any distance.
  const renderPoster = () => {
    const posterDown = (key) => (e) => {
      downRef.current = { key, x: e.clientX, y: e.clientY };
      gridActions?.focusCell?.(null, null);
    };
    const posterClick = (key, dateIso) => (e) => {
      const d = downRef.current;
      if (!d || d.key !== key) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      e.stopPropagation();
      openPeek({ kind: 'day', date: dateIso }, e.currentTarget);
    };
    const dropProps = (slotKey) => (editable ? {
      onDragOver: (e) => { e.preventDefault(); },
      onDrop: (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length) {
          e.preventDefault(); e.stopPropagation();
          gridActions.fillCellFromFiles(card.id, mintItemKey(slotKey, newUid()), files);
        }
      },
    } : {});
    const dotPx = lodPx(SCHED_TUNING.LOD_DOT_PX, 12);
    const cells = model.view === 'month' ? monthMatrix(anchor)
      : model.view === 'week'
        ? Array.from({ length: 7 }, (_, i) => ({ date: addDays(startOfWeek(anchor), i), outside: false }))
        : null;
    const oneKey = model.view === 'hour' ? hourKey(anchor, anchorHour) : dayKey(anchor);
    const oneN = dayCounts?.[anchor] || 0;
    return (
      <div className="schedc-poster">
        <span className="schedc-poster-title"
          style={{ fontSize: lodPx(SCHED_TUNING.LOD_TITLE_PX * 1.25, 40) }}
          title={title}>
          {title}
        </span>
        {cells ? (
          <div className="schedc-poster-grid">
            {cells.map((c) => {
              const k = dayKey(c.date);
              const n = dayCounts?.[c.date] || 0;
              return (
                <div key={c.date} data-cell-id={k}
                  className={[
                    'schedc-poster-day',
                    c.outside ? 'is-outside' : '',
                    c.date === todayIso ? 'is-today' : '',
                    dropCellId === k || (dropCellId && dropCellId.startsWith(`${k}/`)) ? 'is-drop' : '',
                  ].filter(Boolean).join(' ')}
                  onPointerDownCapture={posterDown(k)}
                  onClick={posterClick(k, c.date)}
                  {...dropProps(k)}>
                  {n > 0 && <span className="schedc-lod-dot" style={{ width: dotPx, height: dotPx }} />}
                </div>
              );
            })}
          </div>
        ) : (
          <div data-cell-id={oneKey}
            className={`schedc-poster-one${dropCellId && dropCellId.startsWith(oneKey) ? ' is-drop' : ''}`}
            onPointerDownCapture={posterDown(oneKey)}
            onClick={posterClick(oneKey, anchor)}
            {...dropProps(oneKey)}>
            {oneN > 0 && (
              <span className="schedc-poster-count" style={{ fontSize: lodPx(SCHED_TUNING.LOD_COUNT_PX, 28) }}>
                {oneN}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // MID: month/week keep only their day cells (nested glance rows are noise
  // at this size); day/hour keep their rows (dots instead of text).
  const bodySlots = lod === 'mid' && (model.view === 'month' || model.view === 'week')
    ? slots.filter((s) => s.kind === 'day') : slots;

  // Full screen portals the card out of the canvas transform onto the body, so
  // it renders at true screen pixels instead of inheriting whatever zoom the
  // canvas is at. The scrim underneath is not decoration: without it the 24px
  // frame is a live canvas hit-zone and a press there starts a pan behind the
  // "fullscreen" calendar — the bug DocCard's backdrop exists to prevent.
  const shell = (node) => (full
    ? createPortal(
      <>
        <div className="schedc-fs-backdrop"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setFull(false)} />
        <div className="schedc-fs">{node}</div>
      </>,
      document.body,
    )
    : node);

  return (
    <>
      {shell(
      <div ref={rootRef}
        className={`schedc is-view-${model.view}${lod !== 'full' ? ` is-lod-${lod}` : ''}${showCal ? ' has-cal' : ''}${full ? ' is-fullscreen' : ''}`}
        data-grid-id={card.id}
        onPointerDown={full ? stop : undefined}>
        {lod === 'far' ? renderPoster() : (<>
        {lod === 'mid' ? (
          <div className="schedc-head is-lod">
            <span className="schedc-title schedc-lod-title" title={title}
              style={{ fontSize: lodPx(SCHED_TUNING.LOD_TITLE_PX, 24) }}>
              {title}
            </span>
          </div>
        ) : (
        <div className="schedc-head" style={{ flexBasis: headerH, '--chrome-k': chromeK }}>
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
              onPointerDown={stop} onClick={(e) => { e.stopPropagation(); goTo(todayISO()); }}>
              <span className="schedc-today-dot" aria-hidden="true" />
            </button>
          )}
          {editable && model.view === 'month' && (
            <span className="schedc-pill schedc-months" role="group" aria-label="Months shown">
              {MONTH_SPANS.map((n) => (
                <button key={n} type="button"
                  className={`schedc-mbtn${months === n ? ' is-active' : ''}`}
                  title={n === 1 ? 'One month' : `${n} months at once`}
                  aria-label={n === 1 ? 'Show one month' : `Show ${n} months`}
                  onPointerDown={stop}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (months === n) return;
                    // Grow the card to fit the span. Never shrink: a card
                    // someone has sized by hand is their decision, and coming
                    // back down from 6 months shouldn't undo it.
                    onUpdate?.({ months: n, ...schedSizeForMonths(n, { w, h }) });
                  }}>
                  {n}
                </button>
              ))}
            </span>
          )}
          <button type="button" className="schedc-nav schedc-full"
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            aria-pressed={full}
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); setFull((v) => !v); }}>
            <Icon as={full ? Minimize2 : Maximize2} size={14} />
          </button>
          {editable && model.view !== 'day' && lod === 'full' && (
            <span className="schedc-pill schedc-dens" role="group" aria-label="Calendar density">
              {DENSITIES.map((d) => (
                <button key={d.id} type="button"
                  className={`schedc-dbtn${density === d.id ? ' is-active' : ''}`}
                  title={d.tip} aria-label={d.tip} aria-pressed={density === d.id}
                  onPointerDown={stop}
                  onClick={(e) => { e.stopPropagation(); if (density !== d.id) onUpdate?.({ calDensity: d.id }); }}>
                  {d.label}
                </button>
              ))}
            </span>
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
        )}
        <div className="schedc-body" style={{ height: bodyH }}>
        {model.view === 'day' ? (
          <ScheduleRundown
            cardId={card.id} date={anchor} cells={rundown.items}
            dayStart={dayBoard?.day_start || null}
            plannedWrap={dayBoard?.day_end || null}
            place={dayBoard?.day_place || null}
            boards={boards} onOpenBoard={onOpenBoard}
            editable={editable}
            hueFor={() => dayTypeColor(dayBoard, dayTypes)}
            editingKey={editing?.surface === 'rundown' ? editing.itemKey : null}
            onCommitTitle={(key, text) => {
              gridActions?.setCellContent?.(card.id, key, { title: text });
              setEditing(null);
            }}
            onCancelTitle={() => setEditing(null)}
            onSetDur={(key, dur) => rd.patch(key, { dur })}
            onTogglePin={(key, clock) => rd.patch(key, { pin: clock })}
            onRemove={(key) => rd.remove(key)}
            onAdd={(index) => rd.add(index)}
            onMove={(from, to) => rd.move(from, to)}
            onEditTitle={(key) => rd.editTitle(key)}
            onOpenMenu={(key, e) => setMenu({
              slotKey: key, anchorRect: e.currentTarget.getBoundingClientRect(),
              surface: 'rundown',
            })}
          />
        ) : showCal ? (
          // Tiles / List: a scrolling surface, with the wall chart pinned above
          // it. No pane split — the chart does the navigator job the month grid
          // was doing badly, in a fifth of the space, which is what frees the
          // width the rail used to take.
          <div className="schedc-stack">
            {wallSpan && (
              <ScheduleWall
                {...wallSpan} todayIso={todayIso}
                shootDays={shootDays} dayCounts={allDayCounts} types={dayTypes}
                selectedDate={selDate}
                onPickDate={(date) => { setSelDate(date); goTo(date); }}
              />
            )}
            {density === 'tiles' ? (
              <ScheduleTiles
                from={range.from} to={range.to} todayIso={todayIso}
                shootDays={shootDays} dayCounts={allDayCounts} types={dayTypes}
                boards={boards} onOpenBoard={onOpenBoard}
                editable={editable}
                selectedDate={selDate} onSelectDate={setSelDate}
                onAddDay={editable && onAddShootDay
                  ? (date) => onAddShootDay({ from: date, to: date, scaffold: true, parentBoardId: boardId })
                  : null}
                tileDrag={tileDrag}
                onTilePointerDown={canMoveDays ? startTileDrag : null}
              />
            ) : (
              <ScheduleRail
                rows={railRows} todayIso={todayIso}
                next={railNext} types={dayTypes} parentBoard={boards?.[boardId]}
                selectedDate={selDate} onSelectDate={setSelDate}
                onPeekDate={(date) => openPeek({ kind: 'day', date }, null, railAnchorRect())}
                onOpenBoard={onOpenBoard}
                onGoToDate={(date, opts) => {
                  setSelDate(date);
                  goTo(date);
                  if (opts?.view && onUpdate) onUpdate({ schedView: opts.view });
                }}
                editable={editable}
                rowDrag={tileDrag}
                onRowPointerDown={canMoveDays ? startRowDrag : null}
                onAddDay={editable && onAddShootDay
                  ? (date) => setRangePop({ anchorRect: railAnchorRect(), date })
                  : null}
              />
            )}
          </div>
        ) : (
        <div className="schedc-cal" style={{
          left: calRect.x, top: calRect.y, width: calRect.w, height: calRect.h,
        }}>
          {weekdayLabels && (
            <div className="schedc-weekdays" style={{ height: SCHED_TUNING.WEEKDAY_H }}>
              {weekdayLabels.map((d) => <span key={d} className="schedc-wd">{d}</span>)}
            </div>
          )}
          {monthBlocks && monthBlocks.map((b) => (
            <div key={b.iso} className="schedc-mblock" aria-hidden="true">
              <div className="schedc-mcap" style={{
                left: b.captionRect.x, top: b.captionRect.y,
                width: b.captionRect.w, height: b.captionRect.h,
              }}>{b.label}</div>
              {lod === 'full' && (
                <div className="schedc-weekdays is-block" style={{
                  left: b.weekdayRect.x, top: b.weekdayRect.y,
                  width: b.weekdayRect.w, height: b.weekdayRect.h,
                }}>
                  {WEEKDAY_LABELS.map((d) => <span key={d} className="schedc-wd">{d}</span>)}
                </div>
              )}
            </div>
          ))}
          {lod === 'full' && weekRules?.map((r, i) => (
            <div key={`wr-${i}`} className="schedc-wrule" aria-hidden="true"
              style={{ left: r.x, top: r.y, width: r.w }} />
          ))}
          {renderSlotLayer(bodySlots, 'card')}
        </div>
        )}
        </div>
        </>)}
      </div>,
      )}
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
              // A shoot day is a dated CLUSTER, not a slot item — it outlives
              // this card and every crew member sees the same one.
              if (onAddShootDay) {
                items.push({ id: 'shoot-day', label: 'Add a day', icon: Clapperboard,
                  onClick: () => onAddShootDay({ from: slot.date, to: slot.date, scaffold: true, parentBoardId: boardId }) });
                items.push({ id: 'shoot-days', label: 'Add days…', icon: Clapperboard,
                  onClick: () => setRangePop({ anchorRect: menu.anchorRect, date: slot.date }) });
              }
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
      {editable && rangePop && (
        <ShootDayRange anchorRect={rangePop.anchorRect} startDate={rangePop.date}
          startNumber={nextShootDayNumber(boards, boardId)}
          onAdd={(opts) => onAddShootDay?.({ ...opts, parentBoardId: boardId })}
          onClose={() => setRangePop(null)} />
      )}
      {editable && datePop && (
        <SchedDatePopover anchorRect={datePop.anchorRect} anchor={anchor}
          onPick={(date) => { goTo(date); setDatePop(null); }}
          onClose={() => setDatePop(null)} />
      )}
      {peek && peekSlots && (
        <SchedulePeek cardId={card.id} title={peekTitle} sourceRect={peek.sourceRect}
          contentH={peekContentH} hourMode={peek.hour != null}
          onPrev={() => stepPeek(-1)} onNext={() => stepPeek(1)}
          onBack={peek.hour != null ? () => setPeek((p) => (p ? { ...p, hour: null } : p)) : null}
          onOpenAsDayView={editable && onUpdate ? () => { goTo(peek.date); onUpdate({ schedView: 'day' }); setPeek(null); } : null}
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
