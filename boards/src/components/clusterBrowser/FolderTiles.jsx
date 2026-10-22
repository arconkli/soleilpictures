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
import { Link as LinkIcon, Check, FolderSimple, LinkSimple } from '../../lib/icons.js';
import { InlineRename } from './InlineRename.jsx';
import { relativeTimeShort } from '../../lib/relativeTime.js';

// Unknown (no card_count yet) says nothing rather than claiming "Empty".
export function countLabel(n) {
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
  checks = false,    // Select is picking several: a check says whether it's in
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
      {checks && <span className="row-check" aria-hidden="true"><Icon as={Check} size={11} weight="bold" /></span>}
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

// A cluster as a row of the classic List (the full Files page in the files
// sidebar's look): first in the table, as folders are in Finder. Kind says
// Cluster or Linked cluster, Size how much is in it, and the last column who
// is in it now. Interaction is the caller's, as for FolderTile.
export const FolderRow = memo(function FolderRow({
  board, name, linked = false, missing = false, peers = null, selected = false, dropTarget = false,
  springing = false, rename = null, checks = false, zebra = false, audioMode = false, dateKey = 'created',
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
  const label = name || board?.name || (linked ? 'Linked cluster' : 'Untitled cluster');
  const when = dateKey === 'created' ? board?.created_at : (board?.updated_at || board?.created_at);
  const first = people[0] ? ((people[0].name || '').split(/\s+/)[0] || 'Someone') : null;
  const kind = linked ? 'Linked cluster' : 'Cluster';
  return (
    <div {...divProps} role="row"
         draggable={rename ? undefined : divProps.draggable}
         className={`ct-row ct-folder-row${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}${springing ? ' is-springing' : ''}${zebra ? ' is-zebra' : ''}${className ? ` ${className}` : ''}`}
         title={label}>
      <div role="cell" className="ct-cell ct-c-name">
        {checks && <span className="row-check" aria-hidden="true"><Icon as={Check} size={11} weight="bold" /></span>}
        <div className="ct-thumb ct-folder-glyph"><Icon as={FolderSimple} size={14} weight="regular" /></div>
        <div className="ct-name-wrap">
          {rename
            ? <InlineRename value={label} onCommit={rename.onCommit} onCancel={rename.onCancel} label="Cluster name" className="ct-row-rename" />
            : <div className="ct-name">{label}</div>}
        </div>
        {linked && (
          <span className="ct-folder-link" role="img" aria-label="Linked cluster" title="Linked cluster">
            <Icon as={LinkSimple} size={12} weight="regular" />
          </span>
        )}
      </div>
      {audioMode ? (
        <>
          <div role="cell" className="ct-cell ct-c-dur" />
          <div role="cell" className="ct-cell ct-c-bpm" />
          <div role="cell" className="ct-cell ct-c-key" />
          <div role="cell" className="ct-cell ct-c-fmt">{kind}</div>
        </>
      ) : (
        <>
          <div role="cell" className="ct-cell ct-c-type">{kind}</div>
          <div role="cell" className="ct-cell ct-c-size">{missing ? 'Not available' : countLabel(board?.card_count)}</div>
        </>
      )}
      <div role="cell" className="ct-cell ct-c-date">{when ? relativeTimeShort(when) : ''}</div>
      <div role="cell" className="ct-cell ct-c-presence">
        {first && (
          <>
            <Avatar name={people[0].name} color={people[0].color} size={18} ring />
            <span className="ct-status">{first} is in it</span>
          </>
        )}
      </div>
    </div>
  );
});
