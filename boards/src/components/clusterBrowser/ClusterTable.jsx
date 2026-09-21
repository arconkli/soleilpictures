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
  const caret = (k) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  const dateKey = sortKey === 'created' ? 'created' : 'updated';
  return (
    <div className="ct-table" role="table" data-cols={audioMode ? 'audio' : undefined}>
      <div className="ct-head" role="row">
        <button className="ct-th ct-c-name" onClick={() => onSort('name')}>Name{caret('name')}</button>
        {audioMode ? (
          <>
            <button className="ct-th ct-c-dur" onClick={() => onSort('duration')}>Time{caret('duration')}</button>
            <button className="ct-th ct-c-bpm" onClick={() => onSort('bpm')}>BPM{caret('bpm')}</button>
            <button className="ct-th ct-c-key" onClick={() => onSort('key')}>Key{caret('key')}</button>
            <button className="ct-th ct-c-fmt" onClick={() => onSort('format')}>Format{caret('format')}</button>
          </>
        ) : (
          <>
            <button className="ct-th ct-c-type" onClick={() => onSort('type')}>Type{caret('type')}</button>
            <button className="ct-th ct-c-size" onClick={() => onSort('size')}>Size{caret('size')}</button>
          </>
        )}
        <button className="ct-th ct-c-date" onClick={() => onSort(dateKey)}>
          {dateKey === 'created' ? 'Added' : 'Modified'}{caret(dateKey)}
        </button>
        <div className="ct-th ct-c-presence" aria-hidden="true" />
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
           ref={registerRow ? registerRow(group.id) : null}
           onClick={(e) => onGroupClick(e, group.id)}>
        <div className="ct-cell ct-c-name">
          <span className={`ct-group-caret${expanded ? ' is-open' : ''}`} aria-hidden="true"><Icon as={ChevronRight} size={13} /></span>
          <div className="ct-thumb"><CardPreview item={group} size="row" /></div>
          <div className="ct-name-wrap">
            <div className="ct-name" title={group.name}>{group.name}</div>
            <div className="ct-sub">{group.count} grids</div>
          </div>
        </div>
        {audioMode ? (
          <>
            <div className="ct-cell ct-c-dur" />
            <div className="ct-cell ct-c-bpm" />
            <div className="ct-cell ct-c-key" />
            <div className="ct-cell ct-c-fmt">Grid family</div>
          </>
        ) : (
          <>
            <div className="ct-cell ct-c-type">Grid family</div>
            <div className="ct-cell ct-c-size" />
          </>
        )}
        <div className="ct-cell ct-c-date" />
        <div className="ct-cell ct-c-presence" aria-hidden="true" />
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
