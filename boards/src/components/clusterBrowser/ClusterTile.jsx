import { memo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';

// One gallery tile: a large preview, name + type badge, and a live presence
// overlay (peer color border + avatar) when a teammate has this card open.
export const ClusterTile = memo(function ClusterTile({
  item, selected, isNew, peers, onClick, onDoubleClick,
}) {
  const peer = peers && peers[0];
  return (
    <div
      className={`ct-tile${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}`}
      style={peer ? { '--peer-color': peer.user.color } : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="ct-tile-preview">
        <CardPreview item={item} size="tile" />
        {item.pending && <span className="ct-thumb-spin ct-tile-spin" aria-hidden="true" />}
        {peer && (
          <div className="ct-tile-peers">
            {peers.slice(0, 3).map((pp, i) => (
              <Avatar key={pp.user.id || i} name={pp.user.name} color={pp.user.color} size={20} ring />
            ))}
          </div>
        )}
      </div>
      <div className="ct-tile-meta">
        <div className="ct-tile-name" title={item.name}>{item.name}</div>
        <div className="ct-tile-type">{item.pending ? 'Uploading…' : item.typeLabel}</div>
      </div>
    </div>
  );
});
