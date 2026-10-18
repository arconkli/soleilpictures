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
import { createPortal } from 'react-dom';
import { CardContextMenu } from '../CardContextMenu.jsx';
import { composeMenuSections, SECTION } from '../../lib/contextMenuSections.js';
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
import { downloadCardAsset, downloadCardAssets } from '../../lib/cardDownload.js';
import { FILES_DRAG_MIME, buildFilesPayload, parseFilesPayload } from '../../lib/filesDrag.js';
import { moveFiles, appendCards, removeCards, failureMessage } from '../../lib/clustersApi.js';
import { undoToast } from '../../lib/undoToast.js';
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

// The cluster picker (App's requestClusterPick) resolves with the board.
const pickedId = (picked) => (typeof picked === 'string' ? picked : picked?.id) || null;

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
  liveGroupNames = null,  // Map groupId → name, the open cluster's canvas groups
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
  feedback = null,        // the app's toasts (useFeedback)
  onPickCluster = null,   // ({ placeholder, excludeIds }) => Promise<boardId|null>
  onSetOpensAs = null,    // (boardId, 'list' | 'canvas') => void — the cluster's view, for everyone
  onDropFilesOnCluster = null,  // (boardId, File[]) => void — desktop files dropped on a row
  uploadsByBoard = null,  // { boardId: n } — files still going up into a cluster
  liveMutators = null,    // the open cluster's mutators (deleteCards, undo, undoManager)
  moveApi = null,         // { moveFiles, appendCards, removeCards } — the QA harness's fakes
  refreshToken = 0,       // bumped by App after it moves files itself (a canvas drop)
  source = null,          // dev-only fixture data (local/SidebarQaHarness.jsx)
}) {
  const api = moveApi || { moveFiles, appendCards, removeCards };
  const toast = (t) => feedback?.toast?.(t);
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
    liveBoardId, liveCards, liveGroupNames, sort: prefs.sort, groupBy: prefs.groupBy, chip, query, source,
  });

  useEffect(() => { if (refreshToken) files.refresh(); }, [refreshToken]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unfolding ─────────────────────────────────────────────────────────────
  // Nothing saved yet (a first visit) starts with the workspace's root open,
  // as the old tree did: folded, it shows one row and none of the clusters.
  const savedUnfolded = () => readJson(unfoldedKey(workspaceId), null) ?? (rootId ? [rootId] : []);
  const [expand, dispatch] = useReducer(expandReducer, null, () => initialExpandState(savedUnfolded()));
  useEffect(() => {
    dispatch({ type: 'reset', state: initialExpandState(savedUnfolded()) });
  }, [workspaceId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Keyed on the path, not on the boards map: that map is rebuilt on every
  // realtime change to any cluster (a thumbnail, a rename), and navigating
  // again would undo a fold the person just made.
  const activePath = activeBoardId ? [...ancestorsOf(allBoards, activeBoardId)].reverse().concat(activeBoardId).join('/') : '';
  useEffect(() => {
    if (!activeBoardId) return;
    dispatch({ type: 'navigate', activeId: activeBoardId, ancestorIds: ancestorsOf(allBoards, activeBoardId) });
  }, [activePath]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  // A click on a file just before going somewhere else must not open Quick
  // look over wherever you went.
  useEffect(() => { clearTimeout(quickTimer.current); }, [activeBoardId]);
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

  // ── Selection: ⌘/Ctrl-click adds one, ⇧-click a run along the shelf ──────
  const [selected, setSelected] = useState(() => new Map());   // key → item
  const anchorRef = useRef(null);
  const clearSelection = useCallback(() => { setSelected(new Map()); anchorRef.current = null; }, []);
  useEffect(() => { clearSelection(); }, [workspaceId, clearSelection]);
  const isSelected = useCallback((item) => selected.has(item.key), [selected]);
  const onItem = useCallback((item, siblings, e) => {
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelected((m) => { const n = new Map(m); if (n.has(item.key)) n.delete(item.key); else n.set(item.key, item); return n; });
      anchorRef.current = item;
      return;
    }
    if (e && e.shiftKey && anchorRef.current) {
      const list = siblings || [];
      const a = list.findIndex((x) => x.key === anchorRef.current.key);
      const b = list.findIndex((x) => x.key === item.key);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelected((m) => { const n = new Map(m); for (const x of list.slice(lo, hi + 1)) n.set(x.key, x); return n; });
        return;
      }
    }
    clearSelection();
    anchorRef.current = item;
    openQuick(item, siblings, e);
  }, [openQuick, clearSelection]);

  // ── Moving files between clusters ─────────────────────────────────────────
  // Plain drop moves, ⌥ copies (a linked copy: same stored file, one more
  // card). Both go through /api/clusters, so neither cluster has to be open,
  // and both offer Undo.
  const runMove = useCallback(async ({ from, to, cardIds, copy = false }) => {
    if (!from || !to || from === to || !cardIds?.length) return;
    const r = await api.moveFiles({ from, to, cardIds, mode: copy ? 'copy' : 'move' });
    if (!r.ok) {
      // They reached the other cluster but didn't all leave this one. The
      // same move again finishes it without a second copy (the route finds
      // them landed), so that is what the button does.
      if (r.error === 'partial') {
        files.refresh();
        toast({
          type: 'error',
          message: `Moved to ${nameOf(to)}, but they’re still in ${nameOf(from)} too.`,
          action: { label: 'Finish', onClick: () => runMove({ from, to, cardIds }) },
        });
        return;
      }
      toast({ type: 'error', message: failureMessage(r, copy ? 'copy' : 'move') });
      return;
    }
    files.refresh();
    if (!copy) clearSelection();
    const n = copy ? (r.copied || 0) : (r.moved || 0);
    const kept = r.kept?.length || 0;
    const skipped = r.skipped?.length || 0;
    if (!n) {
      toast({
        type: 'info',
        message: kept ? 'Those files are still uploading. Try again when they finish.'
          : skipped ? 'Those can’t be copied, only moved.'
            : 'Those files aren’t there any more.',
      });
      return;
    }
    const what = n === 1 ? '1 file' : `${n} files`;
    const extra = `${kept ? ` · ${kept} still uploading stayed put` : ''}${skipped ? ` · ${skipped} can’t be copied` : ''}`;
    undoToast(feedback, {
      message: `${copy ? 'Copied' : 'Moved'} ${what} to ${nameOf(to)}${extra}`,
      onUndo: async () => {
        const u = copy
          ? await api.removeCards({ boardId: to, cardIds: (r.cards || []).map((c) => c.id) })
          : await api.moveFiles({
            from: to, to: from, mode: 'move',
            cardIds: (r.pairs || []).map((p) => p.to),
            restore: (r.originals || []).map((o) => ({ ...o, id: (r.pairs || []).find((p) => p.from === o.id)?.to || o.id })),
          });
        if (!u.ok) toast({ type: 'error', message: failureMessage(u, 'move') });
        files.refresh();
      },
    });
  }, [api, files, feedback, clearSelection]);   // eslint-disable-line react-hooks/exhaustive-deps

  const groupByCluster = (items) => {
    const out = new Map();
    for (const it of items) { if (!out.has(it.boardId)) out.set(it.boardId, []); out.get(it.boardId).push(it); }
    return out;
  };

  const onDragItem = useCallback((item, e) => {
    const group = selected.has(item.key)
      ? [...selected.values()].filter((x) => x.boardId === item.boardId)
      : [item];
    const payload = buildFilesPayload({
      sourceBoardId: item.boardId, sourceName: nameOf(item.boardId),
      cards: group.map((x) => cardFromItem(x)), intent: 'move',
    });
    if (!payload) { e.preventDefault(); return; }
    try {
      e.dataTransfer.setData(FILES_DRAG_MIME, payload);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch (_) { /* a drag the browser won't carry */ }
  }, [selected]);   // eslint-disable-line react-hooks/exhaustive-deps

  const dropEffect = useCallback((e, boardId) => {
    const t = e.dataTransfer?.types || [];
    if (t.includes(FILES_DRAG_MIME)) return e.altKey ? 'copy' : 'move';
    if (t.includes('Files') && onDropFilesOnCluster) return 'copy';
    return null;
  }, [onDropFilesOnCluster]);
  const onDropOnCluster = useCallback((boardId, e) => {
    const t = e.dataTransfer?.types || [];
    if (t.includes(FILES_DRAG_MIME)) {
      const payload = parseFilesPayload(e.dataTransfer.getData(FILES_DRAG_MIME));
      if (payload && payload.sourceBoardId !== boardId) {
        runMove({ from: payload.sourceBoardId, to: boardId, cardIds: payload.cards.map((c) => c.id), copy: e.altKey });
      }
      return;
    }
    const dropped = [...(e.dataTransfer?.files || [])];
    if (dropped.length) onDropFilesOnCluster?.(boardId, dropped);
  }, [runMove, onDropFilesOnCluster]);

  // ── The bar under a selection ─────────────────────────────────────────────
  const selItems = useMemo(() => [...selected.values()], [selected]);
  const moveSelection = async () => {
    const to = pickedId(await onPickCluster?.({ placeholder: 'Move to…' }));
    if (!to) return;
    for (const [from, items] of groupByCluster(selItems)) {
      if (from !== to) await runMove({ from, to, cardIds: items.map((x) => x.cardId) });
    }
    clearSelection();
  };
  const downloadSelection = () => {
    const cards = selItems.map((x) => cardFromItem(x));
    if (cards.length === 1) downloadCardAsset(cards[0], cards[0].kind, { surface: 'sidebar' });
    else downloadCardAssets(cards, { zipName: 'files.zip', surface: 'sidebar' });
  };
  const deleteSelection = () => deleteItems(selItems);
  const deleteItems = async (list) => {
    for (const [boardId, items] of groupByCluster(list)) {
      const ids = items.map((x) => x.cardId);
      const what = ids.length === 1 ? '1 file' : `${ids.length} files`;
      if (boardId === liveBoardId && liveMutators?.deleteCards) {
        const deleted = await liveMutators.deleteCards(ids);
        if (deleted !== null) undoToast(feedback, {
          message: `Deleted ${what}`,
          undoManager: liveMutators.undoManager, stackItem: deleted?.stackItem || null,
          onUndo: () => liveMutators.undo?.(),
        });
        continue;
      }
      const r = await api.removeCards({ boardId, cardIds: ids });
      if (!r.ok) { toast({ type: 'error', message: failureMessage(r, 'remove') }); continue; }
      // Say what the cluster actually let go of: a selection can outlive its
      // files (someone else deleted them meanwhile).
      const gone = r.removed?.length || 0;
      if (!gone) { toast({ type: 'info', message: 'Those files aren’t there any more.' }); continue; }
      const said = gone === 1 ? '1 file' : `${gone} files`;
      undoToast(feedback, {
        message: `Deleted ${said} from ${nameOf(boardId)}`,
        onUndo: async () => {
          const u = await api.appendCards({ boardId, cards: r.removed || [] });
          if (!u.ok) toast({ type: 'error', message: failureMessage(u, 'move') });
          files.refresh();
        },
      });
    }
    clearSelection();
    files.refresh();
  };

  // ── A file's menu (right-click, Shift+F10, the Menu key) ───────────────────
  // On a file that is part of a selection it acts on the whole selection.
  const [fileMenu, setFileMenu] = useState(null);   // { x, y, item, siblings }
  const onItemMenu = useCallback((item, siblings, x, y) => setFileMenu({ item, siblings, x, y }), []);
  const fileMenuItems = () => {
    const m = fileMenu;
    if (!m) return [];
    const group = selected.has(m.item.key) ? selItems : [m.item];
    const many = group.length > 1;
    const starredNow = files.isStarred(m.item.boardId, m.item.cardId);
    return composeMenuSections([
      { items: [
        { id: 'quick', label: 'Quick look', run: () => openQuick(m.item, m.siblings, { detail: 0 }) },
        { id: 'show', label: m.item.unplaced ? 'Show in Files' : 'Show on board', run: () => openItem(m.item) },
        { id: 'star', label: starredNow ? 'Unstar' : 'Star', run: () => files.toggleStar(m.item.boardId, m.item.cardId) },
      ] },
      { header: SECTION.EDIT, items: [
        { id: 'download', label: many ? `Download ${group.length}` : 'Download', run: () => {
          const cards = group.map((x) => cardFromItem(x));
          if (cards.length === 1) downloadCardAsset(cards[0], cards[0].kind, { surface: 'sidebar' });
          else downloadCardAssets(cards, { zipName: 'files.zip', surface: 'sidebar' });
        } },
        ...(onPickCluster ? [{ id: 'move', label: many ? `Move ${group.length} to…` : 'Move to…', run: async () => {
          const to = pickedId(await onPickCluster({ placeholder: 'Move to…' }));
          if (!to) return;
          for (const [from, items] of groupByCluster(group)) {
            if (from !== to) await runMove({ from, to, cardIds: items.map((x) => x.cardId) });
          }
          clearSelection();
        } }] : []),
        { id: 'delete', label: many ? `Delete ${group.length}` : 'Delete', danger: true, run: () => { deleteItems(group); clearSelection(); } },
      ] },
    ]);
  };

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
    statusOf: (id) => {
      const n = uploadsByBoard?.[id] || 0;
      return n > 0 ? `↑ ${n}` : null;
    },
    dropEffect,
    onDrop: onDropOnCluster,
    menuItems: (board, canEdit) => [
      { id: 'star', label: files.isStarred(board.id) ? 'Unstar' : 'Star', run: () => files.toggleStar(board.id) },
      ...(canEdit && onSetOpensAs ? [{
        id: 'opens-as',
        label: board.view === 'list' ? 'Open on the board by default' : 'Always open in Files',
        run: () => onSetOpensAs(board.id, board.view === 'list' ? 'canvas' : 'list'),
      }] : []),
    ],
    renderThumb: (board) => <ClusterThumb board={board} />,
    renderContents: (board, depth, hasChildren) => (
      <ClusterShelves
        boardId={board.id} depth={depth} hasChildren={hasChildren}
        contents={files.contentsOf(board.id)}
        width={width} coarse={coarse}
        shelfState={shelfState} onToggleShelf={onToggleShelf}
        onLoadMore={files.loadMore} canLoadMore={files.canLoadMore}
        onItem={onItem}
        isSelected={isSelected}
        onDragItem={onDragItem}
        onItemMenu={onItemMenu}
        onItemOpen={openItem}
        onOpenShelf={onOpenShelf}
        isStarred={files.isStarred}
        scrollRef={listRef}
      />
    ),
  }), [expand, files, liveBoardId, liveCards, rootId, searchVisible, chip, width, coarse, shelfState,
    onToggleShelf, onItem, isSelected, onDragItem, onItemMenu, openItem, onOpenShelf, listRef, uploadsByBoard,
    dropEffect, onDropOnCluster]);

  // ↑/↓ walk every item the tree shows, clusters and files alike, in the order
  // they appear; the rows keep their own Enter, →/←, F2 and menu keys.
  const onListKeyDown = (e) => {
    // Typing in a box inside a row (renaming a cluster) is the box's business:
    // an arrow there moves the caret, and moving focus would commit the
    // half-typed name on blur.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (selected.size && e.key === 'Escape') { e.preventDefault(); clearSelection(); return; }
    if (selected.size && (e.key === 'Backspace' || e.key === 'Delete') && e.target.closest?.('[data-sb-item]')) {
      e.preventDefault(); deleteSelection(); return;
    }
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
                                  selected={isSelected(item)} onDragStart={onDragItem}
                                  onMenu={(it, x, y) => onItemMenu(it, files.starred.items, x, y)}
                                  onClick={(it, e) => onItem(it, files.starred.items, e)} onOpen={openItem} />
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
                               selected={isSelected(item)} onDragStart={onDragItem}
                               onMenu={(it, x, y) => onItemMenu(it, files.recent, x, y)}
                               onClick={(it, e) => onItem(it, files.recent, e)} onOpen={openItem} />
                ))}
              </div>
            )}
          </div>
        )}

        <SidebarBoardsSection {...boardsSectionProps} filesView={filesView} />

        {sharedSection}
        {tagsSection}
      </div>

      {selected.size > 0 && (
        <div className="sbf-bulk" role="toolbar" aria-label="Selected files">
          <span className="sbf-bulk-count">{selected.size} selected</span>
          {onPickCluster && <button type="button" className="sbf-bulk-btn" onClick={moveSelection}>Move…</button>}
          <button type="button" className="sbf-bulk-btn" onClick={downloadSelection}>Download</button>
          <button type="button" className="sbf-bulk-btn is-danger" onClick={deleteSelection}>Delete</button>
          <button type="button" className="sbf-bulk-btn" aria-label="Clear selection" onClick={clearSelection}>✕</button>
        </div>
      )}
      <SidebarMeter {...meterProps} onOpenPlan={onOpenPlan} onUpload={onUpload} />

      {createPortal(
        <CardContextMenu open={!!fileMenu} x={fileMenu?.x || 0} y={fileMenu?.y || 0}
                         items={fileMenuItems()} onClose={() => setFileMenu(null)}
                         workspaceId={workspaceId} boardId={fileMenu?.item?.boardId} card={null} />,
        document.body,
      )}
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
