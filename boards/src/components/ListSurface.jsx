import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { BoardCard, BoardLinkCard } from './cards.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, BOARD_REF_LIST_MIME, readBoardRefIds, inboxItemToCard } from '../lib/dragMimes.js';
import { wouldCreateCycle, collectDescendantIds } from '../lib/boardTree.js';
import { useFeedback } from './AppFeedback.jsx';
import { toListItem, sortItems, filterItems, matchItems } from '../lib/listItem.js';
import { searchEntities } from '../lib/entitySearch.js';
import { getMeta, primeImageMetaForBoard } from '../lib/imageMeta.js';
import { usePeerSelections } from '../hooks/usePeerSelections.js';
import { ClusterBrowserToolbar } from './clusterBrowser/ClusterBrowserToolbar.jsx';
import { ClusterTable } from './clusterBrowser/ClusterTable.jsx';
import { ClusterGallery } from './clusterBrowser/ClusterGallery.jsx';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

// Persist the browser's view/sort/filter per session (survives navigation).
const BROWSER_PREFS_KEY = 'soleil.cluster.browser.prefs';
function readBrowserPrefs() {
  try { return JSON.parse(sessionStorage.getItem(BROWSER_PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function writeBrowserPrefs(patch) {
  try {
    const cur = readBrowserPrefs();
    sessionStorage.setItem(BROWSER_PREFS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (_) {}
}

// Bucket labels for the filter menu (order = display order).
const BUCKET_LABELS = {
  image: 'Images', pdf: 'PDFs', video: 'Video', audio: 'Audio', file: 'Files',
  note: 'Notes', link: 'Links', doc: 'Docs', palette: 'Palettes', other: 'Other',
};
const BUCKET_ORDER = ['image', 'pdf', 'video', 'audio', 'file', 'note', 'link', 'doc', 'palette', 'other'];

export function ListSurface({
  board, boards, boardsReady = true, cards, childBoards,
  onOpenBoard, onOpenPicker, onDropInboxItem,
  canEdit = true,
  mutators = {},
  peersHereByBoard, peersBelowByBoard,
  // For nested list-mode previews — let inner BoardCards render
  // clickable peer dots in their preview rows.
  onJumpToPeer,
  // Drop / picked OS files → auto-arranged on the canvas (list has no viewport).
  onDropFilesToCluster,
  // Set of card ids just added via a list drop — flashes those rows.
  recentlyAddedIds,
  // Live presence: awareness handle + identity for per-row highlight.
  getAwareness, workspaceId, selfId,
  // Shared grid layouts (id → { layout }) so a linked Grid's preview resolves.
  gridTemplates = {},
}) {
  const feedback = useFeedback();
  const subBoards = childBoards || [];
  const linkedCards = (cards || []).filter(c => c.kind === 'boardlink');
  const otherCards = (cards || []).filter(c => c.kind !== 'board' && c.kind !== 'boardlink');

  // ── Cluster browser state (persisted per session) ──────────────────────────
  const prefs0 = readBrowserPrefs();
  const [viewMode, setViewMode] = useState(prefs0.viewMode === 'gallery' ? 'gallery' : 'table');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(prefs0.sortKey || 'updated');
  const [sortDir, setSortDir] = useState(prefs0.sortDir || 'desc');
  const [filters, setFilters] = useState(() => new Set());
  const addInputRef = useRef(null);

  // Prime image/media metadata once per cluster so thumbnails paint instantly
  // and media Size can resolve.
  useEffect(() => { if (board?.id) primeImageMetaForBoard(board.id); }, [board?.id]);

  // Normalize the non-folder cards into uniform ListItems. Depends on the raw
  // card fields + primed meta (getMeta is a stable module accessor).
  const items = useMemo(
    () => otherCards.map(c => toListItem(c, { boards, getMeta, boardId: board.id, gridTemplates })).filter(Boolean),
    [otherCards, boards, board.id, gridTemplates]
  );

  // Available filter buckets (with counts) present in this cluster.
  const availableBuckets = useMemo(() => {
    const counts = new Map();
    for (const it of items) counts.set(it.typeBucket, (counts.get(it.typeBucket) || 0) + 1);
    return BUCKET_ORDER.filter(k => counts.has(k)).map(k => ({ key: k, label: BUCKET_LABELS[k] || k, count: counts.get(k) }));
  }, [items]);

  // Search → filter → sort pipeline (all pure).
  const visibleItems = useMemo(
    () => sortItems(filterItems(matchItems(items, query), filters), sortKey, sortDir),
    [items, query, filters, sortKey, sortDir]
  );

  // Live per-row presence (which cards peers currently have open), scoped to
  // this cluster + descendants.
  const descendantIds = useMemo(() => collectDescendantIds(boards, board.id), [boards, board.id]);
  const peerMap = usePeerSelections({ getAwareness, boardId: board.id, descendantIds, selfId });
  const facePeers = peersHereByBoard?.get?.(board.id) || [];

  const onSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => { const nd = d === 'asc' ? 'desc' : 'asc'; writeBrowserPrefs({ sortDir: nd }); return nd; });
        return prev;
      }
      // New key: sensible default direction — name/type asc, size/date desc.
      const nd = (key === 'name' || key === 'type') ? 'asc' : 'desc';
      setSortDir(nd);
      writeBrowserPrefs({ sortKey: key, sortDir: nd });
      return key;
    });
  }, []);
  const onViewMode = useCallback((m) => { setViewMode(m); writeBrowserPrefs({ viewMode: m }); }, []);
  const onToggleFilter = useCallback((bucket) => {
    setFilters(prev => { const next = new Set(prev); if (next.has(bucket)) next.delete(bucket); else next.add(bucket); return next; });
  }, []);
  const onClearFilters = useCallback(() => setFilters(new Set()), []);
  const openAddPicker = useCallback(() => addInputRef.current?.click(), []);

  // Descendant search: when the user types a query, also surface matches from
  // sub-clusters (server-side entity_search, filtered to this subtree). These
  // aren't loaded cards, so they render as compact links that open the owning
  // sub-cluster rather than as full preview rows. Debounced; in-cluster search
  // stays instant + local above.
  const [descHits, setDescHits] = useState([]);
  useEffect(() => {
    const q = query.trim();
    if (!q || !workspaceId || descendantIds.length === 0) { setDescHits([]); return; }
    const descSet = new Set(descendantIds);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await searchEntities({ workspaceId, query: q, limit: 40 });
        if (cancelled) return;
        const hits = (rows || [])
          .filter(r => r.board_id && descSet.has(r.board_id) && r.card_id)
          .slice(0, 12)
          .map(r => ({ id: r.card_id || r.id, name: r.title || 'Untitled', kind: r.kind, boardId: r.board_id, clusterName: boards[r.board_id]?.name || 'Sub-cluster' }));
        setDescHits(hits);
      } catch (_) { if (!cancelled) setDescHits([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, workspaceId, descendantIds.join(','), boards]);

  // Selection — strings: board ids and card ids share an id namespace.
  const [selectedBoards, setSelectedBoards] = useState(() => new Set());
  const [selectedCards, setSelectedCards] = useState(() => new Set());

  // Reset selection on board switch.
  useEffect(() => {
    setSelectedBoards(new Set());
    setSelectedCards(new Set());
  }, [board.id]);

  const toggle = useCallback((set, setSet, id, multi) => {
    setSet(prev => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      // single-select: clear OTHER selection set too
      return new Set([id]);
    });
  }, []);

  const onTileClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    e.stopPropagation();
    const multi = e.metaKey || e.ctrlKey || e.shiftKey;
    if (kind === 'board') {
      if (multi) toggle(selectedBoards, setSelectedBoards, id, true);
      else { setSelectedBoards(new Set([id])); setSelectedCards(new Set()); }
    } else {
      if (multi) toggle(selectedCards, setSelectedCards, id, true);
      else { setSelectedCards(new Set([id])); setSelectedBoards(new Set()); }
    }
  };

  const onTileDoubleClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    if (kind === 'board') onOpenBoard(id);
    else if (kind === 'boardlink') {
      const c = (cards || []).find(c => c.id === id);
      if (c && boards[c.target]) onOpenBoard(c.target);
    }
  };

  // Delete selected via Backspace/Delete.
  useEffect(() => {
    const onKey = async (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const total = selectedBoards.size + selectedCards.size;
      if (total === 0) return;
      e.preventDefault();
      const bIds = [...selectedBoards];
      const cIds = [...selectedCards];
      // Build human prompt
      const bn = bIds.length;
      const cn = cIds.length;
      let msg;
      if (bn > 0 && cn === 0) msg = bn === 1
        ? `Delete board "${boards[bIds[0]]?.name || ''}" and all its content?\n\nYou can undo this — it's recoverable for 30 days.`
        : `Delete ${bn} boards and all their content?\n\nYou can undo this — they're recoverable for 30 days.`;
      else if (bn === 0 && cn > 0) msg = cn === 1 ? 'Delete this card?' : `Delete ${cn} cards?`;
      else msg = `Delete ${total} items, including ${bn} board${bn > 1 ? 's' : ''}?\n\nYou can undo this — anything deleted is recoverable for 30 days.`;
      if (msg) {
        const ok = await feedback.confirm({
          title: 'Delete selection',
          message: msg,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
      }
      if (bIds.length) mutators.deleteBoardsById?.(bIds);
      if (cIds.length) mutators.deleteCards?.(cIds);
      setSelectedBoards(new Set());
      setSelectedCards(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback, selectedBoards, selectedCards, boards, mutators]);

  const [dragOver, setDragOver] = useState(false);
  // Board tile currently highlighted as a reparent drop target.
  const [dropTileId, setDropTileId] = useState(null);
  // Recognize any drag we either handle or want to swallow so it can never
  // navigate the browser away from the board (the old handler only matched
  // INBOX_MIME, so files/urls/text/boards dropped here navigated the page).
  const isRecognizedDrag = (t) =>
    t.includes(INBOX_MIME) || t.includes(BOARD_REF_MIME) || t.includes(BOARD_REF_LIST_MIME) ||
    t.includes('Files') || t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html');
  const handleDragOver = (e) => {
    if (!isRecognizedDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    if (!canEdit) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = (e) => {
    setDragOver(false);
    const t = e.dataTransfer.types;
    if (!isRecognizedDrag(t)) return;
    e.preventDefault(); // swallow so the browser never navigates
    if (!canEdit) {
      feedback?.toast?.({ type: 'info', message: 'This cluster is view-only — drops are disabled.' });
      return;
    }
    // Board(s) dropped here → nest under this board (reparent). See the
    // shared soleil-board-reparent-drop handler in App.jsx.
    const boardIds = readBoardRefIds(e.dataTransfer);
    if (boardIds.length) {
      document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
        detail: { childIds: boardIds, targetId: board.id, sourceSurface: 'list' },
      }));
      return;
    }
    // Chat attachment → card (existing behavior).
    const raw = e.dataTransfer.getData(INBOX_MIME);
    if (raw) {
      let item;
      try { item = JSON.parse(raw); } catch (_) { return; }
      const card = inboxItemToCard(item, 0, 0);
      if (!card) return;
      onDropInboxItem && onDropInboxItem(item.id, card);
      return;
    }
    // OS files (or a picked FileList) → route through the cluster's file-ingest
    // mutator. List view has no viewport, so it auto-arranges the batch into a
    // tidy grid in free canvas space (see App.ingestFilesArranged); switching to
    // canvas shows them laid out. No longer refused.
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      onDropFilesToCluster?.(e.dataTransfer.files, { boardId: board.id });
      return;
    }
    // URLs / plain text still have no home in list view — nudge to canvas.
    feedback?.toast?.({ type: 'info', message: 'Switch to canvas view to drop links or text onto a cluster.' });
  };

  const totalSel = selectedBoards.size + selectedCards.size;
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className={`list-wrap ${dragOver ? 'is-drop-target' : ''}`}
         onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
         onClick={() => { setSelectedBoards(new Set()); setSelectedCards(new Set()); }}>
      <div className="list-inner" onClick={(e) => e.stopPropagation()}>
        {totalSel > 0 && (
          <div className="list-selbar">
            <span>{totalSel} selected</span>
            <span className="list-selbar-hint">⌫ to delete · {cmdKey}-click to multi-select</span>
          </div>
        )}

        {subBoards.length === 0 && linkedCards.length === 0 && otherCards.length === 0 && (
          <div className="list-empty">
            <div className="list-empty-title">Empty cluster</div>
            <div className="list-empty-sub">Add a sub-cluster, or link to one elsewhere.</div>
            <button className="tb-btn" onClick={onOpenPicker}>Link a cluster</button>
          </div>
        )}
        {subBoards.length > 0 && (
          <>
            <div className="list-section">Clusters</div>
            <div className="list-grid">
              {subBoards.map(b => (
                <div key={b.id}
                     className={`list-tile ${selectedBoards.has(b.id) ? 'is-selected' : ''} ${dropTileId === b.id ? 'is-drop-target' : ''}`}
                     draggable={canEdit}
                     onClick={(e) => onTileClick(e, 'board', b.id)}
                     onDoubleClick={(e) => onTileDoubleClick(e, 'board', b.id)}
                     onDragStart={(e) => {
                       const ids = (selectedBoards.size > 1 && selectedBoards.has(b.id)) ? [...selectedBoards] : [b.id];
                       try { window.__soleilBoardDrag = { boardIds: ids }; } catch (_) {}
                       try {
                         e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: b.id, name: b.name }));
                         if (ids.length > 1) e.dataTransfer.setData(BOARD_REF_LIST_MIME, JSON.stringify(ids));
                         e.dataTransfer.effectAllowed = 'copyMove';
                       } catch (_) {}
                     }}
                     onDragEnd={() => { try { window.__soleilBoardDrag = null; } catch (_) {} setDropTileId(null); }}
                     onDragOver={(e) => {
                       const t = e.dataTransfer.types;
                       if (!t.includes(BOARD_REF_MIME) && !t.includes(BOARD_REF_LIST_MIME)) return;
                       const ids = (typeof window !== 'undefined' && window.__soleilBoardDrag?.boardIds) || [];
                       const invalid = ids.length > 0 && (ids.includes(b.id) || ids.some(id => wouldCreateCycle(boards, id, b.id)));
                       if (invalid) { try { e.dataTransfer.dropEffect = 'none'; } catch (_) {} return; }
                       e.preventDefault();
                       e.stopPropagation();
                       try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
                       if (dropTileId !== b.id) setDropTileId(b.id);
                     }}
                     onDragLeave={(e) => { if (e.currentTarget.contains?.(e.relatedTarget)) return; setDropTileId(prev => (prev === b.id ? null : prev)); }}
                     onDrop={(e) => {
                       setDropTileId(null);
                       const childIds = readBoardRefIds(e.dataTransfer);
                       if (!childIds.length) return;
                       e.preventDefault();
                       e.stopPropagation();
                       document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
                         detail: { childIds, targetId: b.id, sourceSurface: 'list' },
                       }));
                     }}>
                  <BoardCard board={b} boards={boards} teammates={TEAMMATES}
                             peersHere={peersHereByBoard?.get?.(b.id) || []}
                             peersBelow={peersBelowByBoard?.get?.(b.id) || []}
                             peersHereByBoard={peersHereByBoard}
                             peersBelowByBoard={peersBelowByBoard}
                             onJumpToPeer={onJumpToPeer}
                             onRename={(name) => mutators.renameBoardById?.(b.id, name)} />
                </div>
              ))}
            </div>
          </>
        )}
        {linkedCards.length > 0 && (
          <>
            <div className="list-section">Linked</div>
            <div className="list-grid">
              {linkedCards.map(c => {
                const t = boards[c.target];
                return (
                  <div key={c.id}
                       className={`list-tile ${selectedCards.has(c.id) ? 'is-selected' : ''}`}
                       onClick={(e) => onTileClick(e, 'boardlink', c.id)}
                       onDoubleClick={(e) => onTileDoubleClick(e, 'boardlink', c.id)}>
                    {(!t && !boardsReady)
                      ? <div className="blc blc-loading" aria-hidden="true" />
                      : <BoardLinkCard targetBoard={t} note={c.note} onOpen={() => {}} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {otherCards.length > 0 && (
          <div className="cluster-browser">
            <div className="list-section list-section-files">Files</div>
            <ClusterBrowserToolbar
              query={query} onQueryChange={setQuery}
              sortKey={sortKey} sortDir={sortDir} onSort={onSort}
              filters={filters} availableBuckets={availableBuckets}
              onToggleFilter={onToggleFilter} onClearFilters={onClearFilters}
              viewMode={viewMode} onViewMode={onViewMode}
              onAddFiles={openAddPicker} canEdit={canEdit}
              facePeers={facePeers}
            />
            {visibleItems.length === 0 && descHits.length === 0 ? (
              <div className="cluster-browser-empty">
                {query || filters.size ? 'No files match your search.' : 'No files yet.'}
              </div>
            ) : visibleItems.length === 0 ? null : viewMode === 'gallery' ? (
              <ClusterGallery
                items={visibleItems} selectedCards={selectedCards} peerMap={peerMap}
                recentlyAddedIds={recentlyAddedIds}
                onRowClick={(e, id) => onTileClick(e, 'file', id)}
                onRowDoubleClick={(e, id) => onTileDoubleClick(e, 'file', id)} />
            ) : (
              <ClusterTable
                items={visibleItems} selectedCards={selectedCards} peerMap={peerMap}
                sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                recentlyAddedIds={recentlyAddedIds}
                onRowClick={(e, id) => onTileClick(e, 'file', id)}
                onRowDoubleClick={(e, id) => onTileDoubleClick(e, 'file', id)} />
            )}
            {descHits.length > 0 && (
              <div className="cb-descendants">
                <div className="cb-desc-label">In sub-clusters</div>
                {descHits.map(h => (
                  <button key={`${h.boardId}:${h.id}`} className="cb-desc-row" onClick={() => onOpenBoard(h.boardId)}>
                    <span className="cb-desc-name">{h.name}</span>
                    <span className="cb-desc-cluster">{h.clusterName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Hidden picker for the toolbar "Add files" button (touch-friendly). */}
        <input ref={addInputRef} type="file" multiple style={{ display: 'none' }}
               onChange={(e) => {
                 if (e.target.files && e.target.files.length) onDropFilesToCluster?.(e.target.files, { boardId: board.id });
                 e.target.value = '';
               }} />
      </div>
    </div>
  );
}
