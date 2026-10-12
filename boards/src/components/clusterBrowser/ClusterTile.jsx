import { memo } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { Avatar } from '../primitives.jsx';
import { Icon } from '../Icon.jsx';
import { Download, Check } from '../../lib/icons.js';
import { DOWNLOADABLE } from '../../lib/cardAssetName.js';
import { InlineRename } from './InlineRename.jsx';
import { captionOf } from '../../lib/listItem.js';

// One gallery tile: a large preview, name + type badge, and a live presence
// overlay (peer color border + avatar) when a teammate has this card open.
//
// Gallery is a real way to browse a sample pack once cover art is being read
// off the files, so audio tiles get the same play button and download the
// table rows have — the transport sits over the preview rather than beside it.
export const ClusterTile = memo(function ClusterTile({
  item, selected, isNew, peers, onClick, onDoubleClick, member = false,
  onDownload = null, onAudition = null, playing = false, draggable = false, onBoard = false,
  // Justified grid: where the tile sits and how tall its preview is.
  style = null, previewH = null, px = null,
  active = false, tileRef = null,
  // Inline rename: when set, the name is a field ({ onCommit, onCancel }).
  rename = null,
  markUnplaced = false,   // mark files that aren't on the board (lib/placement.js)
}) {
  const peer = peers && peers[0];
  const caption = captionOf(item.name, item.ext);
  // Where the file stands with the board, as a mark by its name — never on the
  // picture: once most tiles carry it, anything on the art repeats across the
  // whole grid. Dashed: in the cluster, not on its board. Solid: a copy is on
  // this board (seen while browsing another cluster).
  const flag = markUnplaced && item.unplaced
    ? { cls: 'is-off', label: 'Not on board', title: 'Not on board — in this cluster, not placed on its board' }
    : onBoard ? { cls: 'is-on', label: 'On board', title: 'A copy of this file is already on the board' } : null;
  const canDownload = !!onDownload && !item.pending && DOWNLOADABLE.has(item.kind);
  const canAudition = !!onAudition && item.kind === 'audio' && !item.pending;
  return (
    <div
      ref={tileRef}
      className={`ct-tile${member ? ' ct-member' : ''}${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}${item.pending ? ' is-pending' : ''}${peer ? ' is-peer' : ''}${playing ? ' is-playing' : ''}`}
      style={peer || style || previewH ? { ...(style || {}), ...(previewH ? { '--jg-h': `${previewH}px` } : {}), ...(peer ? { '--peer-color': peer.user.color } : {}) } : undefined}
      data-item-id={item.id}
      draggable={draggable && !item.pending && !rename ? true : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="ct-tile-preview" data-face={['r2', 'swatches'].includes(item.preview?.mode) ? 'photo' : 'paper'}>
        <CardPreview item={item} size="tile" px={px} />
        {item.pending && <span className="ct-thumb-spin ct-tile-spin" aria-hidden="true" />}
        {/* Add to (or take out of) the selection without a modifier key —
            the way to multi-select on a trackpad or a touchscreen. */}
        <button type="button" className="ct-tile-check" tabIndex={-1}
                aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
                aria-pressed={!!selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.({ target: e.currentTarget, metaKey: true, ctrlKey: true, shiftKey: e.shiftKey, stopPropagation() {} });
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                // A click mustn't park focus here — Space and Enter belong to the
                // list's keyboard (Quick look, select the highlighted file) — nor
                // leave it on whatever had it before: let go of focus, the same
                // as a click on the tile itself does.
                onMouseDown={(e) => { e.preventDefault(); document.activeElement?.blur?.(); }}>
          <Icon as={Check} size={11} weight="bold" />
        </button>
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
            <Icon as={Download} size={14} weight="light" />
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
        {flag && !rename && <span className={`ct-tile-flag ${flag.cls}`} role="img" aria-label={flag.label} title={flag.title} />}
        {rename
          ? <InlineRename value={item.name} onCommit={rename.onCommit} onCancel={rename.onCancel} className="ct-tile-rename" />
          : <div className="ct-tile-name" title={item.name}>{caption}{item.version && <span className="ct-version-chip" title="Versions are in Info">{item.version}</span>}</div>}
        <div className="ct-tile-type">{item.pending ? 'Uploading…' : (item.sub || item.typeLabel)}</div>
      </div>
    </div>
  );
});
