import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ClusterRow } from './ClusterRow.jsx';
import { CardPreview } from './CardPreview.jsx';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';

// Dense sortable table. The single Date column shows "Modified" (updatedAt) by
// default; when the active sort is 'created' it flips to "Added" (createdAt).
// Header buttons toggle sort; an active-sort caret shows direction. Linked-grid
// FAMILIES arrive as group nodes (it.isGroup) → a header row + (when expanded)
// their member rows.
//
// `audioMode` swaps Type+Size for Time/BPM/Key/Format. It is a MODE rather than
// four permanent columns because a cluster of notes and images must not grow
// four empty ones — and it is a branch inside this component rather than a
// second table so the two can never drift. The grid template swaps via a
// data-cols attribute on the wrapper (styles.css).
//
// Past VIRTUALIZE_ABOVE rows only those near the list's scrolled viewport
// (.list-wrap) are mounted, as the gallery does, with spacers for the rest:
// a 2,000-file cluster mounted whole froze the tab for seconds as it opened
// and made every click re-render every row. Rows are one height, measured
// from a mounted one.
const VIRTUALIZE_ABOVE = 300;
const OVERSCAN_PX = 400;
const ROW_GUESS = 49;   // .ct-row's contain-intrinsic-size, plus its border

export function ClusterTable({
  items, selectedCards, peerMap, sortKey, sortDir, onSort,
  onRowClick, onRowDoubleClick, recentlyAddedIds,
  expandedGroups, selectedGroupId, onGroupClick, onDownload = null,
  onAudition = null, onSeek = null, activeId = null, playingId = null, registerRow = null,
  audioMode = false, draggableItems = false, onBoardIds = null, renameFor = null, markUnplaced = false,
}) {
  const dateKey = sortKey === 'created' ? 'created' : 'updated';
  const th = (cls, col, label, note = null) => (
    <SortTh cls={cls} col={col} label={label} sortKey={sortKey} sortDir={sortDir} onSort={onSort} note={note} />
  );
  // Where the sorted column is folded away (a phone, a narrow pane), the Name
  // header says what the list is sorted by — otherwise nothing on screen
  // does. Always in the DOM; CSS shows it at the widths that hide that column.
  const sortNote = SORT_NOTE[sortKey]
    ? <span className="ct-th-sortnote" data-col={sortKey}>· {SORT_NOTE[sortKey]} {sortDir === 'asc' ? '↑' : '↓'}</span>
    : null;

  // Every row in screen order: a family's header, then its members when open.
  const rows = useMemo(() => {
    const out = [];
    for (const it of items || []) {
      if (!it.isGroup) { out.push({ id: it.id, item: it }); continue; }
      out.push({ id: it.id, group: it });
      if (expandedGroups?.has?.(it.id)) for (const m of it.members || []) out.push({ id: m.id, item: m, member: true });
    }
    return out;
  }, [items, expandedGroups]);

  const bodyRef = useRef(null);
  const virtual = rows.length > VIRTUALIZE_ABOVE;
  const [rowH, setRowH] = useState(ROW_GUESS);
  const [range, setRange] = useState([0, 0]);
  const scrollerOf = () => bodyRef.current?.closest?.('.list-wrap') || null;
  // The window: rows within OVERSCAN_PX of what the scroller shows.
  const measure = () => {
    const body = bodyRef.current;
    const scroller = scrollerOf();
    if (!body || !scroller) return;
    const top = scroller.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const first = Math.max(0, Math.floor((top - OVERSCAN_PX) / rowH));
    const last = Math.min(rows.length, Math.ceil((top + scroller.clientHeight + OVERSCAN_PX) / rowH));
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
  };
  // A file row's height, once per layout (audio rows carry a waveform), never
  // re-read from whichever row happens to be first: two heights alternating
  // as the window moved would make the spacers jump.
  const measuredFor = useRef(null);
  useLayoutEffect(() => {
    if (!virtual) { measuredFor.current = null; return; }
    const mode = audioMode ? 'audio' : 'files';
    if (measuredFor.current !== mode) {
      const h = bodyRef.current?.querySelector('.ct-row:not(.ct-group)')?.offsetHeight;
      if (h > 0) { measuredFor.current = mode; if (h !== rowH) setRowH(h); }
    }
    measure();
  });
  useEffect(() => {
    if (!virtual) return undefined;
    const scroller = scrollerOf();
    if (!scroller) return undefined;
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtual, rows, rowH]);
  const [start, end] = virtual ? range : [0, rows.length];
  // The cursor moving onto a row that isn't mounted (the keyboard, a reveal):
  // scroll it into view; a mounted one is scrolled by ListSurface through its ref.
  useEffect(() => {
    if (!virtual || !activeId) return;
    const i = rows.findIndex((r) => r.id === activeId);
    const body = bodyRef.current;
    const scroller = scrollerOf();
    if (i < 0 || (i >= start && i < end) || !body || !scroller) return;
    const offset = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, offset + i * rowH - scroller.clientHeight / 3);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // rowIndex: 1 is the header, so the first row is 2 (aria-rowindex).
  const rowOf = ({ item: it, group, member }, i) => (group ? (
    <GroupRow
      key={group.id} group={group} rowIndex={virtual ? i + 2 : undefined}
      expanded={expandedGroups?.has?.(group.id)}
      selected={selectedGroupId === group.id}
      active={activeId === group.id} registerRow={registerRow}
      onGroupClick={onGroupClick} audioMode={audioMode}
    />
  ) : (
    <ClusterRow
      key={it.id}
      item={it} member={member}
      selected={selectedCards.has(it.id)}
      isNew={recentlyAddedIds?.has?.(it.id)}
      peers={peerMap?.get(it.id)}
      dateKey={dateKey}
      onDownload={onDownload} onAudition={onAudition} onSeek={onSeek}
      active={activeId === it.id} playing={playingId === it.id}
      rowRef={registerRow ? registerRow(it.id) : null}
      audioMode={audioMode} draggable={draggableItems} onBoard={!!onBoardIds?.has?.(it.id)}
      rename={renameFor ? renameFor(it.id) : null} markUnplaced={markUnplaced}
      rowIndex={virtual ? i + 2 : undefined}
      onClick={(e) => onRowClick(e, it.id)}
      onDoubleClick={(e) => onRowDoubleClick(e, it.id)}
    />
  ));
  return (
    <div className={`ct-table${virtual ? ' is-windowed' : ''}`} role="table" aria-label="Files" aria-rowcount={virtual ? rows.length + 1 : undefined}
         data-cols={audioMode ? 'audio' : undefined}>
      <div className="ct-head" role="row" aria-rowindex={virtual ? 1 : undefined}>
        {th('ct-c-name', 'name', 'Name', sortNote)}
        {audioMode ? (
          <>
            {th('ct-c-dur', 'duration', 'Time')}
            {th('ct-c-bpm', 'bpm', 'BPM')}
            {th('ct-c-key', 'key', 'Key')}
            {th('ct-c-fmt', 'format', 'Format')}
          </>
        ) : (
          <>
            {th('ct-c-type', 'type', 'Type')}
            {th('ct-c-size', 'size', 'Size')}
          </>
        )}
        {th('ct-c-date', dateKey, dateKey === 'created' ? 'Added' : 'Modified')}
        <div className="ct-th ct-c-presence" role="columnheader" />
      </div>
      <div className="ct-body" role="rowgroup" ref={bodyRef}>
        {start > 0 && <div className="ct-spacer" aria-hidden="true" style={{ height: start * rowH }} />}
        {rows.slice(start, end).map((r, k) => rowOf(r, start + k))}
        {end < rows.length && <div className="ct-spacer" aria-hidden="true" style={{ height: (rows.length - end) * rowH }} />}
      </div>
    </div>
  );
}

// One sortable column label.
//
// The caret is always in the DOM and dialled with opacity, so changing the sort
// cannot shove the next column sideways — it used to be appended to the label
// text, which reflowed the whole header row on every sort. aria-sort is what
// tells a screen reader that the arrow means anything.
// The menu's words for each sort, for the Name header's note.
const SORT_NOTE = {
  type: 'Type', size: 'Size', updated: 'Modified', created: 'Added',
  duration: 'Length', bpm: 'Tempo', key: 'Key', format: 'Format',
};

function SortTh({ cls, col, label, sortKey, sortDir, onSort, note = null }) {
  const sorted = sortKey === col;
  // The W3C pattern for a sortable column: a columnheader WRAPPING a button,
  // so the header keeps its sort state (aria-sort) and the button stays a
  // button. The wrapper is display: contents — the button is still the grid
  // item every `.ct-th.ct-c-*` rule lays out.
  return (
    <div className="ct-thw" role="columnheader" aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        title={`Sort by ${label.toLowerCase()}`}
        className={`ct-th ${cls}${sorted ? ' is-sorted' : ''}`}
        onClick={() => onSort(col)}
      >
        <span>{label}</span>
        <span className="ct-th-caret" aria-hidden="true">{sorted && sortDir === 'asc' ? '↑' : '↓'}</span>
        {note}
      </button>
    </div>
  );
}

// A linked-grid family's header row (caret + representative preview + name +
// count); it toggles expansion, and when open its member rows follow it.
function GroupRow({ group, expanded, selected, active, registerRow, onGroupClick, audioMode = false, rowIndex = undefined }) {
  return (
    <div className={`ct-row ct-group${selected ? ' is-selected' : ''}${expanded ? ' is-open' : ''}${active ? ' is-active' : ''}`}
         role="row" aria-rowindex={rowIndex} aria-expanded={!!expanded}
         ref={registerRow ? registerRow(group.id) : null}
         onClick={(e) => onGroupClick(e, group.id)}>
      <div role="cell" className="ct-cell ct-c-name">
        <span className={`ct-group-caret${expanded ? ' is-open' : ''}`} aria-hidden="true"><Icon as={ChevronRight} size={13} /></span>
        <div className="ct-thumb"><CardPreview item={group} size="row" /></div>
        <div className="ct-name-wrap">
          <div className="ct-name" title={group.name}>{group.name}</div>
          <div className="ct-sub">{group.count} grids</div>
        </div>
      </div>
      {audioMode ? (
        <>
          <div role="cell" className="ct-cell ct-c-dur" />
          <div role="cell" className="ct-cell ct-c-bpm" />
          <div role="cell" className="ct-cell ct-c-key" />
          <div role="cell" className="ct-cell ct-c-fmt">Grid family</div>
        </>
      ) : (
        <>
          <div role="cell" className="ct-cell ct-c-type">Grid family</div>
          <div role="cell" className="ct-cell ct-c-size" />
        </>
      )}
      <div role="cell" className="ct-cell ct-c-date" />
      <div role="cell" className="ct-cell ct-c-presence" />
    </div>
  );
}
