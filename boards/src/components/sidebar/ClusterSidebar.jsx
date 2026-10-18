// The sidebar that holds every file (behind sidebarFilesAllowed until it ships).
//
// Two parts, the way file managers and Apple's guidelines split them: the
// clusters, as a plain tree of names — the folders, prominent and easy to scan
// — and the files of ONE of them, in a section of their own: the cluster
// you're in, or Recent, or Starred. A tree that also holds files gets long and
// unreadable fast (the first two versions of this did exactly that), so the
// tree never does.
//
// Narrow, the files sit under the clusters with a divider to share the height.
// Dragged wider than SIDEBAR_W.SPLIT_AT (or with the expand button) they move
// beside them, a column of their own. The layout itself is CSS
// (clusterSidebar.css): this renders the parts.
//
// The files section reads like the Files page: a header naming the cluster,
// a search scoped to it, chips for each kind of file it holds, its
// sub-clusters as tiles, then photos as a grid and everything else as rows.
// Clicking a file opens Quick look; double-clicking goes to it on its board.
// Files drag onto any cluster in the tree to move there (⌥ copies), and files
// from the desktop drop on a cluster or onto the section itself.

import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardContextMenu } from '../CardContextMenu.jsx';
import { composeMenuSections, SECTION } from '../../lib/contextMenuSections.js';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { COVER_TINTS } from '../primitives.jsx';
import { Search, X, Columns2, ArrowsOutSimple } from '../../lib/icons.js';
import { SidebarBoardsSection } from '../SidebarBoardsSection.jsx';
import { ClusterShelves } from './ClusterShelves.jsx';
import { SidebarMeter } from './SidebarMeter.jsx';
import { useSidebarFiles } from '../../hooks/useSidebarFiles.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { FILTER_CHIPS, SHELF_IDS } from '../../lib/sidebarShelves.js';
import { SORTS, filterItems } from '../../lib/sidebarSort.js';
import { isWideSidebar, toggledSidebarWidth } from '../../lib/sidebarWidth.js';
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
const unfoldedKey = (ws) => `soleil.sidebar.unfolded.${ws}`;
// How tall the clusters part is when the files sit under it (the divider).
const NAV_H_KEY = 'soleil.sidebar.navH';
// The last narrow width, for the expand button's way back.
const NARROW_W_KEY = 'soleil.sidebar.narrowW';
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

// Where to go, in one row of words: Home, Messages and Schedule (App's), then
// Recent and Starred, which show their files in the section below. Words only,
// no icons (the owner's call), with an unread count after the word.
function QuickBtn({ label, active = false, unread = 0, onClick }) {
  return (
    <button type="button" className={`sbf-quickbtn${active ? ' is-on' : ''}`} aria-pressed={active} onClick={onClick}>
      <span className="sbf-quick-label">{label}</span>
      {unread > 0 && <span className="sbf-quick-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

// The kinds of file a list holds, as one line of chips. Whatever doesn't fit
// the line goes behind "More", so a cluster with every kind of file still
// takes one line, not three.
function ChipRow({ chips, counts, chip, setChip }) {
  const rowRef = useRef(null);
  const [hidden, setHidden] = useState([]);
  const [open, setOpen] = useState(false);
  const moreRef = useRef(null);
  useDismissOnOutside(moreRef, open, () => setOpen(false));
  const key = chips.map((c) => c.id).join(',');
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () => {
      const top = row.getBoundingClientRect().top;
      const out = [];
      for (const el of row.querySelectorAll('[data-chip]')) {
        if (el.getBoundingClientRect().top > top + 4) out.push(el.dataset.chip);
      }
      setHidden((h) => (h.join(',') === out.join(',') ? h : out));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [key]);
  const overflow = chips.filter((c) => hidden.includes(c.id));
  const chipButton = (c, extra = {}) => (
    <button type="button" key={c.id} data-chip={c.id}
            className={`sbf-chip${chip === c.id ? ' is-on' : ''}`}
            aria-pressed={chip === c.id}
            onClick={() => { setChip(c.id === chip ? 'all' : c.id); setOpen(false); }}
            {...extra}>
      {c.label}
      {(counts[c.id] || 0) > 0 && <span className="sbf-chip-count">{counts[c.id]}</span>}
    </button>
  );
  return (
    <div className="sbf-chipline">
      <div className="sbf-chips" role="toolbar" aria-label="Show" ref={rowRef}>
        {chips.map((c) => chipButton(c, hidden.includes(c.id) ? { tabIndex: -1, 'aria-hidden': 'true' } : {}))}
      </div>
      {overflow.length > 0 && (
        <div className="sbf-chipmore" ref={moreRef}>
          <button type="button" className={`sbf-chip${overflow.some((c) => c.id === chip) ? ' is-on' : ''}`}
                  aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            More ▾
          </button>
          {open && (
            <div className="sbf-menu" role="menu">
              {overflow.map((c) => (
                <button type="button" key={c.id} role="menuitemradio" aria-checked={chip === c.id}
                        className={`sbf-menu-item${chip === c.id ? ' is-on' : ''}`}
                        onClick={() => { setChip(c.id === chip ? 'all' : c.id); setOpen(false); }}>
                  {c.label}
                  {(counts[c.id] || 0) > 0 && <span className="sbf-chip-count">{counts[c.id]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  width = 320,
  coarse = false,
  onSetWidth = null,      // (px) => void — the expand button's jump between narrow and wide
  quickNav = null,        // { home, messages, schedule }: { active, unread?, onClick } each, from App
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

  const [shelves, setShelves] = useState({});
  const shelfState = useCallback((b, s) => shelves[shelfKey(b, s)] || {}, [shelves]);
  const onToggleShelf = useCallback((b, s, field) => setShelves((m) => toggleShelf(m, shelfKey(b, s), field)), []);

  // ── What the files section shows ──────────────────────────────────────────
  // The cluster you're in — or, off a board, the last one you were in — unless
  // you've asked for Recent or Starred. Going somewhere puts it back on where
  // you are, with a fresh search.
  const [shown, setShown] = useState(null);   // null | 'recent' | 'starred'
  const lastBoard = useRef(activeBoardId || null);
  if (activeBoardId) lastBoard.current = activeBoardId;
  useEffect(() => { setShown(null); setQuery(''); }, [activeBoardId]);
  const shownId = shown ? null : (activeBoardId || lastBoard.current);
  const view = shown || (shownId && allBoards?.[shownId] ? 'cluster' : 'recent');
  useEffect(() => { if (view === 'cluster' && shownId) files.ensure(shownId); }, [view, shownId, files.ensure]);

  // ── Narrow or wide ────────────────────────────────────────────────────────
  const wide = !coarse && isWideSidebar(width);
  useEffect(() => { if (!wide && !coarse) writeJson(NARROW_W_KEY, width); }, [wide, coarse, width]);
  const toggleWide = () => onSetWidth?.(toggledSidebarWidth(width, readJson(NARROW_W_KEY, null)));
  // The divider shares the height between the clusters and the files when
  // they're stacked; dragged, it is remembered, double-clicked, it resets.
  const [navH, setNavH] = useState(() => {
    const v = Number(readJson(NAV_H_KEY, null));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const setNavHeight = (h) => {
    const v = h == null ? null : Math.round(Math.max(96, Math.min(h, (typeof window !== 'undefined' ? window.innerHeight : 900) - 260)));
    setNavH(v);
    writeJson(NAV_H_KEY, v);
  };
  const onDividerDown = (e) => {
    if (e.button !== 0) return;
    const nav = listRef?.current;
    if (!nav) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = nav.getBoundingClientRect().height;
    const move = (ev) => setNavH(Math.round(Math.max(96, startH + ev.clientY - startY)));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('sbf-resizing-v');
      setNavHeight(startH + ev.clientY - startY);
    };
    document.body.classList.add('sbf-resizing-v');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
  // Clusters only: a row's chevron is for its sub-clusters, its count is
  // everything inside it, and it takes files dropped on it.
  const filesView = useMemo(() => ({
    isExpanded: (id) => isExpanded(expand, id),
    toggle: (id) => dispatch({ type: 'toggle', id }),
    hasContents: () => false,
    isHidden: () => false,
    countOf: (id) => files.totalOf(id),
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
  }), [expand, files, uploadsByBoard, dropEffect, onDropOnCluster, onSetOpensAs]);

  // ↑/↓ walk the rows of whichever part has focus (the clusters, or the
  // files), in the order they appear; the rows keep their own Enter, →/←, F2
  // and menu keys.
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
    next.focus({ preventScroll: true });
    next.scrollIntoView?.({ block: 'nearest' });
  };

  const nameOf = (id) => allBoards?.[id]?.name || 'a cluster';

  // ── The files section's subject ───────────────────────────────────────────
  const starCount = files.starred.clusters.length + files.starred.items.length;
  const shownBoard = view === 'cluster' ? allBoards?.[shownId] : null;
  const listItems = view === 'recent' ? files.recent : view === 'starred' ? files.starred.items : null;
  // Recent and Starred are short lists already in hand: filtered here. A
  // cluster is searched on the server (its own hits come back per cluster).
  const contents = view === 'cluster'
    ? files.contentsOf(shownId)
    : files.contentsOfItems(filterItems(listItems || [], { query }));
  // What each chip would show, so a chip with nothing behind it isn't offered.
  const chipCounts = useMemo(() => {
    const out = { all: 0, unplaced: 0 };
    if (view === 'cluster') {
      const own = files.ownCountsOf(shownId);
      for (const id of SHELF_IDS) out[id] = own?.byShelf?.[id] || 0;
      out.all = own?.total || 0;
      out.unplaced = own?.unplaced || 0;
    } else {
      for (const it of listItems || []) {
        out[it.shelf] = (out[it.shelf] || 0) + 1;
        out.all += 1;
        if (it.unplaced) out.unplaced += 1;
      }
    }
    return out;
  }, [view, shownId, files, listItems]);
  const chips = FILTER_CHIPS.filter((c) => c.id === 'all' || chip === c.id || (chipCounts[c.id] || 0) > 0);
  // A cluster's own sub-clusters, as tiles above its files (Starred shows the
  // starred clusters the same way).
  const subs = useMemo(() => {
    if (view === 'starred') return files.starred.clusters.map((c) => ({ id: c.boardId, board: allBoards?.[c.boardId], name: c.name }));
    if (view !== 'cluster') return [];
    return Object.values(allBoards || {})
      .filter((b) => b && b.parent_board_id === shownId && !b.deleted_at)
      .sort((x, y) => (x.name || '').localeCompare(y.name || ''))
      .map((b) => ({ id: b.id, board: b, name: b.name || 'Untitled' }));
  }, [view, shownId, allBoards, files.starred]);
  const showSubs = subs.length > 0 && chip === 'all' && !query.trim();
  const parentName = shownBoard?.parent_board_id ? allBoards?.[shownBoard.parent_board_id]?.name : null;
  const title = view === 'recent' ? 'Recent' : view === 'starred' ? 'Starred' : (shownBoard?.name || 'Untitled');
  const subtitle = view === 'recent'
    ? 'Added lately, across your clusters'
    : view === 'starred'
      ? (starCount ? `${starCount} starred` : 'Nothing starred yet')
      : [
        `${chipCounts.all} ${chipCounts.all === 1 ? 'file' : 'files'}`,
        subs.length ? `${subs.length} ${subs.length === 1 ? 'cluster' : 'clusters'}` : null,
        parentName ? `in ${parentName}` : null,
      ].filter(Boolean).join(' · ');
  const nothing = !contents.loading && !(contents.shelves || []).some((sh) => sh.total > 0 || sh.items?.length);
  const filesListRef = useRef(null);
  // What scrolls the files, for a long list's windowing: their own list, or
  // in the phone drawer (which scrolls as one) the drawer.
  const filesScrollRef = useMemo(() => ({
    get current() {
      const list = filesListRef.current;
      if (!list || typeof getComputedStyle === 'undefined') return list;
      return getComputedStyle(list).overflowY === 'visible' ? (list.closest('.sb-mid') || list) : list;
    },
  }), []);
  // Desktop files dropped anywhere on the section go into the cluster it shows.
  const [dropping, setDropping] = useState(false);
  const sectionDrop = view === 'cluster' && shownId ? {
    onDragOver: (e) => {
      if (!dropEffect(e, shownId)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = dropEffect(e, shownId); } catch (_) { /* read-only in some browsers */ }
      if (!dropping) setDropping(true);
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); },
    onDrop: (e) => {
      setDropping(false);
      if (!dropEffect(e, shownId)) return;
      e.preventDefault();
      onDropOnCluster(shownId, e);
    },
  } : {};

  return (
    <>
      <nav className="sbf-quick" aria-label="Go to">
        {quickNav?.home && <QuickBtn label="Home" {...quickNav.home} />}
        {quickNav?.messages && <QuickBtn label="Messages" {...quickNav.messages} />}
        {quickNav?.schedule && <QuickBtn label="Schedule" {...quickNav.schedule} />}
        <QuickBtn label="Recent" active={view === 'recent'}
                  onClick={() => setShown(view === 'recent' ? null : 'recent')} />
        <QuickBtn label="Starred" active={view === 'starred'}
                  onClick={() => setShown(view === 'starred' ? null : 'starred')} />
      </nav>

      <div className="sb-list sbf-nav" ref={listRef} onKeyDown={onListKeyDown}
           style={!wide && navH ? { maxHeight: navH } : undefined}>
        <SidebarBoardsSection {...boardsSectionProps} filesView={filesView} />
        {sharedSection}
        {tagsSection}
      </div>

      {!wide && (
        <div className="sbf-divider" role="separator" aria-orientation="horizontal" tabIndex={0}
             aria-label="Share the height between clusters and files"
             title="Drag to share the height · double-click to reset"
             onPointerDown={onDividerDown}
             onDoubleClick={() => setNavHeight(null)}
             onKeyDown={(e) => {
               if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
               e.preventDefault();
               const cur = listRef?.current?.getBoundingClientRect().height || 240;
               setNavHeight(cur + (e.key === 'ArrowDown' ? 24 : -24));
             }}>
          <span className="sbf-divider-grip" aria-hidden="true" />
        </div>
      )}

      <section className={`sbf-files${dropping ? ' is-dropping' : ''}`} aria-label={`Files: ${title}`} {...sectionDrop}>
        <header className="sbf-files-head">
          {view === 'cluster' && <ClusterThumb board={shownBoard} />}
          <div className="sbf-files-title">
            <span className="sbf-files-name" title={title}>{title}</span>
            <span className="sbf-files-sub">{subtitle}</span>
          </div>
          {view !== 'cluster' && (
            <button type="button" className="sbf-iconbtn" aria-label="Back to the cluster’s files" title="Back to the cluster’s files"
                    onClick={() => setShown(null)}>
              <Icon as={X} size={13} />
            </button>
          )}
          {!coarse && onSetWidth && (
            <button type="button" className={`sbf-iconbtn${wide ? ' is-on' : ''}`}
                    aria-label={wide ? 'Show files under the clusters' : 'Show files beside the clusters'}
                    title={wide ? 'Show files under the clusters' : 'Show files beside the clusters'}
                    aria-pressed={wide}
                    onClick={toggleWide}>
              <Icon as={Columns2} size={14} />
            </button>
          )}
          {view === 'cluster' && onOpenShelf && (
            <button type="button" className="sbf-iconbtn" aria-label="Open in the full Files page" title="Open in the full Files page"
                    onClick={() => onOpenShelf(shownId, null)}>
              <Icon as={ArrowsOutSimple} size={14} />
            </button>
          )}
        </header>

        <div className="sbf-files-tools">
          <div className="sbf-search">
            <Icon as={Search} size={13} />
            <input type="search" value={query}
                   placeholder={`Search ${view === 'cluster' ? title : title.toLowerCase()}`}
                   aria-label={`Search ${title}`}
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === 'Escape') { e.preventDefault(); setQuery(''); return; }
                     // Nothing here matches, or ⌘↵: search everywhere instead.
                     if (e.key === 'Enter' && (nothing || e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpenPalette?.(query); }
                   }} />
            {query && (
              <button type="button" className="sbf-search-clear" aria-label="Clear" onClick={() => setQuery('')}><Icon as={X} size={12} /></button>
            )}
            <div className="sbf-sort" ref={menuRef}>
              <button type="button" className={`sbf-sort-btn${menuOpen ? ' is-on' : ''}`}
                      aria-haspopup="menu" aria-expanded={menuOpen}
                      aria-label="Sort and group"
                      title={`Sorted by ${SORT_LABELS[prefs.sort].toLowerCase()} · grouped by ${GROUP_LABELS[prefs.groupBy].toLowerCase()}`}
                      onClick={() => setMenuOpen((o) => !o)}>⇅</button>
              {menuOpen && (
                <div className="sbf-menu" role="menu">
                  <div className="sbf-menu-label">Sort</div>
                  {SORTS.map((so) => (
                    <button type="button" key={so} role="menuitemradio" aria-checked={prefs.sort === so}
                            className={`sbf-menu-item${prefs.sort === so ? ' is-on' : ''}`}
                            onClick={() => { setPref('sort', so); setMenuOpen(false); }}>
                      {SORT_LABELS[so]}
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
          {chips.length > 1 && (
            <ChipRow chips={chips} counts={chipCounts} chip={chip} setChip={setChip} />
          )}
        </div>

        <div className="sbf-files-list" ref={filesListRef} onKeyDown={onListKeyDown}>
          {showSubs && (
            <div className="sbf-subs" role="group" aria-label="Clusters">
              {subs.map((c) => (
                <button type="button" key={c.id} className="sbf-sub" onClick={() => onOpenBoard?.(c.id)}
                        title={`Open ${c.name}`}>
                  <ClusterThumb board={c.board} />
                  <span className="sbf-sub-name">{c.name}</span>
                  <span className="sbf-sub-count">{files.totalOf(c.id) || ''}</span>
                </button>
              ))}
            </div>
          )}
          {nothing && view !== 'cluster' ? (
            <div className="sbf-files-empty">
              {query.trim() ? `Nothing in ${title.toLowerCase()} matches “${query.trim()}”. Press Enter to search everywhere.`
                : view === 'recent' ? 'Nothing added lately.'
                  : (showSubs ? '' : 'Star a file or a cluster from its menu and it stays here.')}
            </div>
          ) : nothing && query.trim() ? (
            <div className="sbf-files-empty">Nothing in {title} matches “{query.trim()}”. Press Enter to search everywhere.</div>
          ) : (
            <ClusterShelves
              boardId={view === 'cluster' ? shownId : view}
              contents={contents}
              hasChildren={showSubs}
              coarse={coarse}
              shelfState={shelfState} onToggleShelf={onToggleShelf}
              onLoadMore={files.loadMore} canLoadMore={view === 'cluster' ? files.canLoadMore : () => false}
              onItem={onItem}
              isSelected={isSelected}
              onDragItem={onDragItem}
              onItemMenu={onItemMenu}
              onItemOpen={openItem}
              onOpenShelf={view === 'cluster' ? onOpenShelf : null}
              isStarred={files.isStarred}
              scrollRef={filesScrollRef}
            />
          )}
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
      </section>

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
