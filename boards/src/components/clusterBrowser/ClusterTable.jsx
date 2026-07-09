import { ClusterRow } from './ClusterRow.jsx';
import { CardPreview } from './CardPreview.jsx';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';

// Dense sortable table. The single Date column shows "Modified" (updatedAt) by
// default; when the active sort is 'created' it flips to "Added" (createdAt).
// Header buttons toggle sort; an active-sort caret shows direction. Linked-grid
// FAMILIES arrive as group nodes (it.isGroup) → a header row + (when expanded)
// their member rows.
export function ClusterTable({
  items, selectedCards, peerMap, sortKey, sortDir, onSort,
  onRowClick, onRowDoubleClick, recentlyAddedIds,
  expandedGroups, selectedGroupId, onGroupClick,
}) {
  const caret = (k) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  const dateKey = sortKey === 'created' ? 'created' : 'updated';
  return (
    <div className="ct-table" role="table">
      <div className="ct-head" role="row">
        <button className="ct-th ct-c-name" onClick={() => onSort('name')}>Name{caret('name')}</button>
        <button className="ct-th ct-c-type" onClick={() => onSort('type')}>Type{caret('type')}</button>
        <button className="ct-th ct-c-size" onClick={() => onSort('size')}>Size{caret('size')}</button>
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
          />
        ) : (
          <ClusterRow
            key={it.id}
            item={it}
            selected={selectedCards.has(it.id)}
            isNew={recentlyAddedIds?.has?.(it.id)}
            peers={peerMap?.get(it.id)}
            dateKey={dateKey}
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
}) {
  return (
    <>
      <div className={`ct-row ct-group${selected ? ' is-selected' : ''}${expanded ? ' is-open' : ''}`}
           onClick={(e) => onGroupClick(e, group.id)}>
        <div className="ct-cell ct-c-name">
          <span className={`ct-group-caret${expanded ? ' is-open' : ''}`} aria-hidden="true"><Icon as={ChevronRight} size={13} /></span>
          <div className="ct-thumb"><CardPreview item={group} size="row" /></div>
          <div className="ct-name-wrap">
            <div className="ct-name" title={group.name}>{group.name}</div>
            <div className="ct-sub">{group.count} grids</div>
          </div>
        </div>
        <div className="ct-cell ct-c-type">Grid family</div>
        <div className="ct-cell ct-c-size" />
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
          onClick={(e) => onRowClick(e, m.id)}
          onDoubleClick={(e) => onRowDoubleClick(e, m.id)}
        />
      ))}
    </>
  );
}
