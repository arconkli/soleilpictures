import { useId, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Avatar } from '../primitives.jsx';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { PathBar } from './PathBar.jsx';
import { Search, List, LayoutGrid, Plus, X, ArrowsOutSimple, Check, SlidersHorizontal } from '../../lib/icons.js';

const SORT_OPTIONS = [
  // The canvas read like a page — the default, so Files opens on the same
  // board, lined up (lib/listItem.js boardOrder).
  { key: 'board', label: 'Board order' },
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'updated', label: 'Date modified' },
  { key: 'created', label: 'Date added' },
];

// Offered only when the table is in loop-browser mode — sorting by a column
// that isn't on screen is a menu entry that appears to do nothing.
const AUDIO_SORT_OPTIONS = [
  { key: 'duration', label: 'Length' },
  { key: 'bpm', label: 'Tempo' },
  { key: 'key', label: 'Key' },
  { key: 'format', label: 'Format' },
];

// Small frosted popover anchored under its trigger. Closes on outside tap/esc.
// Its own trigger doesn't count as outside — otherwise pressing it to close
// the menu closed it on pointerdown and the click opened it again.
function Menu({ open, onClose, trigger = null, children }) {
  const ref = useRef(null);
  useDismissOnOutside(ref, open, onClose, { ignore: trigger ? `[data-menu-trigger="${trigger}"]` : null });
  if (!open) return null;
  return <div className="cbt-menu" ref={ref} role="menu">{children}</div>;
}

// A menu row. The check in its gutter is what says which layout, sort or
// filter is on — the class alone drew nothing. `role` is menuitemradio for a
// pick-one (layout, sort) and menuitemcheckbox for Show only.
function Item({ active = false, onClick, role = 'menuitemradio', children }) {
  return (
    <button type="button" className={`ctx-item${active ? ' is-active' : ''}`} onClick={onClick}
            role={role} aria-checked={active}>
      {active && <Icon as={Check} size={12} weight="bold" className="cbt-check" />}
      {children}
    </button>
  );
}

// One labelled section of a menu, so a screen reader hears "Sort by" with
// its choices rather than a flat run of rows.
function Group({ label, children }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <div className="cbt-menu-label" id={id}>{label}</div>
      {children}
    </div>
  );
}

// The single shared toolbar for the cluster browser: search + sort + filter +
// Grid/List toggle + Add-files + presence facepile. Holds only menu-open UI
// state; all data lives in the orchestrator and flows back through callbacks.
export function ClusterBrowserToolbar({
  query, onQueryChange,
  sortKey, sortDir, onSort,
  filters, availableBuckets, onToggleFilter, onClearFilters,
  viewMode, onViewMode,
  tileSize = 'm', onTileSize = null,
  // "Not on board" — files in the cluster that aren't on its board.
  unplacedCount = 0, unplacedOnly = false, onToggleUnplaced = null,
  onAddFiles, canEdit = true,
  // Quiet storage upsell for free workspace owners (their generic uploads are
  // paid-gated) — muted text link, NOT gold (gold = active/selection only).
  showUpsell = false, onUpsell = null,
  facePeers = [],
  onSearchKeyDown, searchRef,
  audioMode = false,
  // Beside the board (FilesDock): a two-row panel header — the cluster's name
  // with the dock's ⤢ and ×, then search with one View menu holding sort,
  // filter and layout. dockControls = { mode, canShrink, onExpand, onShrink,
  // onClose } from the shell; in full Files it adds the ⤡ that docks it again.
  compact = false,
  clusterName = '',
  dockControls = null,
  // The panel's location (FilesPane) — replaces the plain title when present.
  pathBar = null,
  readOnlyNote = '',
  // While files are dragged over Files: { text, blocked } — said in the
  // header, in place of the search row.
  dropBanner = null,
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const activeFilters = filters instanceof Set ? filters : new Set(filters || []);
  const activeCount = activeFilters.size + (unplacedOnly ? 1 : 0);
  const unplacedItem = unplacedCount > 0 && onToggleUnplaced ? (
    <Item active={unplacedOnly} onClick={() => onToggleUnplaced()} role="menuitemcheckbox">
      <span className="ct-tile-flag is-off cbt-flag" aria-hidden="true" />
      <span>Not on board</span>
      <span className="cbt-count">{unplacedCount}</span>
    </Item>
  ) : null;
  const dedupPeers = [];
  const seen = new Set();
  for (const p of facePeers) {
    const u = p.user || p;
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    dedupPeers.push(u);
  }

  // Tile size for the Grid layout — S / M / L, remembered on this device.
  const sizePill = (
    <div className="view-pill cbt-sizepill" role="group" aria-label="Tile size">
      {[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, label]) => (
        <button key={k} type="button" className={`view-pill-btn${tileSize === k ? ' on' : ''}`}
                aria-label={`${label} tiles`} aria-pressed={tileSize === k} title={`${label} tiles`}
                onClick={() => onTileSize?.(k)}>{k.toUpperCase()}</button>
      ))}
    </div>
  );
  const searchBox = (
    <div className="cbt-search">
      <Icon as={Search} size={16} weight="light" className="cbt-search-icon" />
      <input
        ref={searchRef}
        className="cbt-input"
        type="text"
        placeholder="Search this cluster…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onSearchKeyDown}
        aria-label="Search files in this cluster"
      />
      {query && (
        <button className="cbt-clear" onClick={() => onQueryChange('')} aria-label="Clear search">
          <Icon as={X} size={12} weight="light" />
        </button>
      )}
    </div>
  );

  // One View menu for both sizes of Files: layout (beside the board only —
  // full Files keeps Grid/List on screen), tile size, sort, and Show only.
  const sortOptions = [...SORT_OPTIONS, ...(audioMode ? AUDIO_SORT_OPTIONS : [])];
  // Its label can be hidden (a narrow panel shows the icon alone), so the
  // name — with how many filters are on — rides on aria-label and the tooltip.
  const viewName = activeCount ? `View, ${activeCount} ${activeCount === 1 ? 'filter' : 'filters'} on` : 'View';
  const viewMenu = (withLayout) => (
    <div className="cbt-menuwrap">
      <button type="button" className={`cbt-btn${viewOpen ? ' is-open' : ''}${activeCount ? ' has-active' : ''}`}
              data-menu-trigger="view" aria-label={viewName} title={viewName}
              onClick={() => setViewOpen(o => !o)} aria-haspopup="menu" aria-expanded={viewOpen}>
        <Icon as={SlidersHorizontal} size={16} weight="light" className="cbt-btn-ico" />
        <span className="cbt-btn-label">View{activeCount ? ` · ${activeCount}` : ''}</span>
      </button>
      <Menu open={viewOpen} onClose={() => setViewOpen(false)} trigger="view">
        {withLayout && (
          <Group label="Layout">
            <Item active={viewMode === 'gallery'} onClick={() => onViewMode('gallery')}><span>Grid</span></Item>
            <Item active={viewMode === 'table'} onClick={() => onViewMode('table')}><span>List</span></Item>
          </Group>
        )}
        {viewMode === 'gallery' && onTileSize && (
          <Group label="Size">
            <div className="cbt-sizes">{sizePill}</div>
          </Group>
        )}
        {(withLayout || (viewMode === 'gallery' && onTileSize)) && <div className="ctx-divider" role="separator" />}
        <Group label="Sort by">
          {sortOptions.map(o => (
            <Item key={o.key} active={sortKey === o.key} onClick={() => onSort(o.key)}>
              <span>{o.label}</span>
              {sortKey === o.key && <span className="cbt-caret">{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </Item>
          ))}
        </Group>
        {(availableBuckets.length > 0 || unplacedItem) && (
          <>
            <div className="ctx-divider" role="separator" />
            <Group label="Show only">
              {unplacedItem}
              {availableBuckets.map(b => (
                <Item key={b.key} active={activeFilters.has(b.key)} onClick={() => onToggleFilter(b.key)} role="menuitemcheckbox">
                  <span>{b.label}</span>
                  <span className="cbt-count">{b.count}</span>
                </Item>
              ))}
              {activeCount > 0 && (
                <button type="button" role="menuitem" className="ctx-item cbt-clear-filters" onClick={() => onClearFilters()}>Clear filters</button>
              )}
            </Group>
          </>
        )}
      </Menu>
    </div>
  );

  if (compact) {
    return (
      <div className="cbt cbt--compact">
        <div className="cbt-titlerow">
          {pathBar
            ? <PathBar {...pathBar} readOnly={!!readOnlyNote} />
            : <span className="cbt-title" title={clusterName}>{clusterName || 'Files'}</span>}
          {dockControls?.onExpand && (
            <button type="button" className="cbt-iconbtn" onClick={dockControls.onExpand}
                    aria-label="Expand Files to full screen" title="Full screen (or drag the edge all the way)">
              <Icon as={ArrowsOutSimple} size={16} weight="light" />
            </button>
          )}
          {dockControls?.onClose && (
            <button type="button" className="cbt-iconbtn" onClick={dockControls.onClose}
                    aria-label="Close Files" title="Close Files (F)">
              <Icon as={X} size={16} weight="light" />
            </button>
          )}
        </div>
        {dropBanner ? (
          <div className={`lp-drop${dropBanner.blocked ? ' is-blocked' : ''}`} role="status">{dropBanner.text}</div>
        ) : (
        <div className="cbt-row">
          {searchBox}
          {viewMenu(true)}
          {canEdit && (
            <button type="button" className="cbt-iconbtn cbt-add-ico" onClick={onAddFiles}
                    aria-label="Add files" title="Add files">
              <Icon as={Plus} size={16} weight="light" />
            </button>
          )}
        </div>
        )}
      </div>
    );
  }

  // Full Files: search, then one quiet group — View, Grid/List — and the one
  // filled button, Add files. ⤡ mirrors the panel's ⤢.
  if (dropBanner) {
    return (
      <div className="cbt cbt--full">
        <div className={`lp-drop${dropBanner.blocked ? ' is-blocked' : ''}`} role="status">{dropBanner.text}</div>
      </div>
    );
  }
  return (
    <div className="cbt cbt--full">
      {searchBox}
      <div className="cbt-spacer" />
      {dedupPeers.length > 0 && (
        <div className="cbt-facepile" title={`${dedupPeers.length} here`}>
          {dedupPeers.slice(0, 4).map((u, i) => (
            <Avatar key={u.id || i} name={u.name} color={u.color} size={22} ring />
          ))}
          {dedupPeers.length > 4 && <span className="cbt-face-more">+{dedupPeers.length - 4}</span>}
        </div>
      )}
      {viewMenu(false)}
      {/* Grid / List layout (internally 'gallery' / 'table'). Grid first: it is
          the default for any cluster that is not mostly audio. */}
      <div className="view-pill cbt-viewtoggle" role="group" aria-label="Layout">
        <button className={`view-pill-btn${viewMode === 'gallery' ? ' on' : ''}`} onClick={() => onViewMode('gallery')}
                aria-label="Grid layout" aria-pressed={viewMode === 'gallery'} title="Grid"><Icon as={LayoutGrid} size={16} weight="light" /></button>
        <button className={`view-pill-btn${viewMode === 'table' ? ' on' : ''}`} onClick={() => onViewMode('table')}
                aria-label="List layout" aria-pressed={viewMode === 'table'} title="List"><Icon as={List} size={16} weight="light" /></button>
      </div>
      {canEdit && showUpsell && (
        <button className="cbt-upsell" onClick={() => onUpsell?.()}>
          Any file, any size — Creator
        </button>
      )}
      {canEdit && (
        <button type="button" className="cbt-add" onClick={onAddFiles}>
          <Icon as={Plus} size={14} weight="regular" />Add files
        </button>
      )}
    </div>
  );
}
