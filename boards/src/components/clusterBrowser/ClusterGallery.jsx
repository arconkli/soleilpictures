import { ClusterTile } from './ClusterTile.jsx';
import { CardPreview } from './CardPreview.jsx';

// Responsive grid of large preview tiles. Same selection / open / presence props
// as ClusterTable so the orchestrator stays view-agnostic. Linked-grid FAMILIES
// arrive as group nodes → a stacked tile with a count; expanding flows the
// members after it.
export function ClusterGallery({
  items, selectedCards, peerMap, onRowClick, onRowDoubleClick, recentlyAddedIds,
  expandedGroups, selectedGroupId, onGroupClick,
}) {
  return (
    <div className="ct-gallery">
      {items.map(it => it.isGroup ? (
        <GroupTiles
          key={it.id} group={it}
          expanded={expandedGroups?.has?.(it.id)}
          selected={selectedGroupId === it.id}
          onGroupClick={onGroupClick}
          selectedCards={selectedCards} peerMap={peerMap} recentlyAddedIds={recentlyAddedIds}
          onRowClick={onRowClick} onRowDoubleClick={onRowDoubleClick}
        />
      ) : (
        <ClusterTile
          key={it.id}
          item={it}
          selected={selectedCards.has(it.id)}
          isNew={recentlyAddedIds?.has?.(it.id)}
          peers={peerMap?.get(it.id)}
          onClick={(e) => onRowClick(e, it.id)}
          onDoubleClick={(e) => onRowDoubleClick(e, it.id)}
        />
      ))}
    </div>
  );
}

function GroupTiles({
  group, expanded, selected, onGroupClick,
  selectedCards, peerMap, recentlyAddedIds, onRowClick, onRowDoubleClick,
}) {
  return (
    <>
      <div className={`ct-tile ct-group-tile${selected ? ' is-selected' : ''}${expanded ? ' is-open' : ''}`}
           onClick={(e) => onGroupClick(e, group.id)}>
        <div className="ct-tile-preview">
          <CardPreview item={group} size="tile" />
          <span className="ct-group-badge">{group.count}</span>
        </div>
        <div className="ct-tile-meta">
          <div className="ct-tile-name" title={group.name}>{group.name}</div>
          <div className="ct-tile-type">Grid family · {group.count}</div>
        </div>
      </div>
      {expanded && group.members.map(m => (
        <ClusterTile
          key={m.id} item={m} member
          selected={selectedCards.has(m.id)}
          isNew={recentlyAddedIds?.has?.(m.id)}
          peers={peerMap?.get(m.id)}
          onClick={(e) => onRowClick(e, m.id)}
          onDoubleClick={(e) => onRowDoubleClick(e, m.id)}
        />
      ))}
    </>
  );
}
