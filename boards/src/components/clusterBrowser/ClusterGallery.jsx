import { ClusterTile } from './ClusterTile.jsx';

// Responsive grid of large preview tiles. Same selection / open / presence
// props as ClusterTable so the orchestrator stays view-agnostic.
export function ClusterGallery({
  items, selectedCards, peerMap, onRowClick, onRowDoubleClick, recentlyAddedIds,
}) {
  return (
    <div className="ct-gallery">
      {items.map(it => (
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
