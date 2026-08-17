// The day rail — the half of the schedule card where the work actually is.
//
// A month grid is very good at one question ("what is the shape of this
// schedule") and structurally incapable of another ("what is happening on the
// 8th, and when do I show up"). A day cell is about 90px wide; that is a date
// and a dot. Everything a production day needs to say — a start time, a place,
// how many things are on it, whether the call sheet has been published — needs
// a ROW.
//
// So the card is two panes. The grid keeps the shape; the rail lists the days
// with real anatomy, and it is a permanent part of the card rather than a
// popover, because a panel that covers the calendar you were just reading is
// how you lose your place. This is the overview+detail pairing every calendar
// app of any quality has landed on.
//
// Selection is LOCAL, like navigation (see schedViewRegistry.js): a schedule
// shared with fifty people must not scroll under everyone else because one
// person clicked a day.

import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { Clapperboard, Plus } from '../../lib/icons.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import {
  MONTHS_SHORT, WEEKDAYS, parseISO, weekdayOf, clockLabel, clockRange, shortDate,
} from '../../lib/schedDates.js';
import { dayTypesFor, dayTypeColor, dayTypeName } from '../../lib/dayTypes.js';
import { SCHED_TUNING } from '../../lib/schedLayout.js';

const stop = (e) => e.stopPropagation();

// A day's headline. day_label is the durable half of a day's identity ("Day
// 14", "Travel", "Company Move"); the date is never baked into it, so a moved
// day can't carry a stale title (0238).
function dayName(b) {
  return (b.day_label || '').trim() || b.name || 'Day';
}

// ── One day ─────────────────────────────────────────────────────────────────
// Two lines, always, so the rail scans as a column rather than a ragged list:
//   line 1  Day 14                      7:00 AM
//   line 2  Stage 4 · Production           ● v3
// The phase colour is a 3px bar down the left edge — a fill would fight the
// text at this density, and an edge reads as a spine when the rows stack.
function DayRow({
  board, date, types, selected, dragging, draggable,
  onOpen, onSelect, onPointerDown,
}) {
  const status = board.sched_status || 'draft';
  const published = status === 'published' && board.sched_version > 0;
  const hue = dayTypeColor(board, types);
  const typeName = dayTypeName(board, types);
  const time = clockRange(board.day_start, board.day_end);
  const place = (board.day_place || '').trim();
  // Second line: place first (it is what someone is looking for), type as
  // context. When a day has neither, fall back to the date so the row is never
  // a single orphaned line.
  const sub = [place, typeName].filter(Boolean).join(' · ')
    || `${WEEKDAYS[weekdayOf(date)]} ${shortDate(date)}`;
  const statusTip = status === 'cancelled' ? 'Cancelled'
    : published ? `Call sheet v${board.sched_version}` : 'Not published yet';

  return (
    <div
      className={[
        'schedc-dayrow', `is-${status}`,
        selected ? 'is-selected' : '', dragging ? 'is-dragging' : '',
        draggable ? 'is-draggable' : '',
      ].filter(Boolean).join(' ')}
      role="button" tabIndex={0}
      aria-label={`${dayName(board)}${time ? `, ${time}` : ''}${place ? `, ${place}` : ''} — ${statusTip}`}
      title={draggable ? 'Drag to another date to move this day' : undefined}
      style={hue ? { '--dayrow-hue': hue } : undefined}
      onPointerDown={draggable ? onPointerDown : stop}
      // With a drag armed, the open fires from pointerup-without-movement in
      // startRowDrag — preventDefault there can swallow the click entirely.
      onClick={(e) => { e.stopPropagation(); onSelect?.(); if (!draggable) onOpen?.(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); onOpen?.();
      }}
    >
      <span className="schedc-dayrow-bar" aria-hidden="true" />
      <span className="schedc-dayrow-main">
        <span className="schedc-dayrow-l1">
          <span className="schedc-dayrow-name">{dayName(board)}</span>
          {time && <span className="schedc-dayrow-time">{time}</span>}
        </span>
        <span className="schedc-dayrow-l2">
          <span className="schedc-dayrow-sub">{sub}</span>
          {/* Status is a MARK, not a word. A schedule being built is all
              draft, so spelling it out on every row is 22 repetitions of the
              default state — noise that crowds out the place name beside it.
              An unfilled ring reads as "not sent yet" at a glance and keeps
              its full meaning in the tooltip and the accessible name. */}
          <span className={`schedc-dayrow-status is-${status}`} title={statusTip}>
            {status === 'cancelled'
              ? 'Cancelled'
              : published ? `v${board.sched_version}` : '○'}
          </span>
        </span>
      </span>
    </div>
  );
}

// Loose Yjs content on a date, as one row. Deliberately quieter than a day: a
// reference photo pinned to a Tuesday is not the same kind of object as a
// production day, and the calendar should not pretend otherwise.
function LooseRow({ date, count, selected, onSelect, onOpen }) {
  return (
    <div className={`schedc-dayrow is-loose${selected ? ' is-selected' : ''}`}
      role="button" tabIndex={0}
      aria-label={`${count} item${count === 1 ? '' : 's'} on ${shortDate(date)}`}
      onPointerDown={stop}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); onOpen?.();
      }}>
      <span className="schedc-dayrow-bar" aria-hidden="true" />
      <span className="schedc-dayrow-main">
        <span className="schedc-dayrow-l1">
          <span className="schedc-dayrow-name is-quiet">
            {count} item{count === 1 ? '' : 's'}
          </span>
        </span>
        <span className="schedc-dayrow-l2">
          <span className="schedc-dayrow-sub">
            {WEEKDAYS[weekdayOf(date)]} {shortDate(date)}
          </span>
        </span>
      </span>
    </div>
  );
}

export function ScheduleRail({
  rect = null, rows, todayIso, next, types: typesProp, parentBoard,
  selectedDate, onSelectDate, onOpenBoard, onGoToDate, onPeekDate,
  editable = false, rowDrag = null, onRowPointerDown, onAddDay,
}) {
  const bodyRef = useRef(null);
  const types = useMemo(() => typesProp || dayTypesFor(parentBoard), [typesProp, parentBoard]);
  useScrollEdges(bodyRef);

  const todayRow = rows.find((r) => r.isToday) || null;
  const todayBoard = todayRow?.days?.find((b) => b.sched_status !== 'cancelled') || null;
  const todayInRange = !!todayRow;

  // Keep the selected day on screen when selection comes from the GRID — the
  // whole point of clicking a cell is to read its row, and a row twelve
  // scroll-heights down is not read. 'nearest' so an already-visible row
  // doesn't jump.
  useEffect(() => {
    if (!selectedDate || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`[data-rail-date="${selectedDate}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedDate]);

  // Group by month so a 3-month strip's rail has somewhere to breathe. A single
  // month gets no headers — they would label the one thing already in the title.
  const groups = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const t = parseISO(r.date);
      const key = t ? `${t.y}-${t.m}` : '?';
      if (!out.length || out[out.length - 1].key !== key) {
        out.push({ key, label: t ? `${MONTHS_SHORT[t.m - 1]} ${t.y}` : '', rows: [] });
      }
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [rows]);

  return (
    // `rect` is the legacy absolute placement from when the rail was a second
    // pane. It is now the List density and fills the body, so without a rect it
    // lays out in flow.
    <div className={`schedc-rail${rect ? '' : ' is-flow'}`}
      style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : undefined}
      onPointerDown={stop}>

      {/* ── Today / Up next ──────────────────────────────────────────────────
          Pinned, never scrolled away. The single most important line on a call
          sheet is the general call time, and it should be readable without
          hunting for it — so it is the largest thing in the rail. */}
      <div className="schedc-today-block">
        {todayInRange ? (
          <>
            <span className="schedc-today-label">
              Today · {WEEKDAYS[weekdayOf(todayIso)]} {shortDate(todayIso)}
            </span>
            {todayBoard ? (
              <button type="button" className="schedc-today-main"
                onPointerDown={stop}
                onClick={(e) => { e.stopPropagation(); onOpenBoard?.(todayBoard.id); }}>
                {clockLabel(todayBoard.day_start) ? (
                  <span className="schedc-today-time">{clockLabel(todayBoard.day_start)}</span>
                ) : (
                  <span className="schedc-today-time is-none">No start time</span>
                )}
                <span className="schedc-today-meta">
                  {dayName(todayBoard)}
                  {todayBoard.day_place ? ` · ${todayBoard.day_place}` : ''}
                </span>
              </button>
            ) : (
              <span className="schedc-today-empty">Nothing scheduled</span>
            )}
          </>
        ) : (
          <button type="button" className="schedc-today-jump"
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); onGoToDate?.(todayIso); }}>
            Today is not in view — jump to it
          </button>
        )}
        {next && next.date > todayIso && (
          <button type="button" className="schedc-next"
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); onOpenBoard?.(next.board.id); }}>
            <span className="schedc-next-k">Next</span>
            <span className="schedc-next-v">
              {WEEKDAYS[weekdayOf(next.date)]} {shortDate(next.date)}
              {clockLabel(next.board.day_start) ? ` · ${clockLabel(next.board.day_start)}` : ''}
            </span>
          </button>
        )}
      </div>

      <div className="schedc-rail-body" ref={bodyRef}>
        {groups.length === 0 ? (
          <p className="schedc-rail-empty">
            Nothing on the calendar yet.
            {editable && onAddDay ? ' Right-click a date to add days.' : ''}
          </p>
        ) : groups.map((g) => (
          <div key={g.key} className="schedc-rail-group">
            {groups.length > 1 && (
              <div className="schedc-rail-head" style={{ height: SCHED_TUNING.RAIL_HEAD_H }}>
                {g.label}
              </div>
            )}
            {g.rows.map((r) => (
              <div key={r.date} data-rail-date={r.date}
                className={[
                  'schedc-rail-date',
                  r.isToday ? 'is-today' : '', r.weekend ? 'is-weekend' : '',
                  rowDrag?.overDate === r.date ? 'is-drop' : '',
                ].filter(Boolean).join(' ')}>
                {/* The date mark is also the way into the day's hours. The
                    peek is no longer what a click on the grid reaches for, so
                    it needs an affordance that is actually visible rather than
                    only a double-click nobody is told about. */}
                <button type="button" className="schedc-rail-datemark"
                  title={`Open ${WEEKDAYS[weekdayOf(r.date)]} ${shortDate(r.date)} by the hour`}
                  aria-label={`Open ${WEEKDAYS[weekdayOf(r.date)]} ${shortDate(r.date)} by the hour`}
                  onPointerDown={stop}
                  onClick={(e) => { e.stopPropagation(); onSelectDate?.(r.date); onPeekDate?.(r.date); }}>
                  <span className="schedc-rail-dow">{WEEKDAYS[weekdayOf(r.date)]}</span>
                  <span className="schedc-rail-dnum">{parseISO(r.date)?.d}</span>
                </button>
                <div className="schedc-rail-stack">
                  {r.days.map((b) => (
                    <DayRow key={b.id} board={b} date={r.date} types={types}
                      selected={selectedDate === r.date}
                      draggable={editable && !!onRowPointerDown}
                      dragging={rowDrag?.boardId === b.id}
                      onPointerDown={(e) => onRowPointerDown?.(e, b)}
                      onSelect={() => onSelectDate?.(r.date)}
                      onOpen={() => onOpenBoard?.(b.id)} />
                  ))}
                  {r.loose > 0 && (
                    <LooseRow date={r.date} count={r.loose}
                      selected={selectedDate === r.date && !r.days.length}
                      onSelect={() => onSelectDate?.(r.date)}
                      onOpen={() => onGoToDate?.(r.date, { view: 'day' })} />
                  )}
                  {!r.days.length && !r.loose && (
                    <div className="schedc-rail-none">
                      <span>Nothing scheduled</span>
                      {editable && onAddDay && (
                        <button type="button" className="schedc-rail-add"
                          title="Add a day here" aria-label="Add a day here"
                          onPointerDown={stop}
                          onClick={(e) => { e.stopPropagation(); onAddDay(r.date); }}>
                          <Icon as={Plus} size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {editable && onAddDay && (
        <button type="button" className="schedc-rail-foot"
          onPointerDown={stop}
          onClick={(e) => { e.stopPropagation(); onAddDay(selectedDate || todayIso); }}>
          <Icon as={Clapperboard} size={13} />
          <span>Add days…</span>
        </button>
      )}
    </div>
  );
}
