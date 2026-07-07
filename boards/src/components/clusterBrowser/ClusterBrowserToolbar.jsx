import { useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Avatar } from '../primitives.jsx';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { Search, Filter, List, LayoutGrid, Plus, ChevronDown, X } from '../../lib/icons.js';

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'updated', label: 'Date modified' },
  { key: 'created', label: 'Date added' },
];

// Small frosted popover anchored under its trigger. Closes on outside tap/esc.
function Menu({ open, onClose, children }) {
  const ref = useRef(null);
  useDismissOnOutside(ref, open, onClose);
  if (!open) return null;
  return <div className="cbt-menu" ref={ref} role="menu">{children}</div>;
}

// The single shared toolbar for the cluster browser: search + sort + filter +
// Table/Gallery toggle + Add-files + presence facepile. Holds only menu-open UI
// state; all data lives in the orchestrator and flows back through callbacks.
export function ClusterBrowserToolbar({
  query, onQueryChange,
  sortKey, sortDir, onSort,
  filters, availableBuckets, onToggleFilter, onClearFilters,
  viewMode, onViewMode,
  onAddFiles, canEdit = true,
  facePeers = [],
  onSearchKeyDown, searchRef,
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilters = filters instanceof Set ? filters : new Set(filters || []);
  const dedupPeers = [];
  const seen = new Set();
  for (const p of facePeers) {
    const u = p.user || p;
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    dedupPeers.push(u);
  }

  return (
    <div className="cbt">
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

      <div className="cbt-spacer" />

      {/* Sort */}
      <div className="cbt-menuwrap">
        <button className={`cbt-btn${sortOpen ? ' is-open' : ''}`} onClick={() => { setSortOpen(o => !o); setFilterOpen(false); }}
                aria-haspopup="menu" aria-expanded={sortOpen}>
          Sort<Icon as={ChevronDown} size={12} />
        </button>
        <Menu open={sortOpen} onClose={() => setSortOpen(false)}>
          {SORT_OPTIONS.map(o => (
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
                onClick={() => { setFilterOpen(o => !o); setSortOpen(false); }}
                aria-haspopup="menu" aria-expanded={filterOpen}>
          <Icon as={Filter} size={13} />Filter{activeFilters.size ? ` · ${activeFilters.size}` : ''}
        </button>
        <Menu open={filterOpen} onClose={() => setFilterOpen(false)}>
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

      {/* Table / Gallery toggle */}
      <div className="view-pill cbt-viewtoggle">
        <button className={`view-pill-btn${viewMode === 'table' ? ' on' : ''}`} onClick={() => onViewMode('table')}
                aria-label="Table view"><Icon as={List} size={14} /></button>
        <button className={`view-pill-btn${viewMode === 'gallery' ? ' on' : ''}`} onClick={() => onViewMode('gallery')}
                aria-label="Gallery view"><Icon as={LayoutGrid} size={14} /></button>
      </div>

      {canEdit && (
        <button className="cbt-btn cbt-add" onClick={onAddFiles}>
          <Icon as={Plus} size={14} />Add files
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
