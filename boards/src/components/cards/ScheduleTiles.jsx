// The contact sheet — weeks as rows, each day a tile showing its board.
//
// Nearly every day in a production IS a board: a cluster holding that day's
// call sheet, shotlist, script pages and running order. So the calendar's job
// is not to show events, it is to be the way into thirty-four boards — and a
// coloured bar with a date on it cannot carry a board's identity.
//
// The unlock was already in the repo. Every cluster renders a thumbnail of its
// own canvas (renderThumbnail.js), so a day cell can show the actual day rather
// than an icon standing in for one. That is something a text calendar
// structurally cannot do, and it costs no new loading machinery: CellContent's
// `board` branch goes through R2Image, which is the same lazy, tier-aware path
// the cluster browser uses. Thirty-four raw <img> tags would be thirty-four
// signed-URL fetches on mount; this is not that.
//
// Seven columns, not five. Productions shoot Saturdays, so dropping weekends
// would strand real days — they get a narrower track instead, which recovers
// most of the width and keeps weekday alignment.

import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { Plus } from '../../lib/icons.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { WEEKDAYS, parseISO, clockLabel } from '../../lib/schedDates.js';
import { calWeeks, calTracks } from '../../lib/schedCalendar.js';
import { dayTypeColor, dayTypeName } from '../../lib/dayTypes.js';
import { CellContent } from './gridCellShared.jsx';

const stop = (e) => e.stopPropagation();

const dayName = (b) => (b.day_label || '').trim() || b.name || 'Day';

// One day. A tile when it has a board, a dashed placeholder when it does not —
// the empty state matters as much as the full one, because that is where "set
// up this day" lives and where most of a fresh production starts.
function Tile({
  day, board, loose, types, boards, onOpenBoard, selected, dragging, draggable,
  onSelect, onPointerDown, onAdd, editable,
}) {
  if (day.outside) return <span className="schedt-pad" aria-hidden="true" />;

  const status = board?.sched_status || null;
  const published = status === 'published' && board?.sched_version > 0;
  const hue = board ? dayTypeColor(board, types) : null;
  const label = board ? dayName(board) : null;

  return (
    <div
      className={[
        'schedt-tile',
        board ? 'is-day' : 'is-empty',
        status ? `is-${status}` : '',
        day.weekend ? 'is-weekend' : '',
        day.isToday ? 'is-today' : '',
        selected ? 'is-selected' : '',
        dragging ? 'is-dragging' : '',
        draggable ? 'is-draggable' : '',
      ].filter(Boolean).join(' ')}
      style={hue ? { '--t-hue': hue } : undefined}
      data-tile-date={day.date}
      role="button"
      tabIndex={0}
      aria-label={board
        ? `${label}, ${WEEKDAYS[day.dow]} ${parseISO(day.date)?.d}${board.day_start ? `, ${clockLabel(board.day_start)}` : ''}`
        : `${WEEKDAYS[day.dow]} ${parseISO(day.date)?.d}, nothing set up`}
      onPointerDown={draggable && board ? onPointerDown : stop}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (board) onOpenBoard?.(board.id);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation();
        if (board) onOpenBoard?.(board.id); else onAdd?.();
      }}
    >
      <span className="schedt-spine" aria-hidden="true" />
      {board ? (
        <>
          {published && <span className="schedt-badge">v{board.sched_version}</span>}
          <span className="schedt-thumb">
            {board.thumb_key ? (
              // The real cluster thumbnail, through the path every other board
              // reference in the app uses — R2Image, lazily and tier-aware.
              // Thirty-four raw <img> tags would be thirty-four signed-URL
              // fetches on mount; this is not that.
              <CellContent
                cell={{ type: 'board', boardId: board.id, name: label }}
                rect={{ w: 132, h: 84 }}
                boards={boards} onOpenBoard={onOpenBoard}
                cardId="schedt" cellId={day.date}
              />
            ) : (
              // No thumbnail YET — a day is created before anything is in it,
              // and the render is asynchronous. An empty black box reads as
              // broken, so say what the day is instead. This is what most of a
              // freshly laid-out production looks like for its first minute.
              <span className="schedt-noimg">
                <span className="schedt-noimg-t">{label}</span>
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="schedt-ph">
          {editable && (
            <button type="button" className="schedt-add"
              title={`Set up ${WEEKDAYS[day.dow]} ${parseISO(day.date)?.d}`}
              aria-label={`Set up ${WEEKDAYS[day.dow]} ${parseISO(day.date)?.d}`}
              onPointerDown={stop}
              onClick={(e) => { e.stopPropagation(); onAdd?.(); }}>
              <Icon as={Plus} size={15} />
            </button>
          )}
        </span>
      )}
      <span className="schedt-cap">
        <span className="schedt-dow">{WEEKDAYS[day.dow]}</span>
        <span className="schedt-dnum">{parseISO(day.date)?.d}</span>
        {board ? (
          <>
            {/* The name goes wherever it is NOT already. A thumbnail is a
                picture of the day and cannot say which day it is, so the
                caption carries it; the stand-in already does, so the caption
                yields the room to the call time instead of repeating it in a
                130px tile. */}
            {board.thumb_key && <span className="schedt-name">{label}</span>}
            {board.day_start && (
              <span className="schedt-time">{clockLabel(board.day_start)}</span>
            )}
          </>
        ) : loose > 0 ? (
          <span className="schedt-name is-quiet">{loose} item{loose === 1 ? '' : 's'}</span>
        ) : null}
      </span>
    </div>
  );
}

export function ScheduleTiles({
  from, to, todayIso, shootDays = {}, dayCounts = {}, types,
  boards = null, onOpenBoard = null, editable = false,
  selectedDate = null, onSelectDate = null, onAddDay = null,
  tileDrag = null, onTilePointerDown = null,
}) {
  const bodyRef = useRef(null);
  useScrollEdges(bodyRef);
  const weeks = useMemo(() => calWeeks({ from, to, todayIso }), [from, to, todayIso]);

  // Selection can arrive from the wall chart, so the tile has to be brought on
  // screen — the whole point of clicking the chart is to look at that day.
  useEffect(() => {
    if (!selectedDate || !bodyRef.current) return;
    bodyRef.current.querySelector(`[data-tile-date="${selectedDate}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedDate]);

  return (
    <div className="schedt" ref={bodyRef}>
      {weeks.length === 0 ? (
        <p className="schedt-empty">Nothing in this range.</p>
      ) : weeks.map((wk) => {
        const live = wk.days.filter((d) => !d.outside && (shootDays[d.date] || []).length).length;
        return (
          <div key={wk.key} className="schedt-week">
            <div className="schedt-wk">
              <b>{wk.label}</b>
              <span>{live ? `${live} day${live === 1 ? '' : 's'}` : '—'}</span>
            </div>
            <div className="schedt-grid" style={{ gridTemplateColumns: calTracks() }}>
              {wk.days.map((d) => {
                const list = shootDays[d.date] || [];
                const board = list.find((b) => b.sched_status !== 'cancelled') || list[0] || null;
                return (
                  <Tile
                    key={d.date} day={d} board={board}
                    loose={dayCounts[d.date] || 0}
                    types={types} boards={boards} onOpenBoard={onOpenBoard}
                    editable={editable}
                    selected={selectedDate === d.date}
                    dragging={!!board && tileDrag?.boardId === board.id}
                    draggable={editable && !!onTilePointerDown}
                    onSelect={() => onSelectDate?.(d.date)}
                    onPointerDown={(e) => onTilePointerDown?.(e, board)}
                    onAdd={() => onAddDay?.(d.date)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
