// Folders in Files — a cluster's sub-clusters (and linked clusters) as compact
// rows: the cluster's cover (or, without one, the same tint dot the sidebar
// marks every cluster with), the name, how much is inside.
// They replaced full BoardCard tiles at a fixed 200px, which in a narrow panel
// stacked one huge card per row and on a wide screen left most of it empty.
//
// The cover is the cluster's stored thumbnail (thumb_key, rendered by the
// thumbnail pipeline) — never a live snapshot decode — and the count is
// boards.card_count, so a row of folders costs nothing to draw.
//
// Interaction lives with the caller: ListSurface passes the same click /
// double-click / drag / drop handlers it gave the old tiles, as plain div
// props, so reparenting by drag keeps working unchanged.

import { memo } from 'react';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { COVER_TINTS, Avatar } from '../primitives.jsx';
import { Link as LinkIcon } from '../../lib/icons.js';
import { InlineRename } from './InlineRename.jsx';

// Unknown (no card_count yet) says nothing rather than claiming "Empty".
function countLabel(n) {
  if (!Number.isFinite(n)) return '';
  if (n <= 0) return 'Empty';
  return `${n} item${n === 1 ? '' : 's'}`;
}

export const FolderTile = memo(function FolderTile({
  board, name, selected = false, dropTarget = false, linked = false, missing = false,
  // Teammates inside this cluster right now ({ user } entries), shown as a
  // small stack — the presence the old board cards carried.
  peers = null,
  rename = null,   // inline rename: { onCommit, onCancel }
  compact = false, // the panel's one-line rows: a smaller cover and glyph
  springing = false, // a drag is held over it: it's about to open (lib/springLoad.js)
  className = '', ...divProps
}) {
  const people = [];
  const seen = new Set();
  for (const p of peers || []) {
    const u = p?.user || p;
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    people.push(u);
  }
  // "sun" IS the brand gold: in Files a resting folder in it read as the
  // selected one, so it shows as sand here (the canvas keeps the person's
  // choice). Mapped in JS — the inline custom property beats any stylesheet.
  const cover = board?.cover === 'sun' ? 'sand' : (board?.cover || 'neutral');
  const tint = COVER_TINTS[cover] || COVER_TINTS.neutral;
  const label = name || board?.name || (linked ? 'Linked cluster' : 'Untitled cluster');
  return (
    <div {...divProps}
         draggable={rename ? undefined : divProps.draggable}
         className={`ft${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}${springing ? ' is-springing' : ''}${linked ? ' is-linked' : ''}${className ? ` ${className}` : ''}`}
         title={label}>
      <div className="ft-cover" data-cover={cover} style={{ '--ft-tint': tint }}>
        {board?.thumb_key ? (
          <R2Image src={board.thumb_key} key={board.thumb_updated_at || board.thumb_key}
                   bust={board.thumb_updated_at} className="ft-thumb" alt="" draggable={false} />
        ) : (
          <span className="ft-dot" aria-hidden="true" />
        )}
      </div>
      <div className="ft-text">
        <div className="ft-line">
          {rename
            ? <InlineRename value={label} onCommit={rename.onCommit} onCancel={rename.onCancel} label="Cluster name" />
            : <div className="ft-name">{label}</div>}
          {linked && (
            <span className="ft-link" role="img" aria-label="Linked cluster" title="Linked cluster">
              <Icon as={LinkIcon} size={12} weight="light" />
            </span>
          )}
        </div>
        {(missing || Number.isFinite(board?.card_count)) && (
          <div className="ft-meta">{missing ? 'Not available' : countLabel(board.card_count)}</div>
        )}
      </div>
      {people.length > 0 && (
        <div className="ft-peers" title={`${people.length} here`}>
          {people.slice(0, 3).map((u) => <Avatar key={u.id} name={u.name} color={u.color} size={16} ring />)}
        </div>
      )}
    </div>
  );
});
