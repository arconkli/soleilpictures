// The day, as a rundown.
//
// What this replaces: a column of fixed hour buckets, 8am to 6pm, where an
// item was "filed under 9 AM" and that was the whole vocabulary. No durations,
// no end times, no order within an hour. It could not say "shoot 14A, 2h15",
// and it could not answer the only question anyone asks on a running day —
// rehearsal went 25 minutes long, what time is everything now?
//
// Now: each row carries a DURATION and the start times cascade (lib/rundown.js).
// Row height is proportional to duration, so the day still reads as a shape
// while it edits as a list. And because a rundown is sequential by definition,
// there is no overlap-column packing to do — the hardest part of a calendar day
// view is deleted rather than solved.
//
// Three verbs cover the whole surface: type a duration, drag a row, toggle a
// pin. Everything else on screen is computed.
//
// A row's record is a standard grid cell record, so a row can BE a cluster
// (the setup's own board, opened from the row) and can carry attachments —
// shotlist, refs, pages — underneath. That is one feature, not two.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Plus, X, MoreHorizontal, Pin, Clock } from '../../lib/icons.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import {
  computeRundown, formatDuration, parseDuration, fromMinutes,
  RUNDOWN_TUNING,
} from '../../lib/rundown.js';
import { clockLabel, parseClock, formatClock } from '../../lib/schedDates.js';
import { CellContent } from './gridCellShared.jsx';

const stop = (e) => e.stopPropagation();

// Minutes → pixels. A floor, because a five-minute row still has to be
// readable and tappable; above it, height is honest.
const PX_PER_MIN = 0.62;
const rowHeight = (dur, floor) => Math.max(floor, Math.round(dur * PX_PER_MIN));

// "12m over" / "1h 05m under". Signed minutes read as a duration, never as a
// bare number — "-25" on a call sheet is not a time anyone can act on.
function overLabel(mins) {
  const n = Math.abs(mins);
  const h = Math.floor(n / 60), m = n % 60;
  const amount = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  return `${amount} ${mins > 0 ? 'over' : 'under'}`;
}

// ── the duration field ──────────────────────────────────────────────────────
// A text input, not a spinner: 2h15 is two keystrokes to type and twenty-seven
// clicks to spin. Commits on blur and Enter, reverts on Escape.
function DurationField({ value, editable, onCommit }) {
  const [draft, setDraft] = useState(null);
  const ref = useRef(null);
  const shown = draft ?? formatDuration(value);

  if (!editable) return <span className="rd-dur">{formatDuration(value)}</span>;
  return (
    <input
      ref={ref}
      className="rd-dur rd-dur-in"
      value={shown}
      inputMode="numeric"
      aria-label="Duration"
      onPointerDown={stop}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        const next = parseDuration(shown);
        setDraft(null);
        if (next != null && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); ref.current?.blur(); }
      }}
    />
  );
}

// A rundown title is one line of plain text — "Shoot 14A", "Company move".
// Deliberately not the rich editor the canvas uses elsewhere: bold and links in
// a running order are noise, and a full editor per row would be a lot of
// ProseMirror instances on a forty-item day.
function TitleField({ value, onCommit, onCancel }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(value || '');
  useLayoutEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => onCommit(draft.trim());
  return (
    <input
      ref={ref}
      className="rd-title rd-title-in"
      value={draft}
      placeholder="What happens now?"
      aria-label="Item"
      onPointerDown={stop}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    />
  );
}

// A PINNED row's start time is editable — that is the whole point of a pin.
// Unpinned rows show a computed time and there is nothing to type into: the
// cascade owns it, and letting someone edit a derived number would be a lie.
function TimeField({ value, onCommit }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value;
  return (
    <input
      ref={ref}
      className="rd-t rd-t-in"
      value={shown}
      inputMode="numeric"
      aria-label="Start time"
      onPointerDown={stop}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        const t = parseClock(shown);
        setDraft(null);
        if (t) onCommit(formatClock(t.h, t.m).slice(0, 5));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); ref.current?.blur(); }
      }}
    />
  );
}

// ── one row ─────────────────────────────────────────────────────────────────
function Row({
  row, h, hue, editable, dragging, editing, boards, onOpenBoard, cardId,
  onPointerDown, onSetDur, onTogglePin, onSetPin, onRemove, onOpenMenu, onEditTitle,
  onCommitTitle, onCancelTitle,
}) {
  const kind = row.kind || 'item';
  const isBoard = row.type === 'board' && row.boardId;
  const title = row.title || stripHtml(row.html) || row.name || untitled(kind);

  return (
    <div
      className={[
        'rd-row', `is-${kind}`,
        row.pinned ? 'is-pinned' : '',
        isBoard ? 'is-board' : '',
        dragging ? 'is-dragging' : '',
        editable ? 'is-draggable' : '',
      ].filter(Boolean).join(' ')}
      style={{ height: h, '--rd-hue': hue || undefined }}
      role="listitem"
      aria-label={`${row.start} ${title}, ${formatDuration(row.dur)}${row.pinned ? ', pinned' : ''}`}
      onPointerDown={editable ? onPointerDown : stop}
    >
      <button
        type="button"
        className={`rd-pin${row.pinned ? ' is-on' : ''}`}
        title={row.pinned
          ? `Pinned to ${clockLabel(row.pin)} — unpin to let it move with the day`
          : 'Pin to this time'}
        aria-label={row.pinned ? 'Unpin' : 'Pin to this time'}
        aria-pressed={row.pinned}
        disabled={!editable}
        onPointerDown={stop}
        onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
      >
        <Icon as={Pin} size={10} />
      </button>

      {editable && row.pinned ? (
        <TimeField value={row.start} onCommit={onSetPin} />
      ) : (
        <span className="rd-t">
          {row.start}
          {row.startsNextDay && <em className="rd-nextday" title="Next day">+1</em>}
        </span>
      )}

      <span className="rd-spine" aria-hidden="true" />

      <span className="rd-col">
        {isBoard ? (
          // The row IS a cluster. gc-board already renders the real thumbnail
          // through R2Image's tier-aware path, so this costs no new loading
          // machinery and looks like every other cluster reference in the app.
          <span className="rd-boardcell">
            <CellContent
              cell={row} rect={{ w: 190, h: Math.max(30, h - 26) }}
              boards={boards} onOpenBoard={onOpenBoard}
              cardId={cardId} cellId={row.key}
            />
          </span>
        ) : editing ? (
          <TitleField value={row.title || stripHtml(row.html)}
            onCommit={onCommitTitle} onCancel={onCancelTitle} />
        ) : (
          <button type="button"
            className={`rd-title${row.title || stripHtml(row.html) ? '' : ' is-untitled'}`}
            disabled={!editable}
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); onEditTitle(); }}>
            {title}
          </button>
        )}
        {row.place && (
          <span className="rd-sub">{row.place}</span>
        )}
      </span>

      <DurationField value={row.dur} editable={editable}
        onCommit={(v) => onSetDur(v)} />

      {editable && (
        <span className="rd-tools">
          <button type="button" className="rd-tool" title="More" aria-label="More"
            onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onOpenMenu(e); }}>
            <Icon as={MoreHorizontal} size={13} />
          </button>
          <button type="button" className="rd-tool" title="Remove" aria-label="Remove"
            onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <Icon as={X} size={11} />
          </button>
        </span>
      )}
    </div>
  );
}

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function untitled(kind) {
  return kind === 'break' ? 'Break' : kind === 'move' ? 'Move' : kind === 'note' ? 'Note' : 'Untitled';
}

// ── the surface ─────────────────────────────────────────────────────────────
export function ScheduleRundown({
  cardId, date, cells, dayStart = null, plannedWrap = null, place = null,
  boards = null, onOpenBoard = null, editable = false, hueFor = null,
  editingKey = null,
  onSetDur, onTogglePin, onRemove, onAdd, onMove, onEditTitle, onOpenMenu,
  onCommitTitle, onCancelTitle,
}) {
  const bodyRef = useRef(null);
  const { isTouch } = useBreakpoint();
  const floor = isTouch ? 48 : 34;
  useScrollEdges(bodyRef);

  const [drag, setDrag] = useState(null);   // { key, from, to }

  const model = computeRundown(cells, { dayStart, plannedWrap });
  const { rows, untimed } = model;

  // Reorder. Same gesture as every other in-card drag here (GridCard's
  // onDividerDown): stop the event before the canvas wrapper sees it, then
  // listen on WINDOW — the canvas deliberately doesn't use setPointerCapture,
  // so capturing here would fight it. Arms at 4px, matching the canvas.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const startDrag = (e, index) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target?.closest?.('button, input, .rd-boardcell')) return;
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    let armed = false;
    const move = (ev) => {
      if (!armed && Math.abs(ev.clientY - startY) <= 4) return;
      armed = true;
      const to = indexAt(bodyRef.current, ev.clientY);
      setDrag({ key: rowsRef.current[index]?.key, from: index, to });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!armed) return;
      const to = indexAt(bodyRef.current, ev.clientY);
      if (to != null) onMove?.(index, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const over = model.over;
  const hasWrapTarget = over !== null;

  return (
    <div className="rd" data-rd-date={date}>
      {/* The day's headline. Every source on call sheets says the same thing:
          the start time is the single most important line and it must be
          readable without hunting, so it is the largest type here. */}
      <div className="rd-facts">
        <span className="rd-fact">
          <span className="rd-fact-k">Call</span>
          <span className="rd-fact-v">{clockLabel(model.start) || model.start}</span>
        </span>
        <span className="rd-fact">
          <span className="rd-fact-k">Wrap est</span>
          <span className="rd-fact-v">
            {clockLabel(model.wrap) || model.wrap}
            {model.wrapsNextDay && <em className="rd-nextday">+1</em>}
          </span>
        </span>
        {hasWrapTarget && over !== 0 && (
          <span className={`rd-fact ${over > 0 ? 'is-over' : 'is-under'}`}>
            <span className="rd-fact-v">{overLabel(over)}</span>
            <span className="rd-fact-note">planned {clockLabel(plannedWrap)}</span>
          </span>
        )}
        {place && <span className="rd-fact-place">{place}</span>}
      </div>

      <div className="rd-body" ref={bodyRef} role="list">
        {untimed.length > 0 && (
          <div className="rd-untimed">
            <span className="rd-untimed-k">All day</span>
            <span className="rd-untimed-list">
              {untimed.map((u) => (
                <span key={u.key} className="rd-untimed-item">
                  {u.title || u.name || stripHtml(u.html) || 'Note'}
                </span>
              ))}
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="rd-empty">
            Nothing planned yet.
            {editable ? ' Add the first item and give it a length — everything after it times itself.' : ''}
          </p>
        ) : rows.map((row, i) => (
          <div key={row.key}>
            {/* A gap or an overrun is a fact about the SEAM between two rows,
                so it renders there rather than inside either one. */}
            {row.overlapBefore > 0 && (
              <div className="rd-warn" role="status">
                runs {overLabel(row.overlapBefore).replace(' over', '')} past the pin
              </div>
            )}
            {row.gapBefore > 0 && (
              <div className="rd-warn is-gap" role="status">
                {overLabel(row.gapBefore).replace(' over', '')} spare before the pin
              </div>
            )}
            {drag?.to === i && drag.from !== i && <div className="rd-dropline" aria-hidden="true" />}
            <Row
              row={row}
              h={rowHeight(row.dur, floor)}
              hue={hueFor ? hueFor(row) : null}
              editable={editable}
              dragging={drag?.key === row.key}
              editing={editable && editingKey === row.key}
              boards={boards} onOpenBoard={onOpenBoard} cardId={cardId}
              onPointerDown={(e) => startDrag(e, i)}
              onSetDur={(v) => onSetDur?.(row.key, v)}
              onTogglePin={() => onTogglePin?.(row.key, row.pinned ? null : row.start)}
              onSetPin={(clock) => onTogglePin?.(row.key, clock)}
              onRemove={() => onRemove?.(row.key)}
              onOpenMenu={(e) => onOpenMenu?.(row.key, e)}
              onEditTitle={() => onEditTitle?.(row.key)}
              onCommitTitle={(text) => onCommitTitle?.(row.key, text)}
              onCancelTitle={() => onCancelTitle?.()}
            />
          </div>
        ))}
        {drag?.to === rows.length && <div className="rd-dropline" aria-hidden="true" />}

        {/* The wrap is a row so the eye can land on it at the end of the
            column, but it is not an item — nothing is stored for it. */}
        {rows.length > 0 && (
          <div className="rd-wrap-row">
            <span className="rd-t">{model.wrap}</span>
            <span className="rd-spine" aria-hidden="true" />
            <span className="rd-col"><span className="rd-title is-quiet">Estimated wrap</span></span>
          </div>
        )}
      </div>

      {editable && (
        <button type="button" className="rd-add"
          onPointerDown={stop}
          onClick={(e) => { e.stopPropagation(); onAdd?.(rows.length); }}>
          <Icon as={Plus} size={13} />
          <span>Add item</span>
        </button>
      )}
    </div>
  );
}

// Which slot a pointer at clientY is over. Uses the row boxes rather than
// arithmetic on heights, because rows are duration-proportional and the
// warnings between them take space too.
function indexAt(host, clientY) {
  if (!host) return null;
  const list = [...host.querySelectorAll('.rd-row')];
  for (let i = 0; i < list.length; i++) {
    const r = list[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return list.length;
}
