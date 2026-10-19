// The sidebar that holds every file (behind sidebarFilesAllowed until it ships).
//
// Two parts, the way file managers and Apple's guidelines split them: the
// clusters, as a plain tree of names — the folders, prominent and easy to scan
// — and the files of ONE of them, in a section of their own: the cluster
// you're in, or Recent, or Starred. A tree that also holds files gets long and
// unreadable fast (the first two versions of this did exactly that), so the
// tree never does.
//
// The files sit under the clusters (stacked) or beside them (side by side).
// Floating, the parts sit on two cards, the look the owner picked from four
// mockups: the clusters' card holds App's top (`top`), Home and Messages and
// the tree; the files' card the files, the meter and App's foot (`foot`). Each
// card takes its own size: App keeps the layout (lib/sidebarLayout.js), the
// frame takes it as custom properties, and SidebarHandles sizes the cards from
// their edges, corners and the gap between them. In the phone drawer they
// don't box (clusterSidebar.css).
//
// Above the clusters, Home and Messages, a row of words each. The files
// section has a segmented control for what it shows (the cluster, Recent,
// Starred), a search field with an "All files ⌄" menu beside it that filters,
// sorts and groups, then the files as rows, a small thumbnail beside each name
// (owner, 2026-10-18: the board is the visual place, the sidebar a calm list).
// Notes, links and the rest are summed up under the files, a closed heading
// each with its count, until a search, a filter or Starred asks for them.
// Clicking a file opens Quick look; double-clicking goes to it on its board.
// Files drag onto any cluster in the tree to move there (⌥ copies), and files
// from the desktop drop on a cluster or onto the section itself.
//
// Floating, the files' card has a heading like the clusters' with a word that
// hides it (owner, 2026-10-19: "it needs to be SUPER easy and SUPER obvious on
// how to get it back", picked from four mockups): hidden, the card folds to
// that heading where it was, "Files … Show", with the foot under it, and the
// clusters take the room. ⌘\ hides and shows them too, and so does ⌘K.

import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardContextMenu } from '../CardContextMenu.jsx';
import { composeMenuSections, SECTION } from '../../lib/contextMenuSections.js';
import { Icon } from '../Icon.jsx';
import { Search, X, Columns2, ArrowsOutSimple, ChevronDown } from '../../lib/icons.js';
import { SidebarBoardsSection } from '../SidebarBoardsSection.jsx';
import { ClusterShelves } from './ClusterShelves.jsx';
import { SidebarMeter } from './SidebarMeter.jsx';
import { SidebarHandles, sizeAtOnce } from './SidebarHandles.jsx';
import { useSidebarFiles } from '../../hooks/useSidebarFiles.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { FILTER_CHIPS, SHELF_IDS } from '../../lib/sidebarShelves.js';
import { SORTS, filterItems } from '../../lib/sidebarSort.js';
import { arrangementOf, frameVars, toggledLayout, withFilesHidden } from '../../lib/sidebarLayout.js';
import { initialExpandState, expandReducer, isExpanded, persistManual, shelfKey, toggleShelf } from '../../lib/sidebarExpand.js';
import { cardFromItem } from '../../lib/indexRowCard.js';
import { toListItem } from '../../lib/listItem.js';
import { downloadCardAsset, downloadCardAssets } from '../../lib/cardDownload.js';
import { FILES_DRAG_MIME, buildFilesPayload, parseFilesPayload } from '../../lib/filesDrag.js';
import { moveFiles, appendCards, removeCards, failureMessage } from '../../lib/clustersApi.js';
import { undoToast } from '../../lib/undoToast.js';
import { fileSharesAllowed } from '../../lib/appHost.js';
import { openFileShare } from '../../lib/fileShareBus.js';
import { isShareableCard } from '../../lib/fileShares.js';
import './clusterSidebar.css';

const QuickLook = lazy(() => import('../clusterBrowser/QuickLook.jsx'));

const PREFS_KEY = 'soleil.sidebar.prefs';
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

// Where to go: Home and Messages (App's), a row each. Words only, no icons
// (the owner's call), in the clusters' names column, and an unread count as a
// plain number at the row's end. Home is a place (active: the gold bar);
// Messages opens over where you are (pressed: the chip alone).
function QuickBtn({ label, active = false, pressed = false, unread = 0, onClick }) {
  return (
    <button type="button" className={`sbf-quickbtn${active ? ' is-on' : ''}${pressed ? ' is-pressed' : ''}`} aria-pressed={active || pressed} onClick={onClick}>
      <span className="sbf-quick-label">{label}</span>
      {unread > 0 && <span className="sbf-quick-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

// Where the "All files" menu opens: under its button when it fits, else over
// it; fitting neither, it slides up the window until it all shows (over its
// button, as menus do), and scrolls only in a window shorter than itself. It
// is portaled, so the files section's overflow (the divider can make it
// short) can't cut it off.
function placeMenu(btn, menu) {
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  const vh = window.innerHeight;
  const want = menu ? menu.scrollHeight : 0;
  const right = Math.max(8, window.innerWidth - r.right);
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  if (want <= below) return { right, top: r.bottom + 4, maxHeight: below };
  if (want <= above) return { right, bottom: vh - r.top + 4, maxHeight: above };
  const room = vh - 16;
  return { right, top: Math.max(8, vh - 8 - Math.min(want, room)), maxHeight: room };
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
  coarse = false,
  layout = null,          // App's sidebar layout (lib/sidebarLayout.js): the arrangement and each card's size
  onLayout = null,        // (layout, { commit }) => void — a handle, or the button that switches the arrangement
  floating = false,       // the desktop's two floating cards; false in the phone drawer
  roomy = true,           // the window has the room for side by side (SIDE_FITS_QUERY)
  snug = true,            // ... for side by side the button keeps (KEPT_FITS_QUERY)
  sizable = false,        // the handles show (floating, and the sidebar open)
  top = null,             // App's top of the sidebar (the workspace), on the clusters' card
  foot = null,            // App's foot (help, settings, you), on the files' card
  quickNav = null,        // { home, messages }: { active, unread?, onClick } each, from App
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
  const filterBtnRef = useRef(null);
  const menuPopRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  // Opened from the keyboard (a click with no pointer), the item in force shows
  // it has focus; opened with a pointer, focus goes there quietly.
  const menuByKey = useRef(false);
  // The menu itself is portaled out of menuRef: a click in it isn't outside.
  useDismissOnOutside(menuRef, menuOpen, () => setMenuOpen(false), { ignore: '.sbf-menu' });
  useLayoutEffect(() => {
    if (!menuOpen) { setMenuPos(null); return undefined; }
    const place = (e) => {
      const t = e?.target;
      if (t instanceof Node && menuPopRef.current?.contains(t)) return;   // scrolling the menu itself
      setMenuPos(placeMenu(filterBtnRef.current, menuPopRef.current));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen]);
  // Once it's placed (hidden until then, and hidden can't take focus), focus
  // goes into the menu, on the item in force, so ↑/↓, Tab and Esc work there.
  const menuPlaced = !!menuPos;
  useEffect(() => {
    if (!menuOpen || !menuPlaced) return;
    const pop = menuPopRef.current;
    (pop?.querySelector('[aria-checked="true"]') || pop?.querySelector('[role^="menuitem"]'))
      ?.focus({ preventScroll: true, focusVisible: menuByKey.current });
  }, [menuOpen, menuPlaced]);
  // A choice closes the menu and hands focus back to its button, as Esc does.
  const closeMenu = () => { setMenuOpen(false); filterBtnRef.current?.focus({ preventScroll: true }); };
  const onMenuKeyDown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); closeMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...(menuPopRef.current?.querySelectorAll('[role^="menuitem"]') || [])];
    const i = items.indexOf(document.activeElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[j]?.focus();
  };

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
  // The first tab: that cluster, whichever tab is showing.
  const clusterId = activeBoardId || lastBoard.current;
  const clusterBoard = clusterId ? allBoards?.[clusterId] || null : null;
  const shownId = shown ? null : clusterId;
  const view = shown || (clusterBoard ? 'cluster' : 'recent');
  useEffect(() => { if (view === 'cluster' && shownId) files.ensure(shownId); }, [view, shownId, files.ensure]);
  const tabs = [
    ...(clusterBoard ? [{ id: 'cluster', label: clusterBoard.name || 'Untitled', select: () => setShown(null) }] : []),
    { id: 'recent', label: 'Recent', select: () => setShown('recent') },
    { id: 'starred', label: 'Starred', select: () => setShown('starred') },
  ];
  const tabsId = useId();
  // ←/→ (and Home/End) move along the tabs and show what they move to.
  const onTabsKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = Math.max(0, tabs.findIndex((t) => t.id === view));
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[j].select();
    e.currentTarget.querySelectorAll('[role="tab"]')[j]?.focus();
  };

  // ── The two cards ─────────────────────────────────────────────────────────
  // Side by side or stacked (a touch screen, and a window too narrow for side
  // by side, always stack), each card its own size; the button above the
  // files switches, keeping each arrangement's sizes. Side by side from the
  // button stays however narrow it's dragged (kept), until the button again.
  // Hidden, the files fold to their heading under the clusters, in either.
  const folded = floating && !!onLayout && !!layout?.filesHidden;
  const side = floating && !folded && arrangementOf(layout, { coarse, roomy, snug }) === 'side';
  const kept = side && !!layout?.pinned;
  const frameRef = useRef(null);
  const treeCardRef = useRef(null);
  const filesCardRef = useRef(null);
  const ownNavRef = useRef(null);
  const navRef = listRef || ownNavRef;
  const toggleSide = () => { sizeAtOnce(frameRef.current); onLayout?.(toggledLayout(layout, side ? 'side' : 'stack'), { commit: true }); };

  // ── Hiding the files ──────────────────────────────────────────────────────
  // Hide moves focus to Show and Show back to Hide, so the way back is where
  // focus lands; ⌘\ moves it only when it was in the card that folded.
  const hideRef = useRef(null);
  const showRef = useRef(null);
  const focusAfter = useRef(null);      // 'show' | 'hide' | null
  const focusInFiles = useRef(false);
  const live = useRef(null);
  live.current = { layout, onLayout };
  const setFilesHidden = useCallback((hidden, focus = null) => {
    const { layout: l, onLayout: set } = live.current;
    if (!set || !!l?.filesHidden === hidden) return;
    focusAfter.current = focus;
    sizeAtOnce(frameRef.current);
    set(withFilesHidden(l, hidden), { commit: true });
  }, []);
  useLayoutEffect(() => {
    const want = focusAfter.current;
    focusAfter.current = null;
    // ⌘\ from inside the card: focus stays with it (a removed node fires no blur).
    const inFiles = focusInFiles.current || !!filesCardRef.current?.contains(document.activeElement);
    if (want === 'show' || (folded && want == null && inFiles)) showRef.current?.focus();
    else if (want === 'hide' || (!folded && want == null && inFiles)) hideRef.current?.focus();
  }, [folded]);
  useEffect(() => {
    if (!floating || !sizable || !onLayout) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.key !== '\\' && e.code !== 'Backslash') return;
      e.preventDefault();
      setFilesHidden(!live.current.layout?.filesHidden);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [floating, sizable, onLayout, setFilesHidden]);

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
    // One file at a time, by an editor of its cluster, as on the canvas and
    // in the list (the server refuses anyone else anyway).
    const card = many ? null : cardFromItem(m.item);
    const shareable = !many && fileSharesAllowed() && isShareableCard(card)
      && !!boardsSectionProps?.canEditBoard?.(m.item.boardId);
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
        ...(shareable ? [{ id: 'share', label: 'Share file…', run: () => openFileShare({
          boardId: m.item.boardId, cardId: m.item.cardId, card, boardName: nameOf(m.item.boardId), surface: 'sidebar',
        }) }] : []),
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
  // Clusters only, each row its name: its chevron is for its sub-clusters, it
  // shows an upload's progress, and it takes files dropped on it.
  const filesView = useMemo(() => ({
    isExpanded: (id) => isExpanded(expand, id),
    toggle: (id) => dispatch({ type: 'toggle', id }),
    hasContents: () => false,
    isHidden: () => false,
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
  // A cluster's own sub-clusters: the tree lists them, so here they only change
  // what an empty list says. In Starred, the starred clusters, listed by name
  // above the starred files.
  const subs = useMemo(() => {
    if (view === 'starred') return files.starred.clusters.map((c) => ({ id: c.boardId, board: allBoards?.[c.boardId], name: c.name }));
    if (view !== 'cluster') return [];
    return Object.values(allBoards || {})
      .filter((b) => b && b.parent_board_id === shownId && !b.deleted_at)
      .sort((x, y) => (x.name || '').localeCompare(y.name || ''))
      .map((b) => ({ id: b.id, board: b, name: b.name || 'Untitled' }));
  }, [view, shownId, allBoards, files.starred]);
  const starredClusters = view === 'starred' && chip === 'all' && !query.trim() ? subs : [];
  const title = view === 'recent' ? 'Recent' : view === 'starred' ? 'Starred' : (shownBoard?.name || 'Untitled');
  const emptyNote = view === 'cluster' && subs.length ? `Nothing in ${title} itself — open one of its clusters.` : undefined;
  // The one control above the files: what they show, and in its menu the sort
  // and the grouping too (it replaced a row of chips and a ⇅ button).
  const chipLabel = chip === 'all' ? 'All files' : (FILTER_CHIPS.find((c) => c.id === chip)?.label || 'All files');
  const nothing = !contents.loading && !(contents.shelves || []).some((sh) => sh.total > 0 || sh.items?.length);
  const filesListRef = useRef(null);
  // Fade the list's edges only where there's more to scroll to, as the
  // clusters' list does.
  useScrollEdges(filesListRef);
  const sourceKey = view === 'cluster' ? `cluster:${shownId}` : view;
  useEffect(() => { if (filesListRef.current) filesListRef.current.scrollTop = 0; }, [sourceKey]);
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

  // Folded, however it came (Hide, ⌘\, ⌘K): no menu left open over nothing,
  // no selection waiting to come back with Show.
  useEffect(() => {
    if (!folded) return;
    setMenuOpen(false);
    setFileMenu(null);
    clearSelection();
  }, [folded, clearSelection]);

  return (
    <>
      <div className={`sbf-frame${side ? ' is-side' : ''}${folded ? ' is-files-hidden' : ''}`} ref={frameRef} style={floating ? frameVars(layout, { coarse, roomy, snug }) : undefined}>
      <div className="sbf-card is-tree" ref={treeCardRef}>
      {top}
      <nav className="sbf-quick" aria-label="Go to">
        {quickNav?.home && <QuickBtn label="Home" {...quickNav.home} />}
        {quickNav?.messages && <QuickBtn label="Messages" {...quickNav.messages} />}
      </nav>

      <div className="sb-list sbf-nav" ref={navRef} onKeyDown={onListKeyDown}>
        <SidebarBoardsSection {...boardsSectionProps} filesView={filesView} />
        {sharedSection}
        {tagsSection}
      </div>
      </div>

      <div className={`sbf-card is-files${folded ? ' is-folded' : ''}`} ref={filesCardRef}
           onFocus={() => { focusInFiles.current = true; }}
           onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) focusInFiles.current = false; }}>
      {folded && (
        <button type="button" className="sbf-files-bar" ref={showRef} aria-label="Show files" title="Show files (⌘\)"
                aria-expanded="false" onClick={() => setFilesHidden(false, 'hide')}>
          <span className="sbf-files-heading-label">Files</span>
          <span className="sbf-files-show" aria-hidden="true">Show</span>
        </button>
      )}
      <section className={`sbf-files${dropping ? ' is-dropping' : ''}`} aria-label={`Files: ${title}`} {...sectionDrop}>
        {floating && onLayout && (
          <div className="sbf-files-heading">
            <span className="sbf-files-heading-label">Files</span>
            <button type="button" className="sbf-files-hide" ref={hideRef} aria-label="Hide files" title="Hide files (⌘\)"
                    aria-expanded="true" onClick={() => setFilesHidden(true, 'show')}>Hide</button>
          </div>
        )}
        <header className="sbf-files-head">
          <div className="sbf-tabs" role="tablist" aria-label="Show files from" onKeyDown={onTabsKeyDown}>
            {tabs.map((t) => {
              const on = view === t.id;
              return (
                <button type="button" key={t.id} role="tab" id={`${tabsId}-${t.id}`}
                        aria-selected={on} aria-controls={`${tabsId}-panel`} tabIndex={on ? 0 : -1}
                        className={`sbf-tab${t.id === 'cluster' ? ' is-cluster' : ''}${on ? ' is-on' : ''}`}
                        title={t.id === 'cluster' ? t.label : undefined}
                        onClick={() => { if (!on) t.select(); }}>
                  <span className="sbf-tab-label">{t.label}</span>
                </button>
              );
            })}
          </div>
          {floating && !coarse && snug && onLayout && (
            <button type="button" className={`sbf-iconbtn is-reveal${kept ? ' is-kept' : ''}`}
                    aria-label={side ? 'Show files under the clusters' : 'Show files beside the clusters'}
                    title={side ? (kept ? 'Kept side by side · show files under the clusters' : 'Show files under the clusters') : 'Show files beside the clusters'}
                    aria-pressed={side}
                    onClick={toggleSide}>
              <Icon as={Columns2} size={14} weight="regular" />
            </button>
          )}
          {onOpenShelf && (view === 'cluster' ? (
            <button type="button" className="sbf-iconbtn is-expand" aria-label="Open in the full Files page" title="Open in the full Files page"
                    onClick={() => onOpenShelf(shownId, null)}>
              <Icon as={ArrowsOutSimple} size={14} weight="regular" />
            </button>
          ) : (
            // Recent and Starred have no Files page of their own; the space
            // stays, so the icon before it doesn't move between tabs.
            <span className="sbf-iconbtn is-expand is-slot" aria-hidden="true" />
          ))}
        </header>

        <div className="sbf-panel" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${view}`}>
        {/* Search and what it shows, side by side: "All files ⌄" is its own
            button, not part of the field. */}
        <div className="sbf-files-tools">
          <div className="sbf-search">
            <Icon as={Search} size={14} weight="regular" />
            <input type="search" value={query}
                   placeholder={`Search ${title}`}
                   aria-label={`Search ${title}`}
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === 'Escape') { e.preventDefault(); setQuery(''); return; }
                     // Nothing here matches, or ⌘↵: search everywhere instead.
                     if (e.key === 'Enter' && (nothing || e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpenPalette?.(query); }
                   }} />
            {query && (
              <button type="button" className="sbf-search-clear" aria-label="Clear" onClick={() => setQuery('')}><Icon as={X} size={12} weight="regular" /></button>
            )}
          </div>
          <div className="sbf-filter" ref={menuRef}
               onKeyDown={(e) => {
                 if (e.key !== 'Escape' || !menuOpen) return;
                 e.preventDefault();
                 e.stopPropagation();
                 setMenuOpen(false);
                 filterBtnRef.current?.focus();
               }}>
            <button type="button" ref={filterBtnRef}
                    className={`sbf-filter-btn${chip !== 'all' ? ' is-on' : ''}${menuOpen ? ' is-open' : ''}`}
                    aria-haspopup="menu" aria-expanded={menuOpen}
                    title={`Showing ${chipLabel.toLowerCase()} · sorted by ${SORT_LABELS[prefs.sort].toLowerCase()} · grouped by ${GROUP_LABELS[prefs.groupBy].toLowerCase()}`}
                    onClick={(e) => { menuByKey.current = e.detail === 0; setMenuOpen((o) => !o); }}>
              {chipLabel}<span className="sbf-filter-caret" aria-hidden="true"><Icon as={ChevronDown} size={10} weight="regular" /></span>
            </button>
            {menuOpen && createPortal(
              <div className="sbf-menu" role="menu" aria-label="Show, sort and group" ref={menuPopRef}
                   style={menuPos || { top: 0, right: 0, visibility: 'hidden' }}
                   onKeyDown={onMenuKeyDown}>
                <div className="sbf-menu-label">Show</div>
                {chips.map((c) => (
                  <button type="button" key={c.id} role="menuitemradio" aria-checked={chip === c.id}
                          className={`sbf-menu-item${chip === c.id ? ' is-on' : ''}`}
                          onClick={() => { setChip(c.id); closeMenu(); }}>
                    {c.id === 'all' ? 'All files' : c.label}
                    {(chipCounts[c.id] || 0) > 0 && <span className="sbf-menu-count">{chipCounts[c.id]}</span>}
                  </button>
                ))}
                <div className="sbf-menu-sep" role="separator" />
                <div className="sbf-menu-label">Sort</div>
                {SORTS.map((so) => (
                  <button type="button" key={so} role="menuitemradio" aria-checked={prefs.sort === so}
                          className={`sbf-menu-item${prefs.sort === so ? ' is-on' : ''}`}
                          onClick={() => { setPref('sort', so); closeMenu(); }}>
                    {SORT_LABELS[so]}
                  </button>
                ))}
                <div className="sbf-menu-sep" role="separator" />
                <div className="sbf-menu-label">Group by</div>
                {Object.keys(GROUP_LABELS).map((g) => (
                  <button type="button" key={g} role="menuitemradio" aria-checked={prefs.groupBy === g}
                          className={`sbf-menu-item${prefs.groupBy === g ? ' is-on' : ''}`}
                          onClick={() => { setPref('groupBy', g); closeMenu(); }}>
                    {GROUP_LABELS[g]}
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>
        </div>

        <div className="sbf-files-list" ref={filesListRef} onKeyDown={onListKeyDown}>
          {/* Keyed on what it shows: a new source starts at the top, and fades in. */}
          <div className="sbf-files-body" key={sourceKey}>
          {starredClusters.length > 0 && (
            <div className="sbf-block" role="group" aria-label="Starred clusters">
              <div className="sbf-shelf sbf-starred-head">
                <span className="sbf-shelf-label">Clusters</span>
                <span className="sbf-shelf-count">{starredClusters.length}</span>
              </div>
              {starredClusters.map((c) => (
                <button type="button" key={c.id} className="sbf-file sbf-cluster-link" onClick={() => onOpenBoard?.(c.id)}
                        title={`Open ${c.name}`}>
                  <span className="sbf-file-name">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          {nothing && view !== 'cluster' ? (
            starredClusters.length > 0 ? null : (
              <div className="sbf-files-empty">
                {query.trim() ? `Nothing in ${title.toLowerCase()} matches “${query.trim()}”. Press Enter to search everywhere.`
                  : view === 'recent' ? 'Nothing added lately.'
                    : 'Star a file or a cluster from its menu and it stays here.'}
              </div>
            )
          ) : nothing && query.trim() ? (
            <div className="sbf-files-empty">Nothing in {title} matches “{query.trim()}”. Press Enter to search everywhere.</div>
          ) : (
            <ClusterShelves
              boardId={view === 'cluster' ? shownId : view}
              contents={contents}
              emptyNote={emptyNote}
              coarse={coarse}
              foldMinor={view !== 'starred' && chip === 'all' && !query.trim()}
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
        </div>
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
      {foot}
      </div>
      </div>
      {floating && sizable && onLayout && (
        <SidebarHandles layout={layout} coarse={coarse} roomy={roomy} snug={snug} onLayout={onLayout}
                        frameRef={frameRef} treeRef={treeCardRef} filesRef={filesCardRef} navRef={navRef} />
      )}

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
            canEditItem={(it) => !!boardsSectionProps?.canEditBoard?.(it.boardId)}
          />
        </Suspense>
      )}
    </>
  );
}
