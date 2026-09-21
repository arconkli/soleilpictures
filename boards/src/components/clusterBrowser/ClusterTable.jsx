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
export function ClusterTable({
  items, selectedCards, peerMap, sortKey, sortDir, onSort,
  onRowClick, onRowDoubleClick, recentlyAddedIds,
  expandedGroups, selectedGroupId, onGroupClick, onDownload = null,
  onAudition = null, activeId = null, playingId = null, registerRow = null,
  audioMode = false,
}) {
  const dateKey = sortKey === 'created' ? 'created' : 'updated';
  const th = (cls, col, label) => (
    <SortTh cls={cls} col={col} label={label} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
  );
  return (
    <div className="ct-table" role="table" data-cols={audioMode ? 'audio' : undefined}>
      <div className="ct-head" role="row">
        {th('ct-c-name', 'name', 'Name')}
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
        <div className="ct-th ct-c-presence" />
      </div>
      <div className="ct-body" role="rowgroup">
        {items.map(it => it.isGroup ? (
          <GroupBlock
            key={it.id} group={it}
            expanded={expandedGroups?.has?.(it.id)}
            selected={selectedGroupId === it.id}
            onGroupClick={onGroupClick}
            selectedCards={selectedCards} peerMap={peerMap} dateKey={dateKey}
            recentlyAddedIds={recentlyAddedIds}
            onRowClick={onRowClick} onRowDoubleClick={onRowDoubleClick}
            onDownload={onDownload} onAudition={onAudition}
            activeId={activeId} playingId={playingId} registerRow={registerRow}
            audioMode={audioMode}
          />
        ) : (
          <ClusterRow
            key={it.id}
            item={it}
            selected={selectedCards.has(it.id)}
            isNew={recentlyAddedIds?.has?.(it.id)}
            peers={peerMap?.get(it.id)}
            dateKey={dateKey}
            onDownload={onDownload} onAudition={onAudition}
            active={activeId === it.id} playing={playingId === it.id}
            rowRef={registerRow ? registerRow(it.id) : null}
            audioMode={audioMode}
            onClick={(e) => onRowClick(e, it.id)}
            onDoubleClick={(e) => onRowDoubleClick(e, it.id)}
          />
        ))}
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
function SortTh({ cls, col, label, sortKey, sortDir, onSort }) {
  const sorted = sortKey === col;
  // Deliberately NOT role="columnheader". The W3C pattern for a sortable
  // column is a columnheader element WRAPPING a button, and collapsing the two
  // onto one element trades the button role — the thing that tells a screen
  // reader user this is pressable — for the sort semantics. The state goes in
  // the accessible name instead, which costs nothing and reads correctly.
  return (
    <button
      type="button"
      aria-label={`${label}${sorted ? (sortDir === 'asc' ? ', sorted ascending' : ', sorted descending') : ''}`}
      title={`Sort by ${label.toLowerCase()}`}
      className={`ct-th ${cls}${sorted ? ' is-sorted' : ''}`}
      onClick={() => onSort(col)}
    >
      <span>{label}</span>
      <span className="ct-th-caret" aria-hidden="true">{sorted && sortDir === 'asc' ? '↑' : '↓'}</span>
    </button>
  );
}

// A linked-grid family: a header row (caret + representative preview + name +
// count) that toggles expansion; when open, its member rows render indented.
function GroupBlock({
  group, expanded, selected, onGroupClick,
  selectedCards, peerMap, dateKey, recentlyAddedIds, onRowClick, onRowDoubleClick,
  onDownload = null, onAudition = null, activeId = null, playingId = null, registerRow = null,
  audioMode = false,
}) {
  return (
    <>
      <div className={`ct-row ct-group${selected ? ' is-selected' : ''}${expanded ? ' is-open' : ''}${activeId === group.id ? ' is-active' : ''}`}
           role="row" aria-expanded={!!expanded}
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
      {expanded && group.members.map(m => (
        <ClusterRow
          key={m.id} item={m} member
          selected={selectedCards.has(m.id)}
          isNew={recentlyAddedIds?.has?.(m.id)}
          peers={peerMap?.get(m.id)}
          dateKey={dateKey}
          onDownload={onDownload} onAudition={onAudition}
          active={activeId === m.id} playing={playingId === m.id}
          rowRef={registerRow ? registerRow(m.id) : null}
          audioMode={audioMode}
          onClick={(e) => onRowClick(e, m.id)}
          onDoubleClick={(e) => onRowDoubleClick(e, m.id)}
        />
      ))}
    </>
  );
}
