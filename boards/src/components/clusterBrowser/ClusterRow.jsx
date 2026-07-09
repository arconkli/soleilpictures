import { memo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';
import { humanSize } from '../cards/FileCard.jsx';
import { relativeTimeShort } from '../../lib/relativeTime.js';

// One dense table row: preview thumbnail + name/sub, type, size, date, and a
// live presence tag (a peer's color bar + avatar when they have this card open).
export const ClusterRow = memo(function ClusterRow({
  item, selected, isNew, peers, dateKey = 'updated', onClick, onDoubleClick, member = false,
}) {
  const peer = peers && peers[0];
  const dateVal = dateKey === 'created' ? item.createdAt : item.updatedAt;
  return (
    <div
      className={`ct-row${member ? ' ct-member' : ''}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}`}
      style={peer ? { '--peer-color': peer.user.color } : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="ct-cell ct-c-name">
        <div className="ct-thumb">
          <CardPreview item={item} size="row" />
          {item.pending && <span className="ct-thumb-spin" aria-hidden="true" />}
        </div>
        <div className="ct-name-wrap">
          <div className="ct-name" title={item.name}>{item.name}</div>
          {item.sub && <div className="ct-sub">{item.sub}</div>}
        </div>
      </div>
      <div className="ct-cell ct-c-type">{item.typeLabel}</div>
      <div className="ct-cell ct-c-size">{item.sizeBytes != null ? humanSize(item.sizeBytes) : ''}</div>
      <div className="ct-cell ct-c-date">{item.pending ? 'Uploading…' : (dateVal ? relativeTimeShort(dateVal) : '')}</div>
      <div className="ct-cell ct-c-presence">
        {peers && peers.slice(0, 2).map((pp, i) => (
          <Avatar key={pp.user.id || i} name={pp.user.name} color={pp.user.color} size={18} ring />
        ))}
      </div>
    </div>
  );
});
