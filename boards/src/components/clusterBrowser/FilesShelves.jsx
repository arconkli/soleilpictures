// The full Files page's Grid in the files sidebar's look (direction A; the
// look is filesLook.js): the card's shelves, grown. Clusters first (this
// one's sub-clusters and the clusters linked into it, as cards with their
// covers), then the files shelf by shelf (lib/filesView.js): photos and video
// in a justified grid without captions (the picture is the name; Info and
// Quick look carry it), the rest as rows with columns. Notes, links and the
// rest start closed, as the card's do, until opened.

import { useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';
import { TILE_SIZES, DEFAULT_TILE_SIZE } from '../../lib/justifiedGrid.js';
import { JustifiedGallery } from './JustifiedGallery.jsx';
import { ClusterTable } from './ClusterTable.jsx';

// A shelf's heading, as the card's (ClusterShelves.jsx): its name and count,
// and a caret when it opens and closes.
export function FilesShelfHead({ id, label, count, closed = false, foldable = false, onToggle = null, first = false }) {
  return (
    <div className={`sbf-shelf fp-shelf${closed ? ' is-closed' : ''}${first ? ' is-first' : ''}`} data-shelf={id}>
      {foldable ? (
        <button type="button" className="sbf-shelf-toggle" aria-expanded={!closed}
                title={`${closed ? 'Show' : 'Hide'} ${label.toLowerCase()}`} onClick={onToggle}>
          <span className="sbf-shelf-label">{label}</span>
          <span className="sbf-shelf-count">{count}</span>
          <span className="sbf-shelf-caret" aria-hidden="true"><Icon as={ChevronRight} size={10} weight="regular" /></span>
        </button>
      ) : (
        <h2 className="sbf-shelf-toggle is-static">
          <span className="sbf-shelf-label">{label}</span>
          <span className="sbf-shelf-count">{count}</span>
        </h2>
      )}
    </div>
  );
}

// Video lies a little lower than photos (its shapes are wider).
const VIDEO_ROW = 0.82;
// A phone's rows lie lower still: three or four pictures across, as Photos
// shows them, not two.
const PHONE_ROWS = { s: 76, m: 100, l: 150 };

export function FilesShelves({
  folders = null,           // { count, nodes }: the Clusters shelf, or null
  sections, closedShelves, foldable, onToggle,
  galleryProps, tableProps, tileSize = DEFAULT_TILE_SIZE, phone = false,
  onShelfLayout = null,     // (shelfId, { tiles, ids }) => void, for the arrows
}) {
  // One layout callback per shelf, kept, so the gallery's effect doesn't see
  // a new one every render.
  const fns = useRef(new Map());
  const layoutFor = (id) => {
    let f = fns.current.get(id);
    if (!f) { f = (nav) => onShelfLayout?.(id, nav); fns.current.set(id, f); }
    return f;
  };
  const sizes = phone ? PHONE_ROWS : TILE_SIZES;
  const rowH = sizes[tileSize] || sizes[DEFAULT_TILE_SIZE];
  let first = true;
  const head = (props) => { const h = <FilesShelfHead {...props} first={first} />; first = false; return h; };
  return (
    <>
      {folders && folders.count > 0 && (
        <>
          {head({ id: 'clusters', label: 'Clusters', count: folders.count })}
          <div className="fp-cls">{folders.nodes}</div>
        </>
      )}
      {sections.map((s) => {
        const closed = closedShelves.has(s.id);
        const h = head({ id: s.id, label: s.label, count: s.count, closed, foldable: foldable(s), onToggle: () => onToggle(s.id) });
        if (closed) return <div key={s.id}>{h}</div>;
        // The heading and its grid or rows are siblings in one wrapper per
        // shelf. A shelf's rows keep one set of columns: an audio shelf's
        // length is in its Size column, not the pack's audio columns.
        return (
          <div key={s.id}>
            {h}
            {s.layout === 'grid' ? (
              <JustifiedGallery {...galleryProps} items={s.items} tileSize={tileSize}
                gap={8} captionH={0} rowHeight={s.id === 'video' ? Math.round(rowH * VIDEO_ROW) : rowH}
                onLayout={layoutFor(s.id)} />
            ) : (
              <ClusterTable {...tableProps} audioMode={false} items={s.items} bare />
            )}
          </div>
        );
      })}
    </>
  );
}
