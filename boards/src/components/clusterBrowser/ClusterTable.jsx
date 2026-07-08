import { ClusterRow } from './ClusterRow.jsx';

// Dense sortable table. The single Date column shows "Modified" (updatedAt) by
// default; when the active sort is 'created' it flips to "Added" (createdAt).
// Header buttons toggle sort; an active-sort caret shows direction.
export function ClusterTable({
  items, selectedCards, peerMap, sortKey, sortDir, onSort,
  onRowClick, onRowDoubleClick, recentlyAddedIds,
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
        {items.map(it => (
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
