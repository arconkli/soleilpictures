import { memo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';
import { Icon } from '../Icon.jsx';
import { Download } from '../../lib/icons.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';

// One gallery tile: a large preview, name + type badge, and a live presence
// overlay (peer color border + avatar) when a teammate has this card open.
//
// Gallery is a real way to browse a sample pack once cover art is being read
// off the files, so audio tiles get the same play button and download the
// table rows have — the transport sits over the preview rather than beside it.
export const ClusterTile = memo(function ClusterTile({
  item, selected, isNew, peers, onClick, onDoubleClick, member = false,
  onDownload = null, onAudition = null, playing = false,
}) {
  const peer = peers && peers[0];
  const canDownload = !!onDownload && !item.pending && DOWNLOADABLE.has(item.kind);
  const canAudition = !!onAudition && item.kind === 'audio' && !item.pending;
  return (
    <div
      className={`ct-tile${member ? ' ct-member' : ''}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}${playing ? ' is-playing' : ''}`}
      style={peer ? { '--peer-color': peer.user.color } : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="ct-tile-preview">
        <CardPreview item={item} size="tile" />
        {item.pending && <span className="ct-thumb-spin ct-tile-spin" aria-hidden="true" />}
        {canAudition && (
          <button type="button" className="ct-tile-play"
                  aria-label={playing ? `Pause ${item.name}` : `Play ${item.name}`}
                  title={playing ? 'Pause' : 'Play'}
                  onClick={(e) => { e.stopPropagation(); onAudition(item); }}>
            {playing ? (
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
                <rect x="9" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 3.3 L12 8 L5 12.7 Z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}
        {canDownload && (
          <button type="button" className="ct-tile-dl" title={`Download ${item.name}`}
                  aria-label={`Download ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onDownload(item); }}>
            <Icon as={Download} size={14} />
          </button>
        )}
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
        <div className="ct-tile-type">{item.pending ? 'Uploading…' : (item.sub || item.typeLabel)}</div>
      </div>
    </div>
  );
});
