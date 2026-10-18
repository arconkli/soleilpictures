// The sidebar that holds every file (behind sidebarFilesAllowed until it ships).
//
// Clusters stay the folders and stay prominent: a cover, a name, a count of
// everything inside. Unfold one and its sub-clusters come first, then its
// contents on shelves (lib/sidebarShelves.js). Above the clusters, your Starred
// things and what was added Recently; below them, Shared with me and Tags.
// The header finds things: typing filters the tree in place, Enter with
// nothing found (or ⌘K) hands the words to the command palette, the chips
// narrow it to one kind of thing, ⇅ sorts and groups.
//
// Unfolding follows you (lib/sidebarExpand.js): the cluster you're in opens,
// and folds again when you leave unless you opened it by hand. Clicking a file
// opens Quick look; double-clicking goes to it on its board.

import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { COVER_TINTS } from '../primitives.jsx';
import { Search, X, Star, Clock } from '../../lib/icons.js';
import { SidebarBoardsSection } from '../SidebarBoardsSection.jsx';
import { ClusterShelves, SidebarItemRow, SidebarTile } from './ClusterShelves.jsx';
import { mosaicPerLine } from '../../lib/sidebarRows.js';
import { SidebarMeter } from './SidebarMeter.jsx';
import { useSidebarFiles } from '../../hooks/useSidebarFiles.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { FILTER_CHIPS } from '../../lib/sidebarShelves.js';
import { SORTS } from '../../lib/sidebarSort.js';
import { initialExpandState, expandReducer, isExpanded, persistManual, shelfKey, toggleShelf } from '../../lib/sidebarExpand.js';
import { cardFromItem } from '../../lib/indexRowCard.js';
import { toListItem } from '../../lib/listItem.js';
import { downloadCardAsset } from '../../lib/cardDownload.js';
import './clusterSidebar.css';

const QuickLook = lazy(() => import('../clusterBrowser/QuickLook.jsx'));

const PREFS_KEY = 'soleil.sidebar.prefs';
// A new key, not the old tree's soleil.boards.sb.expanded.<ws>: that set holds
// every branch anyone ever opened, and here an open branch shows its files.
const unfoldedKey = (ws) => `soleil.sidebar.unfolded.${ws}`;
const SORT_LABELS = { newest: 'Newest first', name: 'Name', size: 'Size', canvas: 'Canvas order' };
const GROUP_LABELS = { type: 'Type', canvas: 'Canvas groups' };

function readJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
}

function ancestorsOf(boards, id) {
  const out = [];
  let p = boards?.[id]?.parent_board_id;
  let guard = 0;
  while (p && boards[p] && guard++ < 100) { out.push(p); p = boards[p].parent_board_id; }
  return out;
}

// A cluster's own picture, small: its rendered thumbnail, or its cover tint
// and initial before it has one. Neutral at rest; the row's active state (the
// gold bar and fill) says which one you're in.
function ClusterThumb({ board }) {
  if (board?.thumb_key) {
    return (
      <span className="sbf-thumb">
        <R2Image src={board.thumb_key} bust={board.thumb_updated_at || board.thumb_version || undefined} alt="" />
      </span>
    );
  }
  const tint = COVER_TINTS[board?.cover] || COVER_TINTS.neutral;
  const initial = ((board?.name || '?').trim().charAt(0) || '?').toUpperCase();
  return (
    <span className="sbf-thumb is-empty" style={{ '--sbf-tint': tint }} aria-hidden="true">{initial}</span>
  );
}

function SectionHead({ icon, label, count, open, onToggle }) {
  return (
    <div className="sb-eyebrow sbf-section-head" role="button" tabIndex={0} aria-expanded={open}
         onClick={onToggle}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
      <span className={`sbf-section-chev${open ? ' is-open' : ''}`} aria-hidden="true">▸</span>
      {icon && <Icon as={icon} size={11} />}
      <span className="sbf-section-label">{label}</span>
      {count > 0 && <span className="sbf-section-count">{count}</span>}
    </div>
  );
}

export function ClusterSidebar({
  workspaceId,
  boards,                 // this workspace's own clusters, id → board
  allBoards,              // every cluster this person can see, shared ones too
  rootId,
  activeBoardId,          // the cluster on screen, null off the board
  liveBoardId,            // the cluster whose doc is open (its cards are live)
  liveCards,
  width = 300,
  coarse = false,
  listRef,                // App's .sb-list ref (scroll edges)
  boardsSectionProps,     // everything SidebarBoardsSection already took from App
  sharedSection,          // <SidebarSharedBoards/>
  tagsSection,            // <SidebarTags/>
  meterProps,             // { isPaid, cardsUsed, cardLimit, storage }
  onOpenPlan,
  onUpload,               // (files) => void
  onOpenBoard,            // (boardId) => void
  onShowFile,             // (boardId, cardId, { unplaced }) => void
  onOpenShelf,            // (boardId, shelfId) => void — the shelf in the full-page Files view
  onOpenPalette,          // (query) => void
  source = null,          // dev-only fixture data (local/SidebarQaHarness.jsx)
}) {
  // ── Finding ───────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [prefs, setPrefs] = useState(() => {
    const p = readJson(PREFS_KEY, {});
    return { sort: SORTS.includes(p.sort) ? p.sort : 'newest', groupBy: p.groupBy === 'canvas' ? 'canvas' : 'type' };
  });
  const setPref = (k, v) => setPrefs((p) => { const next = { ...p, [k]: v }; writeJson(PREFS_KEY, next); return next; });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useDismissOnOutside(menuRef, menuOpen, () => setMenuOpen(false));

  const boardList = useMemo(
    () => Object.values(boards || {}).filter((b) => b && b.workspace_id === workspaceId && !b.deleted_at),
    [boards, workspaceId],
  );
  const files = useSidebarFiles({
    enabled: true, workspaceId, boards: boardList, allBoards,
    liveBoardId, liveCards, sort: prefs.sort, groupBy: prefs.groupBy, chip, query, source,
  });

  // ── Unfolding ─────────────────────────────────────────────────────────────
  const [expand, dispatch] = useReducer(expandReducer, null,
    () => initialExpandState(readJson(unfoldedKey(workspaceId), [])));
  useEffect(() => {
    dispatch({ type: 'reset', state: initialExpandState(readJson(unfoldedKey(workspaceId), [])) });
  }, [workspaceId]);
  useEffect(() => {
    if (!activeBoardId) return;
    dispatch({ type: 'navigate', activeId: activeBoardId, ancestorIds: ancestorsOf(allBoards, activeBoardId) });
  }, [activeBoardId, allBoards]);
  useEffect(() => { writeJson(unfoldedKey(workspaceId), persistManual(expand)); }, [expand, workspaceId]);

  // A search opens every cluster it touches, and the ones above them.
  const searchVisible = useMemo(() => {
    if (!files.searchClusterIds) return null;
    const out = new Set();
    for (const id of files.searchClusterIds) { out.add(id); for (const a of ancestorsOf(allBoards, id)) out.add(a); }
    return out;
  }, [files.searchClusterIds, allBoards]);
  useEffect(() => {
    if (searchVisible) dispatch({ type: 'search', ids: [...searchVisible] });
    else dispatch({ type: 'clearSearch' });
  }, [searchVisible]);

  const [shelves, setShelves] = useState({});
  const shelfState = useCallback((b, s) => shelves[shelfKey(b, s)] || {}, [shelves]);
  const onToggleShelf = useCallback((b, s, field) => setShelves((m) => toggleShelf(m, shelfKey(b, s), field)), []);

  // Every unfolded cluster loads its shelves (asking twice is free).
  const unfolded = useMemo(
    () => boardList.filter((b) => isExpanded(expand, b.id)).map((b) => b.id),
    [boardList, expand],
  );
  useEffect(() => { for (const id of unfolded) files.ensure(id); }, [unfolded, files.ensure]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quick look ────────────────────────────────────────────────────────────
  // A click opens Quick look, a double-click goes to the file. The click of a
  // double-click arrives first, so Quick look waits a beat and the double-click
  // calls it off: going somewhere never flashes a preview on the way.
  const [ql, setQl] = useState(null);   // { items: listItem[], index }
  const quickTimer = useRef(0);
  useEffect(() => () => clearTimeout(quickTimer.current), []);
  const openQuick = useCallback((item, siblings, e) => {
    const list = (siblings && siblings.length ? siblings : [item])
      .map((it) => toListItem({ ...cardFromItem(it), boardId: it.boardId }, { boards: allBoards, boardId: it.boardId }))
      .filter(Boolean);
    const index = Math.max(0, list.findIndex((l) => l.id === item.cardId));
    if (!list.length) return;
    clearTimeout(quickTimer.current);
    // A keyboard Space/click (detail 0) has no double to wait for.
    if (e && e.detail === 0) { setQl({ items: list, index }); return; }
    quickTimer.current = setTimeout(() => setQl({ items: list, index }), 220);
  }, [allBoards]);
  const openItem = useCallback((item) => {
    clearTimeout(quickTimer.current);
    setQl(null);
    onShowFile?.(item.boardId, item.cardId, { unplaced: item.unplaced });
  }, [onShowFile]);

  // ── The tree's hook-in ────────────────────────────────────────────────────
  const filesView = useMemo(() => ({
    isExpanded: (id) => isExpanded(expand, id),
    toggle: (id) => dispatch({ type: 'toggle', id }),
    hasContents: (id) => files.ownTotalOf(id) > 0 || (id === liveBoardId && (liveCards?.length || 0) > 0),
    isHidden: (id) => {
      if (id === rootId) return false;
      if (searchVisible) return !searchVisible.has(id);
      return chip !== 'all' && files.countOf(id) === 0;
    },
    countOf: (id) => files.countOf(id),
    renderThumb: (board) => <ClusterThumb board={board} />,
    renderContents: (board, depth, hasChildren) => (
      <ClusterShelves
        boardId={board.id} depth={depth} hasChildren={hasChildren}
        contents={files.contentsOf(board.id)}
        width={width} coarse={coarse}
        shelfState={shelfState} onToggleShelf={onToggleShelf}
        onLoadMore={files.loadMore} canLoadMore={files.canLoadMore}
        onItem={(item, siblings, e) => openQuick(item, siblings, e)}
        onItemOpen={openItem}
        onOpenShelf={onOpenShelf}
        isStarred={files.isStarred}
        scrollRef={listRef}
      />
    ),
  }), [expand, files, liveBoardId, liveCards, rootId, searchVisible, chip, width, coarse, shelfState,
    onToggleShelf, openQuick, openItem, onOpenShelf, listRef]);

  // ↑/↓ walk every item the tree shows, clusters and files alike, in the order
  // they appear; the rows keep their own Enter, →/←, F2 and menu keys.
  const onListKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const root = e.currentTarget;
    const here = e.target.closest?.('[role="treeitem"]');
    if (!here || !root.contains(here)) return;
    const all = [...root.querySelectorAll('[role="treeitem"]')].filter((el) => el.offsetParent !== null);
    const i = all.indexOf(here);
    const next = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
  };

  const [starOpen, setStarOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const starCount = files.starred.clusters.length + files.starred.items.length;
  const recentFit = mosaicPerLine(width, { thumb: coarse ? 52 : 40, gap: coarse ? 5 : 4, inset: 16 + 10 + 8 });
  const nameOf = (id) => allBoards?.[id]?.name || 'a cluster';

  return (
    <>
      <div className="sbf-head">
        <div className="sbf-search">
          <Icon as={Search} size={13} />
          <input type="search" value={query}
                 placeholder="Find in your files"
                 aria-label="Find in your files and clusters"
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Escape') { e.preventDefault(); setQuery(''); return; }
                   if (e.key === 'Enter') {
                     const nothing = !files.searchLoading && !(files.searchClusterIds?.size);
                     if (nothing || e.metaKey || e.ctrlKey) { e.preventDefault(); onOpenPalette?.(query); }
                   }
                 }} />
          {query
            ? <button type="button" className="sbf-search-clear" aria-label="Clear" onClick={() => setQuery('')}><Icon as={X} size={12} /></button>
            : <button type="button" className="sbf-search-kbd" title="Search everything (⌘K)" onClick={() => onOpenPalette?.('')}>⌘K</button>}
        </div>
        <div className="sbf-tools">
          <div className="sbf-chips" role="toolbar" aria-label="Show">
            {FILTER_CHIPS.map((c) => (
              <button type="button" key={c.id}
                      className={`sbf-chip${chip === c.id ? ' is-on' : ''}`}
                      aria-pressed={chip === c.id}
                      onClick={() => setChip(c.id === chip ? 'all' : c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="sbf-sort" ref={menuRef}>
            <button type="button" className={`sbf-sort-btn${menuOpen ? ' is-on' : ''}`}
                    aria-haspopup="menu" aria-expanded={menuOpen}
                    title={`Sorted by ${SORT_LABELS[prefs.sort].toLowerCase()} · grouped by ${GROUP_LABELS[prefs.groupBy].toLowerCase()}`}
                    onClick={() => setMenuOpen((o) => !o)}>⇅</button>
            {menuOpen && (
              <div className="sbf-menu" role="menu">
                <div className="sbf-menu-label">Sort</div>
                {SORTS.map((s) => (
                  <button type="button" key={s} role="menuitemradio" aria-checked={prefs.sort === s}
                          className={`sbf-menu-item${prefs.sort === s ? ' is-on' : ''}`}
                          onClick={() => { setPref('sort', s); setMenuOpen(false); }}>
                    {SORT_LABELS[s]}
                  </button>
                ))}
                <div className="sbf-menu-label">Group by</div>
                {Object.keys(GROUP_LABELS).map((g) => (
                  <button type="button" key={g} role="menuitemradio" aria-checked={prefs.groupBy === g}
                          className={`sbf-menu-item${prefs.groupBy === g ? ' is-on' : ''}`}
                          onClick={() => { setPref('groupBy', g); setMenuOpen(false); }}>
                    {GROUP_LABELS[g]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sb-list sbf-list" ref={listRef} onKeyDown={onListKeyDown}>
        {!files.searching && starCount > 0 && (
          <div className="sbf-section">
            <SectionHead icon={Star} label="Starred" count={starCount} open={starOpen} onToggle={() => setStarOpen((v) => !v)} />
            {starOpen && (
              <div role="group">
                {files.starred.clusters.map((c) => (
                  <div key={`c:${c.boardId}`} className={`sb-row sbf-star-cluster${c.boardId === activeBoardId ? ' active' : ''}`}
                       role="treeitem" tabIndex={0} aria-level={1}
                       onClick={() => onOpenBoard?.(c.boardId)}
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpenBoard?.(c.boardId); } }}>
                    <ClusterThumb board={allBoards?.[c.boardId]} />
                    <span className="sb-row-label">{c.name}</span>
                  </div>
                ))}
                {files.starred.items.map((item) => (
                  <SidebarItemRow key={item.key} item={item} starred
                                  where={nameOf(item.boardId)}
                                  onClick={(it, e) => openQuick(it, files.starred.items, e)} onOpen={openItem} />
                ))}
              </div>
            )}
          </div>
        )}

        {!files.searching && files.recent.length > 0 && (
          <div className="sbf-section">
            <SectionHead icon={Clock} label="Recent" open={recentOpen} onToggle={() => setRecentOpen((v) => !v)} />
            {recentOpen && (
              // One strip of tiles, not a row each: Recent is a glance at what
              // just arrived, and the clusters below are the point.
              <div className="sbf-mosaic sbf-recent" role="group" style={{ paddingLeft: 10 }}>
                {files.recent.slice(0, recentFit).map((item) => (
                  <SidebarTile key={item.key} item={item}
                               starred={files.isStarred(item.boardId, item.cardId)}
                               where={nameOf(item.boardId)}
                               onClick={(it, e) => openQuick(it, files.recent, e)} onOpen={openItem} />
                ))}
              </div>
            )}
          </div>
        )}

        <SidebarBoardsSection {...boardsSectionProps} filesView={filesView} />

        {sharedSection}
        {tagsSection}
      </div>

      <SidebarMeter {...meterProps} onOpenPlan={onOpenPlan} onUpload={onUpload} />

      {ql && (
        <Suspense fallback={null}>
          <QuickLook
            items={ql.items} index={ql.index}
            onIndex={(i) => setQl((q) => (q ? { ...q, index: i } : q))}
            onClose={() => setQl(null)}
            onShowOnBoard={(it) => { setQl(null); onShowFile?.(it.boardId, it.id, { unplaced: !!it.unplaced }); }}
            onDownload={(it) => downloadCardAsset(it.card, it.kind, { surface: 'sidebar' })}
            boards={allBoards}
          />
        </Suspense>
      )}
    </>
  );
}
