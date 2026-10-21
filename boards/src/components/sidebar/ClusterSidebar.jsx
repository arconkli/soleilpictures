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
//
// Any cluster's files, without leaving the board (owner, 2026-10-19: "easily
// navigate to other clusters so we can drag files from one cluster to
// another", picked from four mockups): the cluster tab says "Feature film ⌄",
// and pressed again lists the workspace's clusters to pick from
// (ClusterSwitch.jsx: the tree's order, a find box that keeps the keys; a
// sheet from the bottom in the phone drawer). Files then
// shows that one, with "Back to Feature film" and "Open Casting" under the
// tabs. Dragging follows one set of rules wherever a file lands
// (lib/dropRules.js): it moves, the copy key copies, nothing leaves its
// workspace, nothing goes into a cluster you can only view, and a label at the
// pointer says which before you let go (DragLabel.jsx).

import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardContextMenu } from '../CardContextMenu.jsx';
import { composeMenuSections, SECTION } from '../../lib/contextMenuSections.js';
import { Icon } from '../Icon.jsx';
import { Search, X, Columns2, ArrowsOutSimple, ArrowsInSimple, ChevronDown, ChevronLeft } from '../../lib/icons.js';
import { SidebarBoardsSection } from '../SidebarBoardsSection.jsx';
import { ClusterShelves } from './ClusterShelves.jsx';
import { SidebarMeter } from './SidebarMeter.jsx';
import { SidebarHandles, sizeAtOnce } from './SidebarHandles.jsx';
import { DragLabel, BLANK_DRAG_IMAGE } from './DragLabel.jsx';
import { useSidebarFiles } from '../../hooks/useSidebarFiles.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { useSpring } from '../../hooks/useSpring.js';
import { beginDragSession, dragSession, onDragSession } from '../../lib/springLoad.js';
import { decideDrop, copyKeyHeld, whatOf } from '../../lib/dropRules.js';
import { canStore } from '../../lib/placement.js';
import { isStillUploading } from '../../lib/abandonedUploads.js';
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
import { fileSharesAllowed, touchPassAllowed } from '../../lib/appHost.js';
import { openFileShare } from '../../lib/fileShareBus.js';
import { isShareableCard } from '../../lib/fileShares.js';
import { captureDropEntries, captureDropHandles, hasDirectory } from '../../lib/folderWalk.js';
import { isZipFile } from '../../lib/importZips.js';
import { ImportWaitRow } from '../ImportWaitRow.jsx';
import { ClusterSwitch } from './ClusterSwitch.jsx';
import { logEvent, noteSessionCounter } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
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
  workspaceName = '',     // what a refused drag says files stay within
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
  foldedFor = null,       // 'page': folded because the full Files page shows these files (App, direction A)
  onShrinkPage = null,    // (via) => void — that page's way back into the sidebar
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
  onUploadFolder,         // (files) => void — a picked folder; omit (with onUploadZips) for a plain file picker
  onUploadZips,           // (files) => void — picked zips
  onOpenBoard,            // (boardId) => void
  onShowFile,             // (boardId, cardId, { unplaced }) => void
  onOpenShelf,            // (boardId, shelfId) => void — the shelf in the full-page Files view
  onOpenPalette,          // (query) => void
  feedback = null,        // the app's toasts (useFeedback)
  onPickCluster = null,   // ({ placeholder, excludeIds }) => Promise<boardId|null>
  onPutOnBoard = null,    // (boardId, cardIds) => Promise — files waiting in that cluster's Files go on its board (App brings it up first)
  // (boardId, { entries | files, handles, source }) => Promise<{ loose }> — a
  // folder or zips dropped on a cluster: a bulk import into it (null where
  // bulk import is off). Loose files beside them go in as any drop does.
  onImportTreeOnCluster = null,
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
  // you've picked another from the cluster tab's list, or asked for Recent or
  // Starred. Going somewhere puts it back on where you are, with a fresh
  // search.
  const [shown, setShown] = useState(null);   // null | 'recent' | 'starred'
  const [browseId, setBrowseId] = useState(null);
  const lastBoard = useRef(activeBoardId || null);
  if (activeBoardId) lastBoard.current = activeBoardId;
  useEffect(() => { setShown(null); setQuery(''); setBrowseId(null); }, [activeBoardId]);
  // Where you are, and the cluster the first tab shows: where you are, or the
  // one picked from its list (gone, or trashed meanwhile: where you are).
  const clusterId = activeBoardId || lastBoard.current;
  const picked = browseId && allBoards?.[browseId] && !allBoards[browseId].deleted_at ? browseId : null;
  const tabClusterId = picked || clusterId;
  const clusterBoard = tabClusterId ? allBoards?.[tabClusterId] || null : null;
  const shownId = shown ? null : tabClusterId;
  const view = shown || (clusterBoard ? 'cluster' : 'recent');
  // What the files show, for the events below without re-creating their
  // handlers on every keystroke.
  const shownRef = useRef({ view, searching: false });
  shownRef.current = { view, searching: !!query.trim() };
  // A search is logged once, when it ends, by its shape: how long the words
  // were and how many files matched, never the words (EV.FILES_SEARCH).
  const searchStat = useRef(null);   // { q_len, results_n, view } once it has settled
  const endSearch = useCallback((ended) => {
    const st = searchStat.current;
    searchStat.current = null;
    if (st) logEvent(EV.FILES_SEARCH, { ...st, ended });
  }, []);
  const noteOpen = (item, how) => {
    if (shownRef.current.searching) endSearch('opened');
    logEvent(EV.FILES_OPEN, { kind: item?.kind || null, how, ...shownRef.current });
  };
  const away = view === 'cluster' && !!picked && picked !== clusterId;
  useEffect(() => { if (view === 'cluster' && shownId) files.ensure(shownId); }, [view, shownId, files.ensure]);

  // ── The cluster tab's list ────────────────────────────────────────────────
  // Pressing the cluster tab while it shows opens the workspace's clusters
  // (ClusterSwitch.jsx), with a box to find one by name. It fades as it
  // closes, and the tab has the focus back.
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchClosing, setSwitchClosing] = useState(false);
  const clusterTabRef = useRef(null);
  const tabsRef = useRef(null);
  const switchTimer = useRef(0);
  const switchOpenRef = useRef(false);
  switchOpenRef.current = switchOpen;
  useEffect(() => () => clearTimeout(switchTimer.current), []);
  const openSwitch = () => {
    noteSessionCounter('files.switch_open');
    clearTimeout(switchTimer.current);
    switchTimer.current = 0;
    setSwitchClosing(false);
    setSwitchOpen(true);
  };
  // Gone at once: no fade, the focus left where it is.
  const dropSwitch = useCallback(() => {
    clearTimeout(switchTimer.current);
    switchTimer.current = 0;
    setSwitchClosing(false);
    setSwitchOpen(false);
  }, []);
  const closeSwitch = useCallback(() => {
    if (!switchOpenRef.current || switchTimer.current) return;
    const done = () => {
      switchTimer.current = 0;
      setSwitchClosing(false);
      setSwitchOpen(false);
      clusterTabRef.current?.focus({ preventScroll: true });
    };
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    setSwitchClosing(true);
    switchTimer.current = setTimeout(done, 110);
  }, []);
  useDismissOnOutside(clusterTabRef, switchOpen && !switchClosing, closeSwitch, { ignore: '.sbf-switch' });
  const pickCluster = (id) => {
    noteSessionCounter('files.switch_pick');
    setBrowseId(id && id !== clusterId ? id : null);
    setShown(null);
    setQuery('');
    closeSwitch();
  };

  // A tab switch is counted, not logged: it happens too often to be an event.
  const showTab = (to) => {
    if (to !== view) noteSessionCounter(`files.tab_${to}`);
    setShown(to === 'cluster' ? null : to);
  };
  const tabs = [
    ...(clusterBoard ? [{ id: 'cluster', label: clusterBoard.name || 'Untitled', select: () => showTab('cluster') }] : []),
    { id: 'recent', label: 'Recent', select: () => showTab('recent') },
    { id: 'starred', label: 'Starred', select: () => showTab('starred') },
  ];
  const tabsId = useId();
  // ←/→ (and Home/End) move along the tabs and show what they move to; ↓ on
  // the cluster tab opens its list.
  const onTabsKeyDown = (e) => {
    if (e.key === 'ArrowDown' && e.target === clusterTabRef.current && view === 'cluster') {
      e.preventDefault();
      openSwitch();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = Math.max(0, tabs.findIndex((t) => t.id === view));
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[j].select();
    e.currentTarget.querySelectorAll('[role="tab"]')[j]?.focus();
  };

  // ── The two cards ─────────────────────────────────────────────────────────
  // Side by side or stacked (a window too narrow for side by side always
  // stacks), each card its own size; the button above the files switches,
  // keeping each arrangement's sizes. Side by side from the button stays
  // however narrow it's dragged (kept), until the button again. A touch
  // screen keeps its own: side by side, full height, until its button stacks
  // them (lib/sidebarLayout.js).
  // Hidden, the files fold to their heading under the clusters, in either.
  const folded = floating && !!onLayout && !!layout?.filesHidden;
  // Folded by the full Files page (⤢, F; direction A): its bar says where
  // the files are and is the way back.
  const pageFold = folded && foldedFor === 'page';
  const side = floating && !folded && arrangementOf(layout, { coarse, roomy, snug }) === 'side';
  const kept = side && !coarse && !!layout?.pinned;
  const frameRef = useRef(null);
  const treeCardRef = useRef(null);
  const filesCardRef = useRef(null);
  const ownNavRef = useRef(null);
  const navRef = listRef || ownNavRef;
  const toggleSide = () => { sizeAtOnce(frameRef.current); onLayout?.(toggledLayout(layout, side ? 'side' : 'stack', { coarse }), { commit: true }); };

  // ── Hiding the files ──────────────────────────────────────────────────────
  // Hide moves focus to Show and Show back to Hide, so the way back is where
  // focus lands; ⌘\ moves it only when it was in the card that folded.
  const hideRef = useRef(null);
  const showRef = useRef(null);
  const focusAfter = useRef(null);      // 'show' | 'hide' | null
  const focusInFiles = useRef(false);
  const live = useRef(null);
  live.current = { layout, onLayout, pageFold, onShrinkPage };
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
    // Folded by the full Files page: focus stays with the page, never pulled
    // onto the bar.
    if (pageFold) { focusInFiles.current = false; return; }
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
      // Folded by the page: ⌘\ is its way back (the card opens with it).
      if (live.current.pageFold) { live.current.onShrinkPage?.('sidebar_key'); return; }
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
    const show = () => { setQl({ items: list, index }); noteOpen(item, 'quick'); };
    // A keyboard Space/click (detail 0) has no double to wait for.
    if (e && e.detail === 0) { show(); return; }
    quickTimer.current = setTimeout(show, 220);
  }, [allBoards]);   // eslint-disable-line react-hooks/exhaustive-deps
  const openItem = useCallback((item) => {
    clearTimeout(quickTimer.current);
    setQl(null);
    noteOpen(item, 'show');
    onShowFile?.(item.boardId, item.cardId, { unplaced: item.unplaced });
  }, [onShowFile]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection: ⌘/Ctrl-click adds one, ⇧-click a run along the shelf ──────
  // A finger has neither key: a hold's menu offers Select, which puts a check
  // on every file and makes a tap add one or take it out (held to
  // touchPassAllowed, with the canvas's and Files' own).
  const touchPass = useMemo(() => touchPassAllowed(), []);
  const [selected, setSelected] = useState(() => new Map());   // key → item
  const [selecting, setSelecting] = useState(false);
  const anchorRef = useRef(null);
  const clearSelection = useCallback(() => { setSelected(new Map()); setSelecting(false); anchorRef.current = null; }, []);
  useEffect(() => { clearSelection(); }, [workspaceId, clearSelection]);
  const isSelected = useCallback((item) => selected.has(item.key), [selected]);
  const onItem = useCallback((item, siblings, e) => {
    if (selecting || (e && (e.metaKey || e.ctrlKey))) {
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
  }, [openQuick, clearSelection, selecting]);

  // ── Moving files between clusters ─────────────────────────────────────────
  // Plain drop moves, the copy key copies (a linked copy: same stored file, one
  // more card). Both go through /api/clusters, so neither cluster has to be
  // open, and both offer Undo. `what` names them as the drag's label did. They
  // land in the cluster's Files, off its board, so the toast also offers to put
  // them on it (App's onPutOnBoard, which brings the cluster up) — unless
  // `kinds` says none of them could wait in Files (a doc goes on the board).
  const runMove = useCallback(async ({ from, to, cardIds, copy = false, what = null, kinds = null, via = 'drag' }) => {
    if (!from || !to || from === to || !cardIds?.length) return;
    const r = await api.moveFiles({ from, to, cardIds, mode: copy ? 'copy' : 'move' });
    const moved = (props) => logEvent(EV.FILES_MOVE, {
      via, copy, n: cardIds.length, to_open: to === activeBoardId, ...props,
    });
    if (!r.ok) {
      moved({ done: 0, outcome: r.error === 'partial' ? 'partial' : 'failed', error: String(r.error || 'unknown').slice(0, 40) });
      // They reached the other cluster but didn't all leave this one. The
      // same move again finishes it without a second copy (the route finds
      // them landed), so that is what the button does.
      if (r.error === 'partial') {
        files.refresh();
        toast({
          type: 'error',
          message: `Moved to ${nameOf(to)}, but they’re still in ${nameOf(from)} too.`,
          action: { label: 'Finish', onClick: () => runMove({ from, to, cardIds, via: 'finish' }) },
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
    moved({ done: n, late: kept + skipped, outcome: n ? 'ok' : 'nothing' });
    if (!n) {
      toast({
        type: 'info',
        // A copy skips only what's still uploading (every other kind copies).
        message: kept || skipped ? 'Those files are still uploading. Try again when they finish.'
          : 'Those files aren’t there any more.',
      });
      return;
    }
    const said = what && n === cardIds.length ? what : n === 1 ? '1 file' : `${n} files`;
    const late = kept + skipped;
    const extra = late ? ` · ${late} still uploading stayed put` : '';
    // Into the files of the cluster on the board, nothing new shows there:
    // the words say where they went.
    const where = to === activeBoardId ? `into ${nameOf(to)}’s files` : `to ${nameOf(to)}`;
    const landed = copy ? (r.cards || []).map((c) => c.id) : (r.pairs || []).map((p) => p.to);
    const storable = !kinds || kinds.some((kind) => canStore({ kind }));
    const putOn = onPutOnBoard && storable && landed.length ? {
      label: 'Put on board',
      onClick: () => {
        Promise.resolve(onPutOnBoard(to, landed))
          .then(() => logEvent(EV.FILES_PUT, { from: 'toast', n: landed.length, ok: true }))
          .catch((e) => {
            logEvent(EV.FILES_PUT, { from: 'toast', n: landed.length, ok: false });
            toast({ type: 'error', message: e?.message || 'Those files couldn’t be put on the board.' });
          })
          .finally(() => files.refresh());
      },
    } : null;
    undoToast(feedback, {
      also: [putOn],
      message: `${copy ? 'Copied' : 'Moved'} ${said} ${where}${extra}`,
      onUndo: async () => {
        const u = copy
          ? await api.removeCards({ boardId: to, cardIds: (r.cards || []).map((c) => c.id) })
          : await api.moveFiles({
            from: to, to: from, mode: 'move',
            cardIds: (r.pairs || []).map((p) => p.to),
            restore: (r.originals || []).map((o) => ({ ...o, id: (r.pairs || []).find((p) => p.from === o.id)?.to || o.id })),
          });
        logEvent(EV.FILES_MOVE, {
          via: 'undo', copy, n: landed.length, outcome: u.ok ? 'ok' : 'failed',
          error: u.ok ? null : String(u.error || 'unknown').slice(0, 40),
        });
        if (!u.ok) toast({ type: 'error', message: failureMessage(u, 'move') });
        files.refresh();
      },
    });
  }, [api, files, feedback, clearSelection, activeBoardId, onPutOnBoard]);   // eslint-disable-line react-hooks/exhaustive-deps

  const groupByCluster = (items) => {
    const out = new Map();
    for (const it of items) { if (!out.has(it.boardId)) out.set(it.boardId, []); out.get(it.boardId).push(it); }
    return out;
  };

  const canEdit = useCallback((id) => !!boardsSectionProps?.canEditBoard?.(id), [boardsSectionProps]);

  // A drag carries every file picked, whichever cluster each is in. The drag
  // session holds what the rules need about each (its cluster, whether it can
  // leave it) for every target's dragover, where the payload can't be read;
  // the payload says the same for a drop the session missed.
  const onDragItem = useCallback((item, e) => {
    const group = selected.has(item.key) ? [...selected.values()] : [item];
    const clusters = new Set(group.map((x) => x.boardId));
    const one = clusters.size === 1 ? item.boardId : null;
    const payload = buildFilesPayload({
      sourceBoardId: item.boardId, sourceName: one ? nameOf(one) : '',
      cards: group.map((x) => ({ ...cardFromItem(x), sourceBoardId: x.boardId })), intent: 'move',
    });
    if (!payload) { e.preventDefault(); return; }
    try {
      e.dataTransfer.setData(FILES_DRAG_MIME, payload);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (BLANK_DRAG_IMAGE) e.dataTransfer.setDragImage(BLANK_DRAG_IMAGE, 0, 0);
    } catch (_) { /* a drag the browser won't carry */ }
    const thumbs = group.slice(0, 3).map((x) => {
      try { return document.querySelector(`[data-sb-item="${CSS.escape(x.key)}"] img`)?.currentSrc || null; } catch (_) { return null; }
    }).filter(Boolean);
    beginDragSession(e.currentTarget, {
      kind: 'files',
      sourceBoardId: item.boardId,
      sourceName: one ? nameOf(one) : '',
      workspaceId,
      thumbs,
      files: group.map((x) => ({
        id: x.cardId, kind: x.kind, name: x.name || '', boardId: x.boardId,
        uploading: isStillUploading(cardFromItem(x)), canMove: canEdit(x.boardId),
        workspaceId: allBoards?.[x.boardId]?.workspace_id || null,
      })),
    });
  }, [selected, workspaceId, canEdit, allBoards]);   // eslint-disable-line react-hooks/exhaustive-deps

  // What letting go over `target` would do (lib/dropRules.js). The files come
  // from the drag session; at a drop the session missed, from the payload; for
  // a card dragged off the board (a pointer drag), from the board (`drag`).
  const filesInDrag = (e, drag = null) => {
    if (drag?.files?.length) return { files: drag.files, sourceName: drag.sourceName || '' };
    const s = dragSession();
    if (s?.kind === 'files' && s.files?.length) return { files: s.files, sourceName: s.sourceName || '' };
    if (e?.type !== 'drop') return null;
    const p = parseFilesPayload(e.dataTransfer?.getData?.(FILES_DRAG_MIME));
    if (!p) return null;
    return {
      sourceName: p.sourceName,
      files: p.cards.map((c) => ({
        id: c.id, kind: c.kind, name: c.title || '', boardId: c.sourceBoardId || p.sourceBoardId,
        canMove: canEdit(c.sourceBoardId || p.sourceBoardId),
        workspaceId: allBoards?.[c.sourceBoardId || p.sourceBoardId]?.workspace_id || null,
      })),
    };
  };
  const decide = (e, target, handed = null) => {
    const drag = filesInDrag(e, handed);
    if (!drag) return null;
    return decideDrop({ ...drag, target, workspaceId, workspaceName, copy: copyKeyHeld(e) });
  };
  const clusterTarget = (boardId) => {
    const b = allBoards?.[boardId];
    return { boardId, where: 'files', name: b?.name, workspaceId: b?.workspace_id || null, writable: canEdit(boardId) };
  };

  // The label at the pointer asks the same thing of whatever's under it: a
  // tree row, the files list, a board, a cluster shared from elsewhere.
  const resolveDrop = useCallback((el, e, handed = null) => {
    const id = el.getAttribute('data-drop-board');
    if (!id) return null;
    const elsewhere = el.getAttribute('data-drop-ws');
    const b = allBoards?.[id];
    const target = {
      boardId: id,
      where: el.getAttribute('data-drop-where') === 'board' ? 'board' : 'files',
      name: el.getAttribute('data-drop-name') || b?.name,
      workspaceId: elsewhere || b?.workspace_id || null,
      owner: el.getAttribute('data-drop-owner') || null,
      workspaceName: el.getAttribute('data-drop-ws-name') || null,
      writable: !elsewhere && canEdit(id),
    };
    return decide(e, target, handed);
  }, [allBoards, canEdit, workspaceId, workspaceName]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Each file goes from its own cluster: one move (and one Undo) per cluster.
  const runDrop = async (d, to) => {
    const byCluster = (list) => {
      const out = new Map();
      for (const f of list) { if (!out.has(f.boardId)) out.set(f.boardId, []); out.get(f.boardId).push(f); }
      return out;
    };
    for (const [copy, list] of [[false, d.move], [true, d.copy]]) {
      for (const [from, fs] of byCluster(list)) {
        await runMove({ from, to, cardIds: fs.map((f) => f.id), copy, what: whatOf(fs), kinds: fs.map((f) => f.kind), via: 'drag' });
      }
    }
    clearSelection();
  };

  // Over a cluster that says no, the browser never fires a drop: the drag just
  // ends. So the no is kept on the drag with where the pointer was, and a drag
  // that ends without a drop, the pointer still there, was let go on it.
  const noteRefusal = (e, d, at) => {
    const s = dragSession();
    if (s) s.refusal = d.effect === 'none'
      ? { reason: d.reason || null, at, copy: copyKeyHeld(e), x: e.clientX, y: e.clientY, t: Date.now() } : null;
  };
  useEffect(() => onDragSession((ev) => {
    const s = ev.session;
    const r = ev.type === 'end' && !ev.dropped && s?.kind === 'files' ? s.refusal : null;
    if (!r || r.x !== s.x || r.y !== s.y || Date.now() - r.t > 2000) return;
    logEvent(EV.FILES_MOVE, { via: 'drag', copy: r.copy, n: s.files?.length || 0, outcome: 'refused', reason: r.reason, at: r.at });
  }), []);
  const dropEffect = useCallback((e, boardId, at = 'tree') => {
    const t = e.dataTransfer?.types || [];
    if (t.includes(FILES_DRAG_MIME)) {
      const d = decide(e, clusterTarget(boardId));
      // No session to ask (it ended early): the drop decides.
      if (!d) return copyKeyHeld(e) ? 'copy' : 'move';
      noteRefusal(e, d, at);
      return d.effect === 'none' ? null : d.effect;
    }
    if (t.includes('Files') && onDropFilesOnCluster) return canEdit(boardId) ? 'copy' : null;
    return null;
  }, [onDropFilesOnCluster, canEdit, allBoards, workspaceId, workspaceName]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onDropOnCluster = useCallback((boardId, e) => {
    const t = e.dataTransfer?.types || [];
    if (t.includes(FILES_DRAG_MIME)) {
      const d = decide(e, clusterTarget(boardId));
      if (d && (d.move.length || d.copy.length)) runDrop(d, boardId);
      else if (d && d.action === 'none') {
        logEvent(EV.FILES_MOVE, {
          via: 'drag', copy: copyKeyHeld(e), n: filesInDrag(e)?.files?.length || 0,
          outcome: 'refused', reason: d.reason ? String(d.reason).slice(0, 40) : null, to_open: boardId === activeBoardId,
        });
      }
      return;
    }
    if (!canEdit(boardId)) return;
    // A folder, or zips, is a bulk import into that cluster, as on the board
    // and in full Files: folders become clusters, their files wait in Files.
    // Read off the drop while it's being dispatched (Chrome empties it after),
    // the handles too, so an import a reload stops can go on.
    const tree = (input) => {
      const handles = captureDropHandles(e.dataTransfer);
      Promise.resolve(onImportTreeOnCluster(boardId, { ...input, handles, source: 'sidebar' }))
        .then((out) => { if (out?.loose?.length) onDropFilesOnCluster?.(boardId, out.loose); })
        .catch(() => {});
    };
    const entries = onImportTreeOnCluster ? captureDropEntries(e.dataTransfer) : [];
    if (hasDirectory(entries)) { tree({ entries }); return; }
    const dropped = [...(e.dataTransfer?.files || [])];
    if (onImportTreeOnCluster && dropped.some(isZipFile)) { tree({ files: dropped }); return; }
    if (dropped.length) onDropFilesOnCluster?.(boardId, dropped);
  }, [runMove, onDropFilesOnCluster, onImportTreeOnCluster, canEdit, allBoards, workspaceId, workspaceName]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Held over a folded cluster in the tree, a drag opens it, as Finder's
  // folders spring open: its sub-clusters show, to drop on.
  const spring = useSpring();
  const expandRef = useRef(expand);
  expandRef.current = expand;
  const springOpen = useCallback((id) => {
    if (isExpanded(expandRef.current, id)) return;
    spring.enter(`row:${id}`, () => { if (!isExpanded(expandRef.current, id)) dispatch({ type: 'toggle', id }); });
  }, [spring]);
  const springLeave = useCallback((id, e) => spring.leave(`row:${id}`, e), [spring]);

  // ── The bar under a selection ─────────────────────────────────────────────
  // Move… and Copy… pick a cluster, as Move to… and Copy to… in a file's menu
  // do (Download is there too, for the whole selection). A file in a cluster
  // you can only view can be copied, not moved.
  const selItems = useMemo(() => [...selected.values()], [selected]);
  const sendTo = async (group, copy, via = 'menu') => {
    const to = pickedId(await onPickCluster?.({ placeholder: copy ? 'Copy to…' : 'Move to…' }));
    if (!to) { logEvent(EV.FILES_MOVE, { via, copy, n: group.length, outcome: 'cancelled' }); return; }
    for (const [from, items] of groupByCluster(group)) {
      if (from !== to) await runMove({ from, to, cardIds: items.map((x) => x.cardId), copy, what: whatOf(items), kinds: items.map((x) => x.kind), via });
    }
    clearSelection();
  };
  const movable = (group) => group.every((x) => canEdit(x.boardId));
  const moveSelection = () => sendTo(selItems, false, 'bar');
  const copySelection = () => sendTo(selItems, true, 'bar');
  // Put on board: the selected files that are waiting in Files go on their
  // cluster's board — one cluster's at a time, as only one board comes up.
  const waitingSel = selItems.filter((x) => x.unplaced);
  const putting = useRef(false);
  const putItems = async (list, via = 'menu') => {
    const from = new Set(list.map((x) => x.boardId));
    if (from.size > 1) { toast({ type: 'info', message: 'Put on board takes one cluster’s files at a time. Select files from one cluster.' }); return; }
    if (!from.size || putting.current) return;
    putting.current = true;
    try {
      await onPutOnBoard([...from][0], list.map((x) => x.cardId));
      logEvent(EV.FILES_PUT, { from: via, n: list.length, ok: true });
      clearSelection();
    } catch (e) {
      logEvent(EV.FILES_PUT, { from: via, n: list.length, ok: false });
      toast({ type: 'error', message: e?.message || 'Those files couldn’t be put on the board.' });
    } finally {
      putting.current = false;
      files.refresh();
    }
  };
  const putSelection = () => putItems(waitingSel, 'bar');
  const deleteSelection = (from = 'bar') => deleteItems(selItems, from);
  const deleteItems = async (list, from = 'menu') => {
    const gone = (props) => logEvent(EV.FILES_DELETE, { from, ...props });
    for (const [boardId, items] of groupByCluster(list)) {
      const ids = items.map((x) => x.cardId);
      const what = ids.length === 1 ? '1 file' : `${ids.length} files`;
      if (boardId === liveBoardId && liveMutators?.deleteCards) {
        const deleted = await liveMutators.deleteCards(ids);
        gone({ n: ids.length, done: deleted !== null ? ids.length : 0, outcome: deleted !== null ? 'ok' : 'failed', live: true });
        if (deleted !== null) undoToast(feedback, {
          message: `Deleted ${what}`,
          undoManager: liveMutators.undoManager, stackItem: deleted?.stackItem || null,
          onUndo: () => liveMutators.undo?.(),
        });
        continue;
      }
      const r = await api.removeCards({ boardId, cardIds: ids });
      if (!r.ok) {
        gone({ n: ids.length, done: 0, outcome: 'failed', live: false, error: String(r.error || 'unknown').slice(0, 40) });
        toast({ type: 'error', message: failureMessage(r, 'remove') });
        continue;
      }
      // Say what the cluster actually let go of: a selection can outlive its
      // files (someone else deleted them meanwhile).
      const removed = r.removed?.length || 0;
      gone({ n: ids.length, done: removed, outcome: removed ? 'ok' : 'gone', live: false });
      if (!removed) { toast({ type: 'info', message: 'Those files aren’t there any more.' }); continue; }
      const said = removed === 1 ? '1 file' : `${removed} files`;
      undoToast(feedback, {
        message: `Deleted ${said} from ${nameOf(boardId)}`,
        onUndo: async () => {
          const u = await api.appendCards({ boardId, cards: r.removed || [] });
          logEvent(EV.FILES_DELETE, { undo: true, ok: !!u.ok });
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
  const onItemMenu = useCallback((item, siblings, x, y, opts) => setFileMenu({ item, siblings, x, y, viaTouch: !!opts?.viaTouch }), []);
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
    // Select, first in a hold's menu: a check on every file, for a finger to
    // pick several. The one held starts picked.
    const select = m.viaTouch && touchPass && !selecting && { id: 'select', label: 'Select', run: () => {
      setSelected((cur) => (cur.has(m.item.key) ? cur : new Map([[m.item.key, m.item]])));
      setSelecting(true);
      logEvent(EV.TOUCH_SELECT, { where: 'sidebar', via: 'menu', n: group.length });
    } };
    // Files waiting in Files go on their board from here too: a finger can't
    // drag them there.
    const put = onPutOnBoard && group.every((x) => x.unplaced) && movable(group)
      && new Set(group.map((x) => x.boardId)).size === 1
      && { id: 'put', label: many ? `Put ${group.length} on board` : 'Put on board', run: () => putItems(group, 'menu') };
    return composeMenuSections([
      { items: [select] },
      { items: [
        { id: 'quick', label: 'Quick look', run: () => openQuick(m.item, m.siblings, { detail: 0 }) },
        { id: 'show', label: m.item.unplaced ? 'Show in Files' : 'Show on board', run: () => openItem(m.item) },
        put,
        { id: 'star', label: starredNow ? 'Unstar' : 'Star', run: () => {
          files.toggleStar(m.item.boardId, m.item.cardId);
          logEvent(EV.FILES_STAR, { on: !starredNow, what: 'file' });
        } },
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
        ...(onPickCluster && movable(group) ? [{ id: 'move', label: many ? `Move ${group.length} to…` : 'Move to…', run: () => sendTo(group, false) }] : []),
        ...(onPickCluster ? [{ id: 'copy', label: many ? `Copy ${group.length} to…` : 'Copy to…', run: () => sendTo(group, true) }] : []),
        { id: 'delete', label: many ? `Delete ${group.length}` : 'Delete', danger: true, run: () => { deleteItems(group, 'menu'); clearSelection(); } },
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
    springOpen,
    springLeave,
    menuItems: (board, canEdit) => [
      { id: 'star', label: files.isStarred(board.id) ? 'Unstar' : 'Star', run: () => {
        const on = !files.isStarred(board.id);
        files.toggleStar(board.id);
        logEvent(EV.FILES_STAR, { on, what: 'cluster' });
      } },
      ...(canEdit && onSetOpensAs ? [{
        id: 'opens-as',
        label: board.view === 'list' ? 'Open on the board by default' : 'Always open in Files',
        run: () => onSetOpensAs(board.id, board.view === 'list' ? 'canvas' : 'list'),
      }] : []),
    ],
  }), [expand, files, uploadsByBoard, dropEffect, onDropOnCluster, springOpen, springLeave, onSetOpensAs]);

  // ↑/↓ walk the rows of whichever part has focus (the clusters, or the
  // files), in the order they appear; the rows keep their own Enter, →/←, F2
  // and menu keys.
  const onListKeyDown = (e) => {
    // Typing in a box inside a row (renaming a cluster) is the box's business:
    // an arrow there moves the caret, and moving focus would commit the
    // half-typed name on blur.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((selected.size || selecting) && e.key === 'Escape') { e.preventDefault(); clearSelection(); return; }
    if (selected.size && (e.key === 'Backspace' || e.key === 'Delete') && e.target.closest?.('[data-sb-item]')) {
      e.preventDefault(); deleteSelection('key'); return;
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
  // The search's last settled shape, kept until it ends (endSearch above).
  const resultsN = (contents.shelves || []).reduce((sum, sh) => sum + (Number(sh.total) || sh.items?.length || 0), 0);
  useEffect(() => {
    const q = query.trim();
    if (!q) { endSearch('cleared'); return; }
    if (!contents.loading) searchStat.current = { q_len: q.length, results_n: resultsN, view };
  }, [query, contents.loading, resultsN, view, endSearch]);
  useEffect(() => () => endSearch('left'), [endSearch]);
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
      const effect = dropEffect(e, shownId, 'files');
      if (!effect) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = effect; } catch (_) { /* read-only in some browsers */ }
      if (!dropping) setDropping(true);
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); },
    onDrop: (e) => {
      setDropping(false);
      if (!dropEffect(e, shownId, 'files')) return;
      e.preventDefault();
      onDropOnCluster(shownId, e);
    },
  } : {};

  // Folded, however it came (Hide, ⌘\, ⌘K): no menu left open over nothing,
  // no selection waiting to come back with Show.
  useEffect(() => {
    if (!folded) return;
    setMenuOpen(false);
    dropSwitch();
    setFileMenu(null);
    clearSelection();
  }, [folded, clearSelection, dropSwitch]);

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

      <div className={`sbf-card is-files${folded ? ' is-folded' : ''}${pageFold ? ' is-page-fold' : ''}`} ref={filesCardRef}
           onFocus={() => { focusInFiles.current = true; }}
           onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) focusInFiles.current = false; }}>
      {folded && (pageFold ? (
        <button type="button" className="sbf-files-bar is-page" ref={showRef}
                aria-label="Shrink Files back into the sidebar" title="Shrink Files back into the sidebar (F)"
                onClick={() => onShrinkPage?.('sidebar_fold')}>
          <span className="sbf-files-heading-label">Files</span>
          <span className="sbf-files-note">full screen</span>
          <span className="sbf-files-show is-shrink" aria-hidden="true"><Icon as={ArrowsInSimple} size={12} weight="regular" />Shrink</span>
        </button>
      ) : (
        <button type="button" className="sbf-files-bar" ref={showRef} aria-label="Show files" title="Show files (⌘\)"
                aria-expanded="false" onClick={() => setFilesHidden(false, 'hide')}>
          <span className="sbf-files-heading-label">Files</span>
          <span className="sbf-files-show" aria-hidden="true">Show</span>
        </button>
      ))}
      <section className={`sbf-files${dropping ? ' is-dropping' : ''}`} aria-label={`Files: ${title}`} {...sectionDrop}
               {...(view === 'cluster' && shownId ? { 'data-drop-board': shownId, 'data-drop-where': 'files' } : {})}>
        {floating && onLayout && (
          <div className="sbf-files-heading">
            <span className="sbf-files-heading-label">Files</span>
            <button type="button" className="sbf-files-hide" ref={hideRef} aria-label="Hide files" title="Hide files (⌘\)"
                    aria-expanded="true" onClick={() => setFilesHidden(true, 'show')}>Hide</button>
          </div>
        )}
        <header className="sbf-files-head">
          <div className="sbf-tabs" role="tablist" aria-label="Show files from" onKeyDown={onTabsKeyDown} ref={tabsRef}>
            {tabs.map((t) => {
              const on = view === t.id;
              const isCluster = t.id === 'cluster';
              return (
                <button type="button" key={t.id} role="tab" id={`${tabsId}-${t.id}`}
                        ref={isCluster ? clusterTabRef : undefined}
                        aria-selected={on} aria-controls={`${tabsId}-panel`} tabIndex={on ? 0 : -1}
                        {...(isCluster ? { 'aria-haspopup': 'dialog', 'aria-expanded': switchOpen && !switchClosing } : {})}
                        className={`sbf-tab${isCluster ? ' is-cluster' : ''}${on ? ' is-on' : ''}${isCluster && switchOpen && !switchClosing ? ' is-open' : ''}`}
                        title={isCluster ? (on ? `${t.label} · press to see another cluster’s files` : t.label) : undefined}
                        onClick={() => {
                          if (!on) { t.select(); return; }
                          if (isCluster) { if (switchOpen && !switchClosing) closeSwitch(); else openSwitch(); }
                        }}>
                  <span className="sbf-tab-label">{t.label}</span>
                  {isCluster && <span className="sbf-tab-caret" aria-hidden="true"><Icon as={ChevronDown} size={10} weight="regular" /></span>}
                </button>
              );
            })}
          </div>
          {floating && onLayout && (coarse || snug) && (
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

        {away && (
          <div className="sbf-away">
            <button type="button" className="sbf-away-btn" onClick={() => setBrowseId(null)} title={`Back to ${nameOf(clusterId)}’s files`}>
              <Icon as={ChevronLeft} size={11} weight="regular" />Back to {nameOf(clusterId)}
            </button>
            <button type="button" className="sbf-away-btn is-open" onClick={() => onOpenBoard?.(picked)} title={`Open ${clusterBoard?.name || 'Untitled'} on the board`}>
              Open {clusterBoard?.name || 'Untitled'}
            </button>
          </div>
        )}

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
                     if (e.key === 'Enter' && (nothing || e.metaKey || e.ctrlKey)) { e.preventDefault(); endSearch('palette'); onOpenPalette?.(query); }
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
          {/* While the import that made this cluster waits for room: how many, why, and the tray's step. */}
          {view === 'cluster' && <ImportWaitRow boardId={shownId} name={shownBoard?.name} />}
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
              checks={selecting}
              // A hold opens the menu: on a touch screen it can't start a drag too.
              onDragItem={coarse && touchPass ? null : onDragItem}
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

        {(selected.size > 0 || selecting) && (
          <div className="sbf-bulk" role="toolbar" aria-label="Selected files">
            <span className="sbf-bulk-count">{selected.size || !selecting ? `${selected.size} selected` : 'Select files'}</span>
            {selecting
              ? <button type="button" className="sbf-bulk-btn is-done" onClick={clearSelection}>Done</button>
              : <button type="button" className="sbf-bulk-btn is-clear" aria-label="Clear selection" onClick={clearSelection}>✕</button>}
            {selected.size > 0 && <div className="sbf-bulk-acts">
              {onPutOnBoard && waitingSel.length > 0 && movable(waitingSel) && <button type="button" className="sbf-bulk-btn is-lead" onClick={putSelection}>Put on board</button>}
              {onPickCluster && movable(selItems) && <button type="button" className="sbf-bulk-btn" onClick={moveSelection}>Move…</button>}
              {onPickCluster && <button type="button" className="sbf-bulk-btn" onClick={copySelection}>Copy…</button>}
              <button type="button" className="sbf-bulk-btn is-danger" onClick={() => deleteSelection('bar')}>Delete</button>
            </div>}
          </div>
        )}
      </section>

      <SidebarMeter {...meterProps} onOpenPlan={onOpenPlan} onUpload={onUpload} onUploadFolder={onUploadFolder} onUploadZips={onUploadZips} />
      {foot}
      </div>
      </div>
      {floating && sizable && onLayout && (
        <SidebarHandles layout={layout} coarse={coarse} roomy={roomy} snug={snug} onLayout={onLayout}
                        frameRef={frameRef} treeRef={treeCardRef} filesRef={filesCardRef} navRef={navRef} />
      )}

      {switchOpen && createPortal(
        <ClusterSwitch list={boardList} rootId={rootId} shownId={tabClusterId} boardId={activeBoardId || null}
                       sheet={!floating} focusList={coarse} closing={switchClosing}
                       tabsRef={tabsRef} cardRef={filesCardRef}
                       onPick={pickCluster} onClose={closeSwitch} />,
        document.body,
      )}
      <DragLabel resolve={resolveDrop} />
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
