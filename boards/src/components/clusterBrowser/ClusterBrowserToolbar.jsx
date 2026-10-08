import { useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Avatar } from '../primitives.jsx';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { PathBar } from './PathBar.jsx';
import { Search, Filter, List, LayoutGrid, Plus, ChevronDown, X, Maximize2, Minimize2 } from '../../lib/icons.js';

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

// The single shared toolbar for the cluster browser: search + sort + filter +
// Grid/List toggle + Add-files + presence facepile. Holds only menu-open UI
// state; all data lives in the orchestrator and flows back through callbacks.
export function ClusterBrowserToolbar({
  query, onQueryChange,
  sortKey, sortDir, onSort,
  filters, availableBuckets, onToggleFilter, onClearFilters,
  viewMode, onViewMode,
  tileSize = 'm', onTileSize = null,
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
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const activeFilters = filters instanceof Set ? filters : new Set(filters || []);
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
      <Icon as={Search} size={15} className="cbt-search-icon" />
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
          <Icon as={X} size={13} />
        </button>
      )}
    </div>
  );

  if (compact) {
    const sortOptions = [...SORT_OPTIONS, ...(audioMode ? AUDIO_SORT_OPTIONS : [])];
    return (
      <div className="cbt cbt--compact">
        <div className="cbt-titlerow">
          {pathBar
            ? <PathBar {...pathBar} />
            : <span className="cbt-title" title={clusterName}>{clusterName || 'Files'}</span>}
          {dockControls?.onExpand && (
            <button type="button" className="cbt-iconbtn" onClick={dockControls.onExpand}
                    aria-label="Expand Files to full screen" title="Full screen (or drag the edge all the way)">
              <Icon as={Maximize2} size={14} />
            </button>
          )}
          {dockControls?.onClose && (
            <button type="button" className="cbt-iconbtn" onClick={dockControls.onClose}
                    aria-label="Close Files" title="Close Files (F)">
              <Icon as={X} size={15} />
            </button>
          )}
        </div>
        {readOnlyNote && <div className="cbt-note">{readOnlyNote}</div>}
        <div className="cbt-row">
          {searchBox}
          <div className="cbt-menuwrap">
            <button className={`cbt-btn${viewOpen ? ' is-open' : ''}${activeFilters.size ? ' has-active' : ''}`}
                    data-menu-trigger="view"
                    onClick={() => setViewOpen(o => !o)} aria-haspopup="menu" aria-expanded={viewOpen}>
              View{activeFilters.size ? ` · ${activeFilters.size}` : ''}<Icon as={ChevronDown} size={12} />
            </button>
            <Menu open={viewOpen} onClose={() => setViewOpen(false)} trigger="view">
              <div className="cbt-menu-label">Layout</div>
              <button className={`ctx-item${viewMode === 'gallery' ? ' is-active' : ''}`} onClick={() => onViewMode('gallery')}>
                <span>Grid</span>
              </button>
              <button className={`ctx-item${viewMode === 'table' ? ' is-active' : ''}`} onClick={() => onViewMode('table')}>
                <span>List</span>
              </button>
              {viewMode === 'gallery' && onTileSize && (
                <>
                  <div className="cbt-menu-label">Size</div>
                  <div className="cbt-sizes">{sizePill}</div>
                </>
              )}
              <div className="ctx-divider" />
              <div className="cbt-menu-label">Sort by</div>
              {sortOptions.map(o => (
                <button key={o.key} className={`ctx-item${sortKey === o.key ? ' is-active' : ''}`} onClick={() => onSort(o.key)}>
                  <span>{o.label}</span>
                  {sortKey === o.key && <span className="cbt-caret">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
              {availableBuckets.length > 0 && (
                <>
                  <div className="ctx-divider" />
                  <div className="cbt-menu-label">Show only</div>
                  {availableBuckets.map(b => (
                    <button key={b.key} className={`ctx-item${activeFilters.has(b.key) ? ' is-active' : ''}`}
                            onClick={() => onToggleFilter(b.key)}>
                      <span>{b.label}</span>
                      <span className="cbt-count">{b.count}</span>
                    </button>
                  ))}
                  {activeFilters.size > 0 && (
                    <button className="ctx-item" onClick={() => onClearFilters()}>Clear filters</button>
                  )}
                </>
              )}
            </Menu>
          </div>
          {canEdit && (
            <button type="button" className="cbt-iconbtn cbt-add-ico" onClick={onAddFiles}
                    aria-label="Add files" title="Add files">
              <Icon as={Plus} size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cbt">
      {searchBox}

      <div className="cbt-spacer" />

      {/* Sort */}
      <div className="cbt-menuwrap">
        <button className={`cbt-btn${sortOpen ? ' is-open' : ''}`} data-menu-trigger="sort" onClick={() => { setSortOpen(o => !o); setFilterOpen(false); }}
                aria-haspopup="menu" aria-expanded={sortOpen}>
          Sort<Icon as={ChevronDown} size={12} />
        </button>
        <Menu open={sortOpen} onClose={() => setSortOpen(false)} trigger="sort">
          {[...SORT_OPTIONS, ...(audioMode ? AUDIO_SORT_OPTIONS : [])].map(o => (
            <button key={o.key} className={`ctx-item${sortKey === o.key ? ' is-active' : ''}`}
                    onClick={() => { onSort(o.key); setSortOpen(false); }}>
              <span>{o.label}</span>
              {sortKey === o.key && <span className="cbt-caret">{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          ))}
        </Menu>
      </div>

      {/* Filter */}
      <div className="cbt-menuwrap">
        <button className={`cbt-btn${filterOpen ? ' is-open' : ''}${activeFilters.size ? ' has-active' : ''}`}
                data-menu-trigger="filter"
                onClick={() => { setFilterOpen(o => !o); setSortOpen(false); }}
                aria-haspopup="menu" aria-expanded={filterOpen}>
          <Icon as={Filter} size={13} />Filter{activeFilters.size ? ` · ${activeFilters.size}` : ''}
        </button>
        <Menu open={filterOpen} onClose={() => setFilterOpen(false)} trigger="filter">
          {availableBuckets.length === 0 && <div className="ctx-empty">Nothing to filter</div>}
          {availableBuckets.map(b => (
            <button key={b.key} className={`ctx-item${activeFilters.has(b.key) ? ' is-active' : ''}`}
                    onClick={() => onToggleFilter(b.key)}>
              <span>{b.label}</span>
              <span className="cbt-count">{b.count}</span>
            </button>
          ))}
          {activeFilters.size > 0 && (
            <>
              <div className="ctx-divider" />
              <button className="ctx-item" onClick={() => { onClearFilters(); }}>Clear filters</button>
            </>
          )}
        </Menu>
      </div>

      {viewMode === 'gallery' && onTileSize && sizePill}

      {/* Grid / List layout (internally 'gallery' / 'table'). Grid first: it is
          the default for any cluster that is not mostly audio. */}
      <div className="view-pill cbt-viewtoggle" role="group" aria-label="Layout">
        <button className={`view-pill-btn${viewMode === 'gallery' ? ' on' : ''}`} onClick={() => onViewMode('gallery')}
                aria-label="Grid layout" aria-pressed={viewMode === 'gallery'} title="Grid"><Icon as={LayoutGrid} size={14} /></button>
        <button className={`view-pill-btn${viewMode === 'table' ? ' on' : ''}`} onClick={() => onViewMode('table')}
                aria-label="List layout" aria-pressed={viewMode === 'table'} title="List"><Icon as={List} size={14} /></button>
      </div>

      {canEdit && (
        <button className="cbt-btn cbt-add" onClick={onAddFiles}>
          <Icon as={Plus} size={14} />Add files
        </button>
      )}
      {canEdit && showUpsell && (
        <button className="cbt-upsell" onClick={() => onUpsell?.()}>
          Any file, any size — Creator
        </button>
      )}

      {dockControls?.mode === 'full' && dockControls.canShrink && dockControls.onShrink && (
        <button type="button" className="cbt-btn cbt-shrink" onClick={dockControls.onShrink}
                title="Put Files beside the board">
          <Icon as={Minimize2} size={13} />Beside board
        </button>
      )}

      {dedupPeers.length > 0 && (
        <div className="cbt-facepile" title={`${dedupPeers.length} here`}>
          {dedupPeers.slice(0, 4).map((u, i) => (
            <Avatar key={u.id || i} name={u.name} color={u.color} size={22} ring />
          ))}
          {dedupPeers.length > 4 && <span className="cbt-face-more">+{dedupPeers.length - 4}</span>}
        </div>
      )}
    </div>
  );
}
