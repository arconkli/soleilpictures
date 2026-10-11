import { lazy, Suspense, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, BOARD_REF_LIST_MIME, FILES_DRAG_MIME, readBoardRefIds, inboxItemToCard } from '../lib/dragMimes.js';
import { canDragFromFiles, buildFilesPayload, parseFilesPayload } from '../lib/filesDrag.js';
import { beginDragSession, onDragSession } from '../lib/springLoad.js';
import { useSpring } from '../hooks/useSpring.js';
import { invalidateBoardPreview } from '../hooks/useBoardPreview.js';
import { PathBar } from './clusterBrowser/PathBar.jsx';
import { gridNeighbor } from '../lib/justifiedGrid.js';
import { canRename, cleanName, renamePatch } from '../lib/fileRename.js';
import { planPutOnBoard, positionUnplaced } from '../lib/placement.js';
import { getViewCenter } from '../lib/viewCenter.js';
import { folderCap, readFoldersExpanded, writeFoldersExpanded } from '../lib/filesDock.js';
import { copyCardLink } from '../lib/cardLink.js';
import { composeMenuSections } from '../lib/contextMenuSections.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { createPortal } from 'react-dom';
import { isStillUploading } from '../lib/abandonedUploads.js';
import { wouldCreateCycle, collectDescendantIds } from '../lib/boardTree.js';
import { useFeedback } from './AppFeedback.jsx';
import { setActivePane, getActivePane } from '../lib/activePane.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { undoToast } from '../lib/undoToast.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { toListItem, sortItems, filterItems, matchItems } from '../lib/listItem.js';
import { defaultFilesLayout, readFilesLayout, writeFilesLayout } from '../lib/filesLayout.js';
import { formatDuration } from '../lib/loopMeta.js';
import { searchEntities } from '../lib/entitySearch.js';
import { getMeta, primeImageMetaForBoard } from '../lib/imageMeta.js';
import { usePeerSelections } from '../hooks/usePeerSelections.js';
import { ClusterBrowserToolbar } from './clusterBrowser/ClusterBrowserToolbar.jsx';
import { FolderTile } from './clusterBrowser/FolderTiles.jsx';
import { ClusterTable } from './clusterBrowser/ClusterTable.jsx';
import { JustifiedGallery } from './clusterBrowser/JustifiedGallery.jsx';
import { readTileSize, writeTileSize } from '../lib/justifiedGrid.js';
import { DetailPanel } from './clusterBrowser/DetailPanel.jsx';
import { openInfo, closeInfo, reportSelection, clearSelection, inInfoDrawer } from '../lib/infoBus.js';

// Quick look ships in its own chunk: most visits to Files never open it.
// Files' scroll position per cluster (and size of Files), for this session.
const SCROLL_MEMORY = new Map();

const QuickLook = lazy(() => import('./clusterBrowser/QuickLook.jsx'));

// Info (the detail panel) is opt-in — ⌘I or Info — and the choice is this
// device's. It used to open on every single-item selection.
const INFO_KEY = 'soleil.files.info';
function readInfoPref() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(INFO_KEY) === '1'; } catch (_) { return false; }
}
function writeInfoPref(on) {
  try { localStorage.setItem(INFO_KEY, on ? '1' : '0'); } catch (_) {}
}
import { groupGridFamilies } from '../lib/gridFamilies.js';
import * as audioBus from '../lib/audioBus.js';
import { addVersionFromFile, pickVersionFile } from '../lib/versionActions.js';
import { canVersion, liveVersions } from '../lib/cardVersions.js';
import { kindFromMime, canBeVersionOf } from '../lib/versionUpload.js';
import { uploadContext } from '../lib/uploadContext.js';
import { resolveSrc } from '../lib/r2.js';
import { Icon } from './Icon.jsx';
import { Download, ArrowBendUpRight, ArrowsInSimple, Trash2, X, Plus, Link as LinkIcon, Info, BoundingBox, ChevronDown, ChevronUp, Upload } from '../lib/icons.js';
import {
  DOWNLOADABLE, downloadCardAsset, downloadCardAssets, zipNameFor, bulkDownloadSupported,
  AssetFetchError,
} from '../lib/cardDownload.js';

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
  // Drop / picked OS files → into the cluster, waiting in Files off the board.
  onDropFilesToCluster,
  // Set of card ids just added via a list drop — flashes those rows.
  recentlyAddedIds,
  // Live presence: awareness handle + identity for per-row highlight.
  getAwareness, workspaceId, selfId,
  // Shared grid layouts (id → { layout }) so a linked Grid's preview resolves.
  gridTemplates = {},
  // Live grid resolver (readGridModel over the Y.Doc) → real cell content in the
  // grid preview + detail. Absent in the ?local harness (falls back to schematic).
  getGridModel = null,
  // Reveal a card on the canvas (selects + frames it), used by the detail popout.
  onRevealOnCanvas = null,
  // Files beside the board: a plain click on a file finds it on the board.
  onLocateOnBoard = null,
  // Browsing another cluster: ids of its files this board already shows.
  onBoardIds = null,
  // ({ placeholder, excludeIds }) => Promise<board|null> — "Move to…".
  onPickCluster = null,
  // { ids, token } — pick out files that aren't on the board (App.revealInFiles).
  revealRequest = null,
  onRevealDone = null,   // (token) => the shell forgets the request once shown
  // Quiet "Any file, any size — Creator" toolbar nudge for free workspace
  // owners; opens the storage upgrade modal. Off in the ?local harness.
  showStorageUpsell = false,
  onStorageUpsell = null,
  // Split-pane shortcut arbitration — see lib/activePane.js. Without the
  // gate, the window keydown below deleted from BOTH panes on one Backspace.
  paneId = 'main',
  hasSplit = false,
  // 'full' — Files fills the pane; 'panel' — docked beside the board
  // (components/FilesDock.jsx): compact header, folders as compact tiles, no
  // side detail panel, and double-click flies the board to the card.
  mode = 'full',
  // { canShrink, onExpand, onShrink, onClose } — the ⤢ ⤡ × controls of the
  // dock, from the shell that owns the mode. Null in the split pane / harness.
  dockControls = null,
  // The panel's path bar (FilesPane): { path, boards, onNavigate, onBack,
  // canBack, onGoTo }. Absent in full Files, where the topbar breadcrumb rules.
  pathBar = null,
  // Set when the panel is browsing a cluster other than the board's own (a
  // read-only snapshot) — the board it came from.
  browsingFrom = null,
  // A browsed cluster whose snapshot hasn't arrived — not "no files" yet.
  loading = false,
  // The board this Files belongs to — its live cards and mutators — kept when
  // browsing another cluster replaces board/cards/mutators. After a drag has
  // sprung into another cluster, a drop moves the files from here.
  homeSrc = null,       // { boardId, cards, mutators, canEdit }
  // Spring-loading from FilesPane: { into(id), back(), drop(promise) }.
  spring = null,
  // Full Files: the way back up (PathBar trail), above the title.
  fullPathBar = null,
}) {
  const feedback = useFeedback();
  const isPanel = mode === 'panel';
  const subBoards = childBoards || [];
  const linkedCards = (cards || []).filter(c => c.kind === 'boardlink');
  const otherCards = (cards || []).filter(c => c.kind !== 'board' && c.kind !== 'boardlink');

  // Folders beside the board: one section (sub-clusters, then linked ones),
  // two rows of them until Show all — the files are what the panel is for, so
  // they start on the first screen (lib/filesDock.js folderCap).
  const ftGridRef = useRef(null);
  const [ftWidth, setFtWidth] = useState(0);
  const [foldersOpen, setFoldersOpen] = useState(() => readFoldersExpanded());
  const folderCount = subBoards.length + linkedCards.length;
  const hasFolders = folderCount > 0;
  useLayoutEffect(() => {
    const el = ftGridRef.current;
    if (!isPanel || !el) return undefined;
    setFtWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect?.width;
      if (Number.isFinite(w)) setFtWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isPanel, hasFolders]);
  const folderCapN = folderCap(folderCount, ftWidth);
  const folderShown = isPanel && !foldersOpen ? folderCapN : folderCount;
  const toggleFolders = () => setFoldersOpen((v) => { writeFoldersExpanded(!v); return !v; });

  // Where each cluster's Files was scrolled to, this session: Back, or coming
  // back to a cluster, returns to the same place; a cluster seen for the
  // first time starts at the top. A reveal does its own scrolling.
  //
  // The list may still be filling in when we arrive (a browsed cluster's
  // snapshot, images finding their height), so the target is held and
  // re-applied as the content grows — until it's reached, or the person
  // scrolls themselves. Positions are only remembered once nothing is
  // pending, so a half-laid-out list can't overwrite the real place.
  const listWrapRef = useRef(null);
  const listInnerRef = useRef(null);
  const scrollKey = `${isPanel ? 'p' : 'f'}:${board?.id}`;
  useLayoutEffect(() => {
    const el = listWrapRef.current;
    if (!el) return undefined;
    const saved = revealRequest?.token ? 0 : (SCROLL_MEMORY.get(scrollKey) || 0);
    let pending = saved > 0;
    if (!revealRequest?.token) el.scrollTop = saved;
    const settle = () => { pending = false; };
    const apply = () => {
      if (!pending) return;
      el.scrollTop = saved;
      if (Math.abs(el.scrollTop - saved) < 2) settle();
    };
    const onScroll = () => { if (!pending) SCROLL_MEMORY.set(scrollKey, el.scrollTop); };
    const userInput = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    el.addEventListener('scroll', onScroll, { passive: true });
    userInput.forEach((t) => el.addEventListener(t, settle, { passive: true }));
    const ro = typeof ResizeObserver !== 'undefined' && listInnerRef.current ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(listInnerRef.current);
    // And every frame while pending: the grid can finish laying out without
    // .list-inner itself resizing in a way the observer reports.
    let raf = 0;
    const tick = () => { apply(); if (pending) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const give = setTimeout(settle, 4000);   // a list that never gets tall enough
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(give);
      ro?.disconnect();
      el.removeEventListener('scroll', onScroll);
      userInput.forEach((t) => el.removeEventListener(t, settle));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  // The sticky header gets its edge only once something has scrolled under it.
  const headSentinelRef = useRef(null);
  const [headStuck, setHeadStuck] = useState(false);

  // ── Cluster browser state (persisted per session) ──────────────────────────
  const prefs0 = readBrowserPrefs();
  // Grid / List chosen this session, per cluster (the component is not keyed
  // by board, so the choice is looked up by id rather than held as one value).
  const [layoutChoice, setLayoutChoice] = useState({});
  const [query, setQuery] = useState('');
  // Board order (the canvas, read like a page) until someone picks a sort.
  const [sortKey, setSortKey] = useState(prefs0.sortKey || 'board');
  const [sortDir, setSortDir] = useState(prefs0.sortKey ? (prefs0.sortDir || 'desc') : 'asc');
  const [filters, setFilters] = useState(() => new Set());
  // A search or filter belongs to the cluster it was typed in — stepping into a
  // folder used to carry it along and could hide every file there.
  // "Not on board": files in the cluster that aren't on its board yet.
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  useEffect(() => { setQuery(''); setFilters(new Set()); setUnplacedOnly(false); }, [board?.id]);
  // Which linked-grid families are expanded (collapsed by default). Persisted.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(prefs0.expandedGroups || []));
  // A grid family selected for the detail popout (family view). Card selection
  // lives in selectedCards below; these two are mutually exclusive.
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const addInputRef = useRef(null);

  // Prime image/media metadata once per cluster so thumbnails paint instantly
  // and media Size can resolve.
  useEffect(() => { if (board?.id) primeImageMetaForBoard(board.id); }, [board?.id]);

  // List-mode adoption signal (once per board per session; the feature shipped
  // dark — this is how we learn whether the browser correlates with retention).
  useEffect(() => {
    if (!board?.id) return;
    try {
      logEventOnce(`list_browser_view:${board.id}`, EV.LIST_BROWSER_VIEW, {
        board_id: board.id, files: otherCards.length, subclusters: subBoards.length,
      });
    } catch (_) {}
    // Counts are a snapshot at first render of this board's list — good enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  // Normalize the non-folder cards into uniform ListItems. Depends on the raw
  // card fields + primed meta (getMeta is a stable module accessor).
  const items = useMemo(
    () => otherCards.map(c => {
      const it = toListItem(c, { boards, getMeta, boardId: board.id, gridTemplates });
      // For a grid, swap the abstract schematic for its REAL cell content when
      // the live resolver is available (App threads getGridModel; the ?local
      // harness doesn't, so it keeps the schematic).
      if (it && c.kind === 'grid' && getGridModel) {
        const model = getGridModel(c);
        if (model && model.layout) it.preview = { mode: 'grid', model };
      }
      return it;
    }).filter(Boolean),
    [otherCards, boards, board.id, gridTemplates, getGridModel]
  );

  // Grid or List: this session's pick for the cluster, else what this device
  // remembers for it, else Grid (List for a mostly-audio pack).
  // The default is decided once per cluster, the first time it has contents,
  // so a card added or deleted later never swaps the layout under you.
  const savedLayout = useMemo(() => readFilesLayout(board?.id), [board?.id, layoutChoice]);
  const openedLayoutRef = useRef({});
  if (board?.id && items.length && !openedLayoutRef.current[board.id]) {
    openedLayoutRef.current[board.id] = defaultFilesLayout(items);
  }
  const viewMode = layoutChoice[board?.id] || savedLayout
    || openedLayoutRef.current[board?.id] || defaultFilesLayout(items);
  // Grid tile size — this device's, for every cluster.
  const [tileSize, setTileSize] = useState(() => readTileSize());
  const onTileSize = useCallback((k) => { setTileSize(k); writeTileSize(k); }, []);

  // Available filter buckets (with counts) present in this cluster.
  const availableBuckets = useMemo(() => {
    const counts = new Map();
    for (const it of items) counts.set(it.typeBucket, (counts.get(it.typeBucket) || 0) + 1);
    return BUCKET_ORDER.filter(k => counts.has(k)).map(k => ({ key: k, label: BUCKET_LABELS[k] || k, count: counts.get(k) }));
  }, [items]);

  // Search → filter → sort pipeline (all pure).
  const visibleItems = useMemo(
    () => sortItems(filterItems(matchItems(items, query), filters, { unplacedOnly }), sortKey, sortDir),
    [items, query, filters, unplacedOnly, sortKey, sortDir]
  );
  const unplacedTotal = useMemo(() => items.filter((it) => it.unplaced).length, [items]);
  useEffect(() => { if (unplacedOnly && !unplacedTotal) setUnplacedOnly(false); }, [unplacedOnly, unplacedTotal]);

  // Collapse linked-grid families into expandable group nodes (tens of grids →
  // a few rows). Pure; members render only when their family is expanded.
  const displayItems = useMemo(
    () => groupGridFamilies(visibleItems, { gridTemplates }),
    [visibleItems, gridTemplates]
  );
  const onToggleGroup = useCallback((groupId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      writeBrowserPrefs({ expandedGroups: [...next] });
      return next;
    });
  }, []);

  // Loop-browser columns: Time / BPM / Key / Format in place of Type + Size.
  //
  // A MODE rather than four permanent columns, because a cluster of notes and
  // images must not grow four empty ones. Majority-audio is the trigger, which
  // is automatically true when the Audio type filter is on and true by default
  // for an actual sample pack.
  const audioMode = useMemo(() => {
    if (!visibleItems.length) return false;
    const n = visibleItems.reduce((acc, it) => acc + (it.kind === 'audio' ? 1 : 0), 0);
    return n / visibleItems.length >= 0.5;
  }, [visibleItems]);

  // A sort key that only exists in audio mode must not survive leaving it, or
  // the table sorts by a column nobody can see.
  useEffect(() => {
    if (!audioMode && ['duration', 'bpm', 'key', 'format'].includes(sortKey)) {
      setSortKey('board');
      setSortDir('asc');
      writeBrowserPrefs({ sortKey: 'board', sortDir: 'asc' });
    }
  }, [audioMode, sortKey]);

  // A one-line read on the pack, assembled from the rows already on screen:
  // how many, what tempo range, how much material. It follows the search and
  // the filters, so narrowing to 128 BPM re-reads the selection you are looking
  // at rather than the whole cluster. Only in loop-browser mode — it is what a
  // producer opens a pack wanting to know, and it is noise on a cluster of
  // notes.
  const packSummary = useMemo(() => {
    if (!audioMode) return null;
    const audio = visibleItems.filter(it => it.kind === 'audio');
    if (!audio.length) return null;
    const parts = [`${audio.length} audio ${audio.length === 1 ? 'file' : 'files'}`];
    const bpms = audio.map(it => it.bpm).filter(n => Number.isFinite(n));
    if (bpms.length) {
      const lo = Math.min(...bpms);
      const hi = Math.max(...bpms);
      parts.push(lo === hi ? `${lo} BPM` : `${lo}–${hi} BPM`);
    }
    const secs = audio.reduce((a, it) => a + (Number.isFinite(it.durationSec) ? it.durationSec : 0), 0);
    if (secs > 0) parts.push(`${formatDuration(secs)} total`);
    return parts.join(' · ');
  }, [audioMode, visibleItems]);

  // ── Auditioning ───────────────────────────────────────────────────────────
  //
  // The rows a keyboard cursor can land on, in the order they are on screen:
  // group headers plus the members of EXPANDED families, inlined, so index ↔
  // row is 1:1 and a cursor never points at a row that isn't rendered.
  const navItems = useMemo(() => {
    const out = [];
    for (const it of displayItems) {
      out.push(it);
      if (it.isGroup && expandedGroups.has(it.id)) out.push(...(it.members || []));
    }
    return out;
  }, [displayItems, expandedGroups]);

  // Cursor for ↑/↓ and Space. Separate from SELECTION: moving through a pack
  // auditioning it should not be building a forty-item selection you then have
  // to clear.
  const [activeId, setActiveId] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  // Quick look: the file it's showing (null when closed), over the files in
  // the order Files shows them.
  const [quickId, setQuickId] = useState(null);
  const quickItems = useMemo(() => navItems.filter((it) => !it.isGroup), [navItems]);
  const quickIndex = quickId ? quickItems.findIndex((it) => it.id === quickId) : -1;
  useEffect(() => { if (quickId && quickIndex < 0) setQuickId(null); }, [quickId, quickIndex]);
  useEffect(() => { setQuickId(null); }, [board.id]);
  // Inline rename: the file or folder whose name is a field right now.
  const [renamingId, setRenamingId] = useState(null);
  // Right-click menu: { x, y } — it acts on the selection.
  const [ctxMenu, setCtxMenu] = useState(null);
  useEffect(() => { setRenamingId(null); setCtxMenu(null); }, [board.id]);
  const [infoOpen, setInfoOpen] = useState(() => readInfoPref());
  const toggleInfo = useCallback(() => setInfoOpen((v) => { writeInfoPref(!v); return !v; }), []);

  // Re-sorting or filtering strands the cursor on a row that has moved or gone.
  useEffect(() => {
    if (activeId && !navItems.some(it => it.id === activeId)) setActiveId(null);
  }, [navItems, activeId]);
  useEffect(() => { setActiveId(null); }, [board.id]);

  // Keep the keyboard cursor on screen. A ref per row rather than a query
  // selector so this survives the rows re-ordering under a sort.
  const rowRefs = useRef(new Map());
  const registerRow = useCallback((id) => (el) => {
    if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id);
  }, []);
  useEffect(() => {
    if (!activeId) return;
    rowRefs.current.get(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  // ONE <audio> element for the whole list, re-pointed as you move through the
  // pack — not a mounted AudioCard per row. A row renders a CardPreview, not a
  // card, so there is no transport to drive; and mounting 400 media elements to
  // give every row a play button would be absurd. This is also how auditioning
  // actually works: you are listening to one thing at a time.
  //
  // It still goes through audioBus.claim, so the one-at-a-time rule holds
  // ACROSS surfaces — starting a row stops a canvas card in the other pane.
  const audioElRef = useRef(null);
  // Written SYNCHRONOUSLY when playback starts, not derived from `playingId`.
  //
  // At natural end the spec fires `pause` BEFORE `ended`. A ref synced from
  // state through an effect was therefore already null by the time `ended`
  // ran — so auto-advance had no card id to advance FROM and silently did
  // nothing. `playingId` stays the render signal; this is the record.
  const playingIdRef = useRef(null);

  // Handed to the bus so a canvas card starting up can stop us. Declared
  // BEFORE auditionCard, which closes over it.
  // The playhead is written straight onto the row's DOM node as a custom
  // property rather than through state: `timeupdate` fires about four times a
  // second, and a four-hundred-row pack must not re-render on every tick.
  const setRowProgress = useCallback((id, value) => {
    const node = id && rowRefs.current.get(id);
    if (!node) return;
    if (value == null) node.style.removeProperty('--ct-progress');
    else node.style.setProperty('--ct-progress', String(value));
  }, []);

  const stopAudition = useCallback(() => {
    setRowProgress(playingIdRef.current, null);
    playingIdRef.current = null;
    try { audioElRef.current?.pause(); } catch (_) {}
    setPlayingId(null);
  }, [setRowProgress]);

  // Another cluster (a folder opened, a breadcrumb, the panel browsing) stops
  // what's sounding. This component outlives the move, so the <audio> did
  // too — playing on with no row to show it and no pause to reach.
  useEffect(() => {
    stopAudition();
    audioBus.release(stopAudition);
  }, [board.id, stopAudition]);

  const auditionCard = useCallback(async (id) => {
    const it = items.find(x => x.id === id);
    const src = it?.card?.src;
    if (!src) return false;
    let el = audioElRef.current;
    if (!el) {
      el = new Audio();
      el.preload = 'metadata';
      el.setAttribute('data-list-audio', '');
      // In the document rather than floating: a detached media element is
      // invisible to the browser's media session (so hardware play/pause keys
      // do nothing), and it is unreachable from a test that needs to drive it
      // to the end rather than wait out a real file in real time.
      el.style.display = 'none';
      document.body.appendChild(el);
      audioElRef.current = el;
      el.addEventListener('timeupdate', () => {
        const id = playingIdRef.current;
        if (!id) return;
        const d = el.duration;
        setRowProgress(id, Number.isFinite(d) && d > 0 ? Math.min(1, el.currentTime / d) : 0);
      });
      el.addEventListener('ended', () => {
        const ended = playingIdRef.current;
        setRowProgress(ended, null);
        playingIdRef.current = null;
        setPlayingId(null);
        audioBus.release(stopAudition);
        // Guard the zero-length case: a file that fires `ended` instantly
        // would otherwise run auto-advance through a whole pack in a blink.
        if (ended && (el.currentTime || el.duration || 0) >= 0.05) audioBus.notifyEnded(ended, 'list');
      });
      // Render signal only. The ref is cleared by `ended` and by stopAudition,
      // never here — `pause` arrives first at a natural end.
      el.addEventListener('pause', () => setPlayingId(null));
    }
    if (playingIdRef.current === id && !el.paused) { playingIdRef.current = null; el.pause(); return true; }
    const url = await resolveSrc(src);
    if (!url) return false;
    if (el.src !== url) el.src = url;
    // Rewind explicitly. Reusing the element means the playhead is wherever the
    // last clip left it, and on auto-advance that is the END — so a second row
    // pointing at the same file would start at its own ending and fire `ended`
    // again immediately, running through a whole pack in a blink. Setting src
    // does this implicitly; a repeat src does not.
    try { el.currentTime = 0; } catch (_) {}
    audioBus.claim(stopAudition, { cardId: id, source: 'list' });
    try {
      await el.play();
      playingIdRef.current = id;
      setPlayingId(id);
    } catch (_) { playingIdRef.current = null; setPlayingId(null); return false; }
    return true;
  }, [items, stopAudition]);


  // Scrub the sounding row by clicking along its waveform. A waveform a
  // producer can see but not aim at is a picture; the whole reason it is drawn
  // from the real file is so the transient you are looking for is somewhere
  // you can point at.
  //
  // ClusterRow only wires this up for the row that is actually playing (see
  // the note there), but the not-playing branch is kept honest anyway: a seek
  // that arrives for a stopped row starts it at that point, which is what the
  // gesture means.
  const seekCard = useCallback(async (it, fraction) => {
    const el = audioElRef.current;
    const at = (media) => {
      const d = media?.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      try { media.currentTime = Math.min(d - 0.01, Math.max(0, d * fraction)); } catch (_) {}
      setRowProgress(it.id, fraction);
    };
    if (playingIdRef.current === it.id && el) { at(el); return; }
    setActiveId(it.id);
    if (await auditionCard(it.id)) at(audioElRef.current);
  }, [auditionCard, setRowProgress]);

  // Leaving list view must not leave a loop playing from nowhere.
  useEffect(() => () => {
    try { audioElRef.current?.pause(); } catch (_) {}
    try { audioElRef.current?.remove(); } catch (_) {}
    audioElRef.current = null;
    audioBus.release(stopAudition);
  }, [stopAudition]);

  // Auto-advance. This is the thing that turns the list into a loop browser:
  // start one and the pack plays through, cursor following, until you stop it.
  //
  // Gated on source === 'list' so a clip started by clicking a card on the
  // canvas never makes the list jump — the person is not looking at the list.
  useEffect(() => audioBus.onEnded(({ cardId, source }) => {
    if (source !== 'list') return;
    const order = navItems.filter(it => it.kind === 'audio');
    const i = order.findIndex(it => it.id === cardId);
    const next = i >= 0 ? order[i + 1] : null;
    if (!next) return;   // stop at the end; no wrap
    setActiveId(next.id);
    auditionCard(next.id);
  }), [navItems, auditionCard]);

  // Live per-row presence (which cards peers currently have open), scoped to
  // this cluster + descendants.
  const descendantIds = useMemo(() => collectDescendantIds(boards, board.id), [boards, board.id]);
  const peerMap = usePeerSelections({ getAwareness, boardId: board.id, descendantIds, selfId });
  const facePeers = peersHereByBoard?.get?.(board.id) || [];

  const onSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        // Write the key too: the default (board order) is never written on
        // its own, and a direction without a key is ignored on remount.
        setSortDir(d => { const nd = d === 'asc' ? 'desc' : 'asc'; writeBrowserPrefs({ sortKey: prev, sortDir: nd }); return nd; });
        return prev;
      }
      // New key: sensible default direction — board order/name/type asc,
      // size/date desc.
      const nd = (key === 'board' || key === 'name' || key === 'type') ? 'asc' : 'desc';
      setSortDir(nd);
      writeBrowserPrefs({ sortKey: key, sortDir: nd });
      return key;
    });
  }, []);
  const onViewMode = useCallback((m) => {
    if (!board?.id) return;
    setLayoutChoice(prev => ({ ...prev, [board.id]: m }));
    writeFilesLayout(board.id, m);
  }, [board?.id]);
  const onToggleFilter = useCallback((bucket) => {
    setFilters(prev => { const next = new Set(prev); if (next.has(bucket)) next.delete(bucket); else next.add(bucket); return next; });
  }, []);
  const onClearFilters = useCallback(() => { setFilters(new Set()); setUnplacedOnly(false); }, []);
  const openAddPicker = useCallback(() => addInputRef.current?.click(), []);

  // The phone's bottom-nav "+" asks the board to add a card — but full Files
  // has no board mounted, so the puck did nothing here. Here it adds files.
  // (Beside the board the canvas is mounted and answers it itself.) The event
  // is dispatched inside the tap, so the picker still opens as a user gesture.
  useEffect(() => {
    if (isPanel || !canEdit || browsingFrom || paneId !== 'main') return undefined;
    const onAdd = (e) => {
      if (e.detail?.boardId !== board?.id) return;
      if (document.body.dataset.tourActive === '1') return;   // guided tour owns input
      openAddPicker();
    };
    document.addEventListener('soleil-mobile-add-card', onAdd);
    return () => document.removeEventListener('soleil-mobile-add-card', onAdd);
  }, [isPanel, canEdit, browsingFrom, paneId, board?.id, openAddPicker]);

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
          .map(r => ({ id: r.card_id || r.id, name: r.title || r.meta?.fileName || 'Untitled', kind: r.kind, boardId: r.board_id, clusterName: boards[r.board_id]?.name || 'Sub-cluster' }));
        setDescHits(hits);
      } catch (_) { if (!cancelled) setDescHits([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, workspaceId, descendantIds.join(','), boards]);

  // Selection — strings: board ids and card ids share an id namespace.
  const [selectedBoards, setSelectedBoards] = useState(() => new Set());
  const [selectedCards, setSelectedCards] = useState(() => new Set());

  // Info: beside the list in full Files; the app's Info drawer from the panel
  // docked beside the board, which has no room for a split (lib/infoBus.js).
  // A cluster Files is only browsing isn't open in any pane, so its cards ride
  // along for the drawer to describe.
  const infoFollow = `files:${paneId}`;
  const browsedCards = browsingFrom ? cards : null;
  useEffect(() => {
    reportSelection(infoFollow, board.id, [...selectedCards], { clusterIds: [...selectedBoards], cards: browsedCards });
  }, [infoFollow, board.id, selectedCards, selectedBoards, browsedCards]);
  const showInfo = useCallback((req = null) => {
    // Full screen has its own Info beside the list; a drawer left open from
    // the board would sit on top of it.
    if (!isPanel) { closeInfo(); toggleInfo(); return; }
    openInfo({ ...(req || { boardId: board.id }), follow: infoFollow, toggle: !req, cards: req?.clusterId ? null : browsedCards });
  }, [isPanel, toggleInfo, board.id, infoFollow, browsedCards]);
  useEffect(() => () => { closeInfo({ follow: infoFollow }); clearSelection(infoFollow); }, [infoFollow]);

  // Reset selection on board switch.
  useEffect(() => {
    setSelectedBoards(new Set());
    setSelectedCards(new Set());
    setSelectedGroupId(null);
  }, [board.id]);

  // Asked to show files that aren't on the board (a link, a search hit, Show
  // on board): clear whatever would hide them, select them and bring the
  // first into view. No ids = just Files, filtered to what's not on the board.
  // Declared AFTER the board-change resets on purpose: when Files opens (or
  // steps home) for the request, those run in the same pass and would wipe
  // the selection this makes. Reported done, so it isn't replayed when Files
  // comes back.
  useEffect(() => {
    if (!revealRequest?.token) return;
    const ids = (revealRequest.ids || []).filter((id) => items.some((it) => it.id === id));
    setQuery('');
    setFilters(new Set());
    if (!ids.length) {
      setUnplacedOnly(items.some((it) => it.unplaced));
      if (listWrapRef.current) listWrapRef.current.scrollTop = 0;
    } else {
      setUnplacedOnly(false);
      setSelectedCards(new Set(ids));
      setSelectedBoards(new Set());
      setSelectedGroupId(null);
      setActiveId(ids[0]);
    }
    onRevealDone?.(revealRequest.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest?.token]);

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

  // Shift-click anchor. Shift used to be lumped in with Cmd/Ctrl and simply
  // TOGGLED one item, which made "select these forty loops" forty clicks.
  const anchorRef = useRef({ kind: null, id: null });

  // Select every item between the anchor and `id` in the order currently on
  // screen — which is the sorted, filtered order, not the underlying one.
  const selectRange = useCallback((orderedIds, fromId, toId) => {
    const a = orderedIds.indexOf(fromId);
    const b = orderedIds.indexOf(toId);
    if (a < 0 || b < 0) return new Set([toId]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return new Set(orderedIds.slice(lo, hi + 1));
  }, []);

  const onTileClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    e.stopPropagation();
    setSelectedGroupId(null); // selecting an item exits any family view
    const additive = e.metaKey || e.ctrlKey;
    const ranged = e.shiftKey && anchorRef.current.kind === kind && anchorRef.current.id;
    if (kind === 'board') {
      if (ranged) {
        setSelectedBoards(prev => new Set([...prev, ...selectRange(subBoards.map(b => b.id), anchorRef.current.id, id)]));
        setSelectedCards(new Set());
        return;
      }
      if (additive) toggle(selectedBoards, setSelectedBoards, id, true);
      else { setSelectedBoards(new Set([id])); setSelectedCards(new Set()); }
    } else {
      if (ranged) {
        setSelectedCards(prev => new Set([...prev, ...selectRange(visibleItems.map(it => it.id), anchorRef.current.id, id)]));
        setSelectedBoards(new Set());
        return;
      }
      if (additive) toggle(selectedCards, setSelectedCards, id, true);
      else {
        setSelectedCards(new Set([id])); setSelectedBoards(new Set());
        // Find it on the board — unless it isn't on the board.
        if (kind === 'file' && !items.find((it) => it.id === id)?.unplaced) onLocateOnBoard?.(id);
      }
    }
    // A plain or additive click moves the anchor; a range-select does not, so
    // you can keep widening the same range.
    anchorRef.current = { kind, id };
  };

  const onTileDoubleClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    if (kind === 'board') onOpenBoard(id);
    else if (kind === 'boardlink') {
      const c = (cards || []).find(c => c.id === id);
      if (c && boards[c.target]) onOpenBoard(c.target);
    } else {
      // A file: Quick look. (Finding it on the board is a single click beside
      // the board, and Quick look's Show on board.)
      setQuickId(id);
    }
  };

  // A grid family header: toggle its expansion AND select it for the detail
  // popout (family view).
  const onGroupClick = useCallback((e, groupId) => {
    e.stopPropagation();
    onToggleGroup(groupId);
    setSelectedGroupId(groupId);
    setSelectedCards(new Set());
    setSelectedBoards(new Set());
  }, [onToggleGroup]);

  // Delete from Info or Quick look — same undo-safe confirm as Backspace.
  // True when it deleted.
  const onDeleteItems = useCallback(async (ids) => {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return false;
    const ok = await feedback.confirm({
      title: 'Delete', danger: true, confirmLabel: 'Delete',
      message: list.length === 1 ? 'Delete this card?' : `Delete ${list.length} cards?`,
    });
    if (!ok) return false;
    const deleted = await mutators.deleteCards?.(list);
    setSelectedCards(new Set());
    setSelectedGroupId(null);
    // Same delete→Undo-toast affordance as the canvas (this path used to
    // rely on the user knowing Cmd+Z would work from list view).
    undoToast(feedback, {
      message: list.length === 1 ? 'Card deleted' : `${list.length} cards deleted`,
      undoManager: mutators.undoManager,
      stackItem: deleted?.stackItem || null,
      onUndo: () => mutators.undo?.(),
    });
    return true;
  }, [feedback, mutators]);

  // Delete what's selected — sub-clusters and cards — behind one confirm, with
  // undo. The key, the selection bar and the detail panel all come here.
  const deleteSelection = useCallback(async () => {
    if (!canEdit) return;
    const bIds = [...selectedBoards];
    const cIds = [...selectedCards];
    const total = bIds.length + cIds.length;
    if (!total) return;
    const bn = bIds.length;
    const cn = cIds.length;
    let msg;
    if (bn > 0 && cn === 0) msg = bn === 1
      ? `Delete cluster "${boards[bIds[0]]?.name || ''}" and all its content?\n\nYou can undo this — it's recoverable for 30 days.`
      : `Delete ${bn} clusters and all their content?\n\nYou can undo this — they're recoverable for 30 days.`;
    else if (bn === 0 && cn > 0) msg = cn === 1 ? 'Delete this card?' : `Delete ${cn} cards?`;
    else msg = `Delete ${total} items, including ${bn} cluster${bn > 1 ? 's' : ''}?\n\nYou can undo this — anything deleted is recoverable for 30 days.`;
    const ok = await feedback.confirm({
      title: 'Delete selection',
      message: msg,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (bIds.length) mutators.deleteBoardsById?.(bIds); // has its own Undo toast
    if (cIds.length) {
      const deleted = await mutators.deleteCards?.(cIds);
      undoToast(feedback, {
        message: cIds.length === 1 ? 'Card deleted' : `${cIds.length} cards deleted`,
        undoManager: mutators.undoManager,
        stackItem: deleted?.stackItem || null,
        onUndo: () => mutators.undo?.(),
      });
    }
    setSelectedBoards(new Set());
    setSelectedCards(new Set());
    setSelectedGroupId(null);
  }, [canEdit, selectedBoards, selectedCards, boards, feedback, mutators]);

  // Move cards out of this cluster into another one — "Move to…", and files
  // dropped on a folder. The cross-board move App already runs for the canvas
  // (its 'soleil-card-into-board-drop' listener) writes the target, then this
  // side lets go of only what it saved; its toast undoes both sides.
  // Moves cards into another cluster. `src` is where they come from — this
  // board, or (after a drag has sprung into another cluster) the home board.
  // Resolves whether anything moved.
  const moveCardsTo = useCallback(async (ids, targetId, src = null) => {
    const from = src || { boardId: board.id, cards, mutators, canEdit };
    if (!from.canEdit || !targetId || targetId === from.boardId) return false;
    const idSet = new Set(ids || []);
    const all = (from.cards || []).filter((c) => idSet.has(c.id) && c.kind !== 'board' && c.kind !== 'boardlink');
    const moving = all.filter((c) => !isStillUploading(c));
    if (moving.length < all.length) {
      feedback.toast({ type: 'info', ttl: 7000, message: 'Cards that are still uploading stayed where they were — move them once they have finished.' });
    }
    if (!moving.length) return false;
    try {
      await new Promise((resolve, reject) => {
        document.dispatchEvent(new CustomEvent('soleil-card-into-board-drop', {
          detail: { sourceBoardId: from.boardId, targetBoardId: targetId, cards: moving, onTargetSaved: resolve, onTargetFailed: reject, via: 'menu' },
        }));
      });
    } catch (_) { return false; } // App said why; nothing left this cluster
    from.mutators?.deleteCardsForMove?.(moving.map((c) => c.id));
    setSelectedCards(new Set());
    // A browsed cluster shows its saved snapshot: fetch it again with them in.
    try { invalidateBoardPreview(targetId); } catch (_) {}
    return true;
  }, [canEdit, board.id, cards, feedback, mutators]);

  // Put on board: files waiting in Files go onto the board as one block where
  // its canvas was last looking (lib/viewCenter.js), or beside its content.
  // One undo step. Beside the board, the board then brings them into view.
  const putOnBoard = useCallback((ids) => {
    if (!canEdit || mutators.captureGuarded) return;
    const plan = planPutOnBoard(cards, ids, getViewCenter(board.id));
    if (!plan.length) return;
    const um = mutators.undoManager;
    mutators.breakUndo?.();
    mutators.updateCards?.(plan);
    const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
    mutators.breakUndo?.();
    undoToast(feedback, {
      type: 'success',
      message: plan.length === 1 ? 'Put on the board' : `${plan.length} put on the board`,
      undoManager: um, stackItem: item,
      onUndo: () => mutators.undo?.(),
    });
    if (isPanel) onLocateOnBoard?.(plan[0].id);
  }, [canEdit, cards, board.id, mutators, feedback, isPanel, onLocateOnBoard]);

  // "Move to…" for the selection: cards move as above, sub-clusters nest under
  // the pick (the same reparent the sidebar's drag does).
  const moveSelection = useCallback(async () => {
    if (!onPickCluster) return;
    const bIds = [...selectedBoards];
    const cIds = [...selectedCards];
    const picked = await onPickCluster({ placeholder: 'Move to cluster…', excludeIds: [board.id, ...bIds] });
    if (!picked?.id) return;
    if (bIds.length) {
      document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
        detail: { childIds: bIds, targetId: picked.id, sourceSurface: 'list' },
      }));
      setSelectedBoards(new Set());
    }
    if (cIds.length) await moveCardsTo(cIds, picked.id);
  }, [onPickCluster, selectedBoards, selectedCards, board.id, moveCardsTo]);

  // Rename in place (F2, the right-click menu). Files rename the field their
  // name shows from (lib/fileRename.js) — downloads keep the original name;
  // folders rename the cluster.
  const renamable = useCallback((id) => {
    if (!canEdit || !id) return false;
    if (subBoards.some((b) => b.id === id)) return !!mutators.renameBoardById;
    const c = (cards || []).find((x) => x.id === id);
    return canRename(c);
  }, [canEdit, subBoards, cards, mutators]);
  const startRename = useCallback((id) => { if (renamable(id)) setRenamingId(id); }, [renamable]);
  const commitRename = useCallback((id, value) => {
    setRenamingId(null);
    if (subBoards.some((b) => b.id === id)) {
      const name = cleanName(value);
      if (name && name !== boards[id]?.name) mutators.renameBoardById?.(id, name);
      return;
    }
    const c = (cards || []).find((x) => x.id === id);
    const shown = items.find((it) => it.id === id)?.name || '';
    const patch = renamePatch(c, value, shown);
    if (patch) mutators.updateCard?.(id, patch);
  }, [subBoards, boards, cards, items, mutators]);
  const renameFor = useCallback((id) => (id === renamingId
    ? { onCommit: (v) => commitRename(id, v), onCancel: () => setRenamingId(null) }
    : null), [renamingId, commitRename]);

  // The Grid layout's rows, for ↑/↓ (JustifiedGallery reports them).
  const galleryNavRef = useRef({ tiles: [], ids: [] });
  const onGalleryLayout = useCallback((nav) => { galleryNavRef.current = nav; }, []);

  // Keyboard: move through rows and tiles, audition, select all, undo, delete.
  //
  // One window listener, so every key inherits both guards — a modal owning
  // the keyboard, and split-view / Files-beside-the-board active-pane
  // arbitration. A second listener would have fired in both panes.
  useEffect(() => {
    const onKey = async (e) => {
      if (anyModalOpen()) return; // dialogs own the keyboard (lib/modalGuard)
      // So does an open menu — right-click, View, the path ▾, sort: Escape
      // closes the menu alone and arrows stay in it.
      if (document.querySelector('.ctx-menu, .cbt-menu')) return;
      if (hasSplit && getActivePane() !== paneId) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      // Keys typed in the Info drawer are its own (lib/infoBus.inInfoDrawer) —
      // all but ⌘I, which closes it from anywhere.
      if (inInfoDrawer(e) && !((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I'))) return;
      // A focused control owns Enter and Space. Without this the window
      // handler preventDefault()s them out from under every button in the
      // list — and `activeId` is set by clicking any row's own Play button,
      // so that was the ordinary case rather than an edge one. Arrows are not
      // gated: a button does nothing with them and moving the cursor is the
      // useful reading.
      const onControl = !!e.target.closest?.('button, a[href], [role="button"], select');
      const mod = e.metaKey || e.ctrlKey;

      // F2 renames the one selected file or folder.
      if (e.key === 'F2') {
        const one = selectedCards.size + selectedBoards.size === 1 ? [...selectedCards, ...selectedBoards][0] : null;
        if (one && renamable(one)) { e.preventDefault(); startRename(one); }
        return;
      }
      // ⇧F10 / the menu key: the right-click menu, from the keyboard.
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        let ids = [...selectedCards, ...selectedBoards];
        if (!ids.length && activeId) { setSelectedCards(new Set([activeId])); ids = [activeId]; }
        if (!ids.length) return;
        e.preventDefault();
        const el = document.querySelector(`[data-item-id="${CSS.escape(ids[0])}"], [data-folder-id="${CSS.escape(ids[0])}"]`);
        const r = el?.getBoundingClientRect?.();
        setCtxMenu({ x: r ? r.left + 16 : 200, y: r ? r.top + 16 : 200 });
        return;
      }
      // ⌘Z / ⇧⌘Z: the cluster's own undo, here as on the canvas.
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (!canEdit) return;
        e.preventDefault();
        if (e.shiftKey) mutators.redo?.(); else mutators.undo?.();
        return;
      }
      // ⌘A selects every file showing (search and filters apply).
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedCards(new Set(visibleItems.map((it) => it.id)));
        setSelectedBoards(new Set());
        setSelectedGroupId(null);
        return;
      }
      // Esc clears the selection (and with it the detail panel).
      if (e.key === 'Escape') {
        if (selectedCards.size || selectedBoards.size || selectedGroupId) {
          e.preventDefault();
          setSelectedCards(new Set());
          setSelectedBoards(new Set());
          setSelectedGroupId(null);
        }
        return;
      }

      // Arrows move the cursor: ↑/↓ down the List layout's rows; in the Grid,
      // ←/→ through the tiles in order and ↑/↓ to the nearest tile in the next
      // row. Space auditions it; Enter selects it.
      const isTable = viewMode === 'table';
      const arrow = e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up'
        : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
      if (arrow && !mod && navItems.length) {
        if (isTable) {
          if (arrow !== 'down' && arrow !== 'up') return;
          e.preventDefault();
          const i = activeId ? navItems.findIndex(it => it.id === activeId) : -1;
          const step = arrow === 'down' ? 1 : -1;
          const next = i < 0
            ? (step > 0 ? 0 : navItems.length - 1)
            : Math.max(0, Math.min(navItems.length - 1, i + step));
          setActiveId(navItems[next].id);
        } else {
          const { tiles, ids } = galleryNavRef.current;
          if (!ids.length) return;
          e.preventDefault();
          const i = activeId ? ids.indexOf(activeId) : -1;
          const next = i < 0 ? 0 : gridNeighbor(tiles, i, arrow);
          setActiveId(ids[next]);
        }
        return;
      }
      // ⇧Space adds the highlighted file to the selection, or takes it out —
      // the keyboard twin of a tile's round check, so ↑↓←→ then ⇧Space builds
      // a selection without a mouse. (⌘Space is Spotlight on a Mac.)
      if ((e.key === ' ' || e.code === 'Space') && e.shiftKey && !mod) {
        const it = activeId && navItems.find((n) => n.id === activeId);
        if (!it || it.isGroup || onControl) return;
        e.preventDefault();
        toggle(selectedCards, setSelectedCards, it.id, true);
        setSelectedBoards(new Set());
        setSelectedGroupId(null);
        anchorRef.current = { kind: 'file', id: it.id };
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        // Space is Quick look on the highlighted (or the one selected) file —
        // except on an audio row in the List layout, where it auditions, so a
        // pack still plays through with ↓ and Space. Nothing to act on leaves
        // the page's own scroll behaviour alone.
        const target = activeId || (selectedCards.size === 1 ? [...selectedCards][0] : null);
        const it = target && navItems.find(n => n.id === target);
        if (!it || it.isGroup || onControl) return;
        e.preventDefault();
        if (it.kind === 'audio' && isTable) { setActiveId(it.id); auditionCard(it.id); return; }
        setQuickId(it.id);
        return;
      }
      // ⌘I: Info for the selection.
      if (mod && !e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        showInfo();
        return;
      }
      if (e.key === 'Enter' && activeId && !onControl) {
        e.preventDefault();
        const it = navItems.find((n) => n.id === activeId);
        if (it?.isGroup) { onToggleGroup(it.id); setSelectedGroupId(it.id); return; }
        setSelectedCards(new Set([activeId]));
        setSelectedBoards(new Set());
        setSelectedGroupId(null);
        return;
      }

      // Read-only surfaces (the public viewer) reach this component too.
      // canEdit already hides every delete affordance; the KEY has to be
      // gated separately or Backspace on a shared link would try to delete.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!canEdit || !(selectedBoards.size + selectedCards.size)) return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedBoards, selectedCards, selectedGroupId, mutators, hasSplit, paneId, visibleItems,
      navItems, activeId, auditionCard, canEdit, viewMode, deleteSelection, onToggleGroup, toggleInfo, showInfo,
      renamable, startRename]);

  // Board order puts a fresh upload last (it waits off the board, after
  // everything on it), so bring the first new row or tile into view rather
  // than leaving its flash and spinner below the fold.
  useEffect(() => {
    if (!recentlyAddedIds?.size) return undefined;
    const raf = requestAnimationFrame(() => {
      const root = listInnerRef.current;
      if (!root) return;
      const first = [...root.querySelectorAll('[data-item-id]')]
        .find(el => recentlyAddedIds.has(el.getAttribute('data-item-id')));
      first?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [recentlyAddedIds]);

  const [dragOver, setDragOver] = useState(false);
  // Board tile currently highlighted as a reparent drop target.
  const [dropTileId, setDropTileId] = useState(null);
  // Recognize any drag we either handle or want to swallow so it can never
  // navigate the browser away from the board (the old handler only matched
  // INBOX_MIME, so files/urls/text/boards dropped here navigated the page).
  const isRecognizedDrag = (t) =>
    t.includes(INBOX_MIME) || t.includes(BOARD_REF_MIME) || t.includes(BOARD_REF_LIST_MIME) ||
    t.includes('Files') || t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html');
  // What the header says while files are dragged over: where they'll go, or
  // — browsing another cluster — that this one isn't the place.
  const [dragNote, setDragNote] = useState(null);   // 'files' | 'blocked' | 'move' | null
  // Browsing another cluster (the panel, or full Files after a drag sprang),
  // with this Files' own files in the drag: they can be moved here.
  const homeFilesHere = (types) => {
    if (!types?.includes?.(FILES_DRAG_MIME) || !browsingFrom || !homeSrc?.canEdit) return false;
    const from = (typeof window !== 'undefined' && window.__soleilFilesDrag?.sourceBoardId) || null;
    return from === homeSrc.boardId && board?.id && board.id !== homeSrc.boardId;
  };
  // Clusters dragged in after a spring: they can be nested here.
  const foldersHere = (types) => !!browsingFrom && !!homeSrc?.canEdit
    && (types?.includes?.(BOARD_REF_MIME) || types?.includes?.(BOARD_REF_LIST_MIME));
  // Let go of every drag highlight when a drag ends — even one whose source
  // tile was unmounted by a spring, so React's own onDragEnd never fired.
  useEffect(() => onDragSession((ev) => {
    if (ev.type !== 'end') return;
    setDragOver(false);
    setDragNote(null);
    setDropTileId(null);
    markVersionTile(null);
  }), []);
  // ── New versions (lib/versionActions.js) ─────────────────────────────────
  // Only for this cluster's own files, where you can edit them.
  const cardsLiveRef = useRef(cards);
  cardsLiveRef.current = cards;
  const canVersionHere = canEdit && !browsingFrom;
  const versionEnv = () => ({
    mutators, feedback, userId: selfId || null,
    getCard: (id) => (cardsLiveRef.current || []).find((c) => c.id === id) || null,
    ctx: uploadContext({ workspaceId, boardId: board?.id }),
  });
  // One file held over a file of its kind becomes its next version. The tile
  // is marked straight on the DOM — re-rendering a 3,000-file gallery on every
  // dragover would be the slow part of the drag.
  const versionTileRef = useRef(null);
  const markVersionTile = (el, label = '') => {
    const prev = versionTileRef.current;
    if (prev === el) return;
    if (prev) { prev.classList.remove('is-version-drop'); prev.removeAttribute('data-version-drop'); }
    versionTileRef.current = el || null;
    if (el) { el.classList.add('is-version-drop'); el.setAttribute('data-version-drop', label); }
  };
  // The tile a single dragged file could be the next version of. While
  // dragging only the item's type is known; the drop checks the file itself.
  const versionTileAt = (e) => {
    if (!canVersionHere || e.altKey) return null;
    const items = e.dataTransfer?.items;
    if (!items || items.length !== 1 || items[0].kind !== 'file') return null;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-item-id]');
    const c = el ? (cardsLiveRef.current || []).find((x) => x.id === el.getAttribute('data-item-id')) : null;
    if (!c || !canVersion(c) || kindFromMime(items[0].type) !== c.kind) return null;
    return { el, card: c, label: `Drop to add as v${liveVersions(c).length + 1}` };
  };
  const handleDragOver = (e) => {
    const types = e.dataTransfer.types;
    if (homeFilesHere(types) || foldersHere(types)) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      if (!dragOver) setDragOver(true);
      const note = homeFilesHere(types) ? 'move' : null;
      if (note !== dragNote) setDragNote(note);
      return;
    }
    if (!isRecognizedDrag(types)) return;
    e.preventDefault();
    const files = types.includes('Files');
    if (!canEdit) {
      e.dataTransfer.dropEffect = 'none';
      const note = files ? 'blocked' : null;
      if (note !== dragNote) setDragNote(note);
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
    const vt = files ? versionTileAt(e) : null;
    markVersionTile(vt?.el || null, vt?.label);
    const note = vt ? 'version' : files ? 'files' : null;
    if (note !== dragNote) setDragNote(note);
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
    setDragNote(null);
    markVersionTile(null);
  };
  const handleDrop = (e) => {
    setDragOver(false);
    setDragNote(null);
    const versionEl = versionTileRef.current;
    markVersionTile(null);
    const t = e.dataTransfer.types;
    if (homeFilesHere(t)) {
      e.preventDefault();
      const payload = parseFilesPayload(e.dataTransfer.getData(FILES_DRAG_MIME));
      if (!payload || payload.sourceBoardId !== homeSrc.boardId) return;
      const moved = moveCardsTo(payload.cards.map((c) => c.id), board.id, homeSrc);
      spring?.drop?.(moved);
      return;
    }
    if (foldersHere(t)) {
      e.preventDefault();
      const childIds = readBoardRefIds(e.dataTransfer).filter((id) => id !== board.id && !wouldCreateCycle(boards, id, board.id));
      if (!childIds.length) return;
      const nested = reparentInto(childIds, board.id);
      spring?.drop?.(nested);
      return;
    }
    if (!isRecognizedDrag(t)) return;
    e.preventDefault(); // swallow so the browser never navigates
    if (!canEdit) {
      feedback?.toast?.({
        type: 'info',
        message: browsingFrom
          ? 'Open this cluster to add files to it.'
          : 'This cluster is view-only — drops are disabled.',
      });
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
    // Chat attachment → a card that waits in Files, off the board, at a free
    // spot below everything (lib/placement.js) — like a file dropped here.
    const raw = e.dataTransfer.getData(INBOX_MIME);
    if (raw) {
      let item;
      try { item = JSON.parse(raw); } catch (_) { return; }
      const card = inboxItemToCard(item, 0, 0);
      if (!card) return;
      const [spot] = positionUnplaced(cards, [card]);
      onDropInboxItem && onDropInboxItem(item.id, { ...card, x: spot.x, y: spot.y, unplaced: true });
      return;
    }
    // OS files (or a picked FileList) → the cluster's file-ingest mutator. They
    // join the cluster but not its board: they wait here, marked Not on board,
    // until dragged onto the canvas or Put on board (App.ingestFilesArranged).
    // One file onto a file of its kind: its next version (⌥ keeps it separate).
    const dropped = e.dataTransfer.files;
    if (canVersionHere && dropped?.length === 1 && !e.altKey) {
      const el = versionEl || document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-item-id]');
      const over = el ? (cards || []).find((c) => c.id === el.getAttribute('data-item-id')) : null;
      if (over && canVersion(over) && canBeVersionOf(over, dropped[0], uploadContext())) {
        addVersionFromFile(versionEnv(), over.id, dropped[0]);
        return;
      }
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      try { logEvent(EV.LIST_ADD_FILES, { board_id: board.id, n: e.dataTransfer.files.length, via: 'drop' }); } catch (_) {}
      onDropFilesToCluster?.(e.dataTransfer.files, { boardId: board.id });
      return;
    }
    // URLs / plain text still have no home in list view — nudge to canvas.
    feedback?.toast?.({ type: 'info', message: 'Switch to Board to drop links or text onto a cluster.' });
  };

  // The toolbar is sticky (the panel's whole header beside the board), and so
  // is the List layout's column header under it: publish the toolbar's height
  // so the column header (and the keyboard cursor's scroll margin) sit below
  // it rather than under it.
  const lpHeadRef = useRef(null);
  // Full Files with sub-clusters but no files still shows the files toolbar
  // when it can go back beside the board — so the toolbar keeps its place;
  // Beside board itself sits in the page header. A
  // cluster with nothing in it gets the empty state and a slim bar instead.
  const clusterEmpty = subBoards.length === 0 && linkedCards.length === 0 && otherCards.length === 0;
  const filesBlockShown = otherCards.length > 0 || isPanel || (!!dockControls?.canShrink && !clusterEmpty);
  useEffect(() => {
    const head = lpHeadRef.current;
    const wrap = head?.closest?.('.list-wrap');
    if (!head || !wrap || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => wrap.style.setProperty('--lp-head-h', `${Math.round(head.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => { ro.disconnect(); wrap.style.removeProperty('--lp-head-h'); };
  }, [isPanel, filesBlockShown]);
  useEffect(() => {
    const el = headSentinelRef.current;
    const root = el?.closest?.('.list-wrap');
    if (!el || !root || typeof IntersectionObserver === 'undefined') { setHeadStuck(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setHeadStuck(!e.isIntersecting), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [isPanel, filesBlockShown]);

  // Files → board. A tile or row drags the selection it belongs to (or just
  // itself); the board it lands on decides what the drop means (lib/filesDrag).
  // Beside the board it always can — browsing another cluster included, where
  // dragging in is how a file gets onto this board. Full Files drags when
  // there's a board to drop on: an editable cluster, or a split pane.
  const filesDraggable = !!board?.id && (isPanel || canEdit || hasSplit);
  const onFilesDragStart = (e) => {
    const el = e.target?.closest?.('[data-item-id]');
    const id = el?.getAttribute?.('data-item-id');
    if (!id) return;
    const ids = selectedCards.has(id) && selectedCards.size > 1 ? [...selectedCards] : [id];
    const byId = new Map((cards || []).map((c) => [c.id, c]));
    const list = ids.map((i) => byId.get(i)).filter(canDragFromFiles);
    const raw = buildFilesPayload({ sourceBoardId: board.id, sourceName: board.name || '', cards: list });
    if (!raw) { e.preventDefault(); return; }
    try {
      e.dataTransfer.setData(FILES_DRAG_MIME, raw);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch (_) {}
    // dragover can only see types, not data: the board reads where the drag
    // came from here, to show move vs copy before the drop.
    try { window.__soleilFilesDrag = { sourceBoardId: board.id, n: list.length }; } catch (_) {}
    beginDragSession(el, { kind: 'files', sourceBoardId: board.id });
    if (list.length > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'files-drag-ghost';
      ghost.textContent = `${list.length} files`;
      document.body.appendChild(ghost);
      try { e.dataTransfer.setDragImage(ghost, 16, 16); } catch (_) {}
      setTimeout(() => ghost.remove(), 0);
    }
  };
  const onFilesDragEnd = () => { try { window.__soleilFilesDrag = null; } catch (_) {} };

  const totalSel = selectedBoards.size + selectedCards.size;
  const unplacedIds = useMemo(() => new Set(items.filter((it) => it.unplaced).map((it) => it.id)), [items]);
  const selectedUnplaced = useMemo(
    () => (browsingFrom ? [] : [...selectedCards].filter((id) => unplacedIds.has(id))),
    [browsingFrom, selectedCards, unplacedIds]);
  const cmdKey = isMac ? '⌘' : 'Ctrl';
  // The selection bar teaches the keys until someone has made a selection of
  // more than one (the hover check shows the rest); then it gets out of the way.
  const [multiHintSeen, setMultiHintSeen] = useState(() => {
    try { return localStorage.getItem('soleil.files.multiSelected') === '1'; } catch (_) { return true; }
  });
  useEffect(() => {
    if (multiHintSeen || totalSel < 2) return;
    setMultiHintSeen(true);
    try { localStorage.setItem('soleil.files.multiSelected', '1'); } catch (_) {}
  }, [totalSel, multiHintSeen]);

  // What the right-side detail popout shows: a single selected card, or a
  // selected grid family. Nothing selected (or multi-select) → no popout.
  // Info describes whatever is selected — a file, a folder, several things —
  // and the cluster itself when nothing is, the way an inspector does.
  const detailTarget = useMemo(() => {
    if (isPanel || !infoOpen) return null;
    if (selectedGroupId) {
      const g = displayItems.find(d => d.isGroup && d.id === selectedGroupId);
      if (g) return { type: 'group', group: g };
    }
    const cIds = [...selectedCards];
    const bIds = [...selectedBoards];
    if (cIds.length === 1 && !bIds.length) {
      const it = items.find(i => i.id === cIds[0]);
      if (it) return { type: 'card', item: it };
      const link = (cards || []).find((c) => c.id === cIds[0] && c.kind === 'boardlink');
      if (link && boards[link.target]) return { type: 'cluster', board: boards[link.target] };
    }
    if (bIds.length === 1 && !cIds.length && boards[bIds[0]]) return { type: 'cluster', board: boards[bIds[0]] };
    if (cIds.length + bIds.length > 1) {
      const picked = (cards || []).filter((c) => selectedCards.has(c.id));
      for (const id of bIds) {
        const b = boards[id];
        if (b) picked.push({ id, kind: 'board', name: b.name, createdAt: b.created_at || null });
      }
      return { type: 'selection', cards: picked };
    }
    return { type: 'cluster', board, cards };
  }, [isPanel, infoOpen, selectedGroupId, selectedCards, selectedBoards, displayItems, items, cards, boards, board]);

  // The topbar's Files button, pressed while Files is already open beside the
  // board, asks for its search box (App applyFilesEvent → focusSearch).
  const searchRef = useRef(null);
  useEffect(() => {
    if (!isPanel) return undefined;
    const onFocus = () => { try { searchRef.current?.focus(); searchRef.current?.select?.(); } catch (_) {} };
    document.addEventListener('soleil-files-focus-search', onFocus);
    return () => document.removeEventListener('soleil-files-focus-search', onFocus);
  }, [isPanel]);

  // Download one row, or the whole selection as a zip.
  //
  // This is what makes a published pack usable: scrolling and auditioning are
  // only half of it, and before this the only way to take a file out of a
  // cluster was one at a time through the detail popout.
  const [zipping, setZipping] = useState(false);
  const downloadOne = useCallback(async (it) => {
    try {
      await downloadCardAsset(it.card, it.kind, { surface: 'list' });
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Download failed: ' + (err?.message || err) });
    }
  }, [feedback]);

  const downloadMany = useCallback(async (chosen) => {
    if (!chosen.length) return;
    if (chosen.length === 1) { await downloadOne(chosen[0]); return; }
    if (!bulkDownloadSupported()) {
      // deliverFile writes through a FileReader as base64 on native; a
      // half-gigabyte zip becomes ~667 MB of string and takes the app out.
      feedback?.toast?.({ type: 'warning', message: 'Download files one at a time in the app.' });
      return;
    }
    setZipping(true);
    try {
      const { count, skipped, failed } = await downloadCardAssets(
        chosen.map(it => ({ card: it.card, kind: it.kind })),
        { zipName: zipNameFor(board?.name || 'cluster'), surface: 'list' });
      // Say what was left out rather than quietly shipping a smaller archive
      // than the one that was asked for — and distinguish "there was nothing
      // behind it" (a note, an empty card) from "storage would not give it
      // back", which is the one worth telling someone about.
      const left = [];
      if (skipped) left.push(`${skipped} had no file`);
      if (failed) left.push(`${failed} could not be read from storage`);
      if (!count) {
        feedback?.toast?.({ type: 'warning', message: 'Nothing there could be downloaded.' });
      } else if (left.length) {
        feedback?.toast?.({
          type: 'warning',
          message: `Downloaded ${count} file${count === 1 ? '' : 's'} — ${left.join(', ')}.`,
        });
      }
    } catch (err) {
      if (err?.code === 'zip_too_large') {
        feedback?.toast?.({ type: 'error', message: err.message });
      } else if (err instanceof AssetFetchError && err.unreachable) {
        // R2 returns no CORS header on an error response, so the browser
        // cannot tell us whether the signature died or this origin is simply
        // not on the bucket's allowlist. Naming the origin is what makes the
        // difference checkable by whoever reads the message.
        const origin = (typeof window !== 'undefined' && window.location?.origin) || 'this address';
        feedback?.toast?.({
          type: 'error',
          message: `Storage would not hand those files back to ${origin}. Downloading one at a time still works.`,
        });
      } else {
        feedback?.toast?.({ type: 'error', message: 'Download failed: ' + (err?.message || err) });
      }
    } finally {
      setZipping(false);
    }
  }, [downloadOne, feedback, board?.name]);

  const downloadableSelected = useMemo(
    () => items.filter(it => selectedCards.has(it.id) && DOWNLOADABLE.has(it.kind)),
    [items, selectedCards]);
  const downloadSelected = useCallback(
    () => downloadMany(downloadableSelected), [downloadMany, downloadableSelected]);

  // Take the pack. Selecting every row first and then pressing Download is a
  // path a producer knows and a visitor does not — and on a phone there is no
  // ⌘-click to build the selection with at all, so without this the only way
  // off a published pack was one loop at a time. Follows the search and the
  // filters, so "Download 14" after typing 128 means those fourteen.
  const downloadableVisible = useMemo(
    () => visibleItems.filter(it => DOWNLOADABLE.has(it.kind)),
    [visibleItems]);
  const narrowed = !!query || filters.size > 0 || unplacedOnly;
  const canDownloadAll = downloadableVisible.length > 1 && bulkDownloadSupported();
  // Full Files' page header: what's in the cluster, in one line.
  const pageMeta = [
    `${otherCards.length} ${otherCards.length === 1 ? 'file' : 'files'}`,
    subBoards.length ? `${subBoards.length} ${subBoards.length === 1 ? 'cluster' : 'clusters'}` : null,
    !browsingFrom && unplacedTotal ? `${unplacedTotal} not on board` : null,
  ].filter(Boolean).join(' · ');
  const downloadAll = useCallback(
    () => downloadMany(downloadableVisible), [downloadMany, downloadableVisible]);

  // Click, double-click, drag (reparent) and drop handlers for one sub-cluster
  // tile — shared by the full-mode cluster cards and the panel's folder tiles.
  const springTimer = useSpring();
  // Never spring into a folder that is itself being dragged, or into one of
  // its descendants — nothing could be dropped there.
  const springable = (id) => {
    const ids = (typeof window !== 'undefined' && window.__soleilBoardDrag?.boardIds) || [];
    return !ids.some((x) => wouldCreateCycle(boards, x, id));
  };
  const armFolder = (id) => { if (spring && springable(id)) springTimer.enter(`folder:${id}`, () => spring.into(id)); };
  // Nest clusters under a cluster; resolves whether anything moved — after
  // App has finished (and taken the cluster card off this board), so a sprung
  // full Files only goes there once it's safe to leave.
  const reparentInto = (childIds, targetId) => new Promise((res) => {
    document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
      detail: {
        childIds, targetId, sourceSurface: 'list',
        onDone: (r) => res(!!r?.moved?.length),
        onFailed: () => res(false),
      },
    }));
  });
  // Full Files' way back up: shown when there's an ancestor, or a spring to undo.
  const hasTrail = !isPanel && !!fullPathBar && (fullPathBar.canBack || (fullPathBar.path?.length || 0) > 1);
  const folderProps = (b) => ({
    'data-folder-id': b.id,
    onClick: (e) => onTileClick(e, 'board', b.id),
    onDoubleClick: (e) => onTileDoubleClick(e, 'board', b.id),
    onDragStart: (e) => {
      const ids = (selectedBoards.size > 1 && selectedBoards.has(b.id)) ? [...selectedBoards] : [b.id];
      try { window.__soleilBoardDrag = { boardIds: ids }; } catch (_) {}
      beginDragSession(e.currentTarget, { kind: 'folders' });
      try {
        e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: b.id, name: b.name }));
        if (ids.length > 1) e.dataTransfer.setData(BOARD_REF_LIST_MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copyMove';
      } catch (_) {}
    },
    onDragEnd: () => { try { window.__soleilBoardDrag = null; } catch (_) {} setDropTileId(null); },
    onDragEnter: () => armFolder(b.id),
    onDragOver: (e) => {
      const t = e.dataTransfer.types;
      // Hold here and Files opens this folder, mid-drag (lib/springLoad.js).
      armFolder(b.id);
      // This cluster's files dropped on one of its folders move into it — and
      // so do the home cluster's, after a drag has sprung in here.
      if (t.includes(FILES_DRAG_MIME)) {
        const from = (typeof window !== 'undefined' && window.__soleilFilesDrag?.sourceBoardId) || null;
        const own = canEdit && from === board.id;
        const fromHome = !!homeSrc?.canEdit && from === homeSrc.boardId && b.id !== homeSrc.boardId;
        if (!own && !fromHome) return;
        e.preventDefault();
        e.stopPropagation();
        try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
        if (dropTileId !== b.id) setDropTileId(b.id);
        return;
      }
      if (!t.includes(BOARD_REF_MIME) && !t.includes(BOARD_REF_LIST_MIME)) return;
      const ids = (typeof window !== 'undefined' && window.__soleilBoardDrag?.boardIds) || [];
      const invalid = ids.length > 0 && (ids.includes(b.id) || ids.some(id => wouldCreateCycle(boards, id, b.id)));
      if (invalid) { try { e.dataTransfer.dropEffect = 'none'; } catch (_) {} return; }
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      if (dropTileId !== b.id) setDropTileId(b.id);
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains?.(e.relatedTarget)) return;
      springTimer.leave(`folder:${b.id}`);
      setDropTileId(prev => (prev === b.id ? null : prev));
    },
    onDrop: (e) => {
      setDropTileId(null);
      springTimer.cancel();
      if (e.dataTransfer.types.includes(FILES_DRAG_MIME)) {
        const payload = parseFilesPayload(e.dataTransfer.getData(FILES_DRAG_MIME));
        if (!payload) return;
        const own = canEdit && payload.sourceBoardId === board.id;
        const fromHome = !!homeSrc?.canEdit && payload.sourceBoardId === homeSrc.boardId && b.id !== homeSrc.boardId;
        if (!own && !fromHome) return;
        e.preventDefault();
        e.stopPropagation();
        const ids = payload.cards.map((c) => c.id);
        const moved = own ? moveCardsTo(ids, b.id) : moveCardsTo(ids, b.id, homeSrc);
        spring?.drop?.(moved);
        return;
      }
      const childIds = readBoardRefIds(e.dataTransfer);
      if (!childIds.length) return;
      e.preventDefault();
      e.stopPropagation();
      const nested = reparentInto(childIds, b.id);
      spring?.drop?.(nested);
    },
  });

  const renderSubFolder = (b) => (
    <FolderTile key={b.id} board={b} compact={isPanel}
                selected={selectedBoards.has(b.id)}
                dropTarget={dropTileId === b.id}
                springing={springTimer.armed === `folder:${b.id}`}
                peers={isPanel ? null : (peersHereByBoard?.get?.(b.id) || [])}
                draggable={canEdit}
                rename={renameFor(b.id)}
                {...folderProps(b)} />
  );
  const renderLinkedFolder = (c) => {
    const t = boards[c.target];
    return (
      <FolderTile key={c.id} board={t} linked compact={isPanel}
                  name={t?.name || c.name}
                  missing={!t && boardsReady}
                  selected={selectedCards.has(c.id)}
                  springing={springTimer.armed === `folder:${c.target}`}
                  // Hold a drag over it and Files opens the cluster it links to.
                  onDragEnter={t && spring ? () => armFolder(c.target) : undefined}
                  onDragOver={t && spring ? () => armFolder(c.target) : undefined}
                  onDragLeave={t && spring ? (e) => springTimer.leave(`folder:${c.target}`, e) : undefined}
                  data-link-id={c.id}
                  onClick={(e) => onTileClick(e, 'boardlink', c.id)}
                  onDoubleClick={(e) => onTileDoubleClick(e, 'boardlink', c.id)} />
    );
  };

  // One toolbar, two placements: in full Files it sits under the Files label;
  // beside the board it is the panel's header — compact, always present (it
  // carries the dock's ⤢ and ×), and first in the panel.
  const toolbarJsx = (
    <ClusterBrowserToolbar
      query={query} onQueryChange={setQuery}
      sortKey={sortKey} sortDir={sortDir} onSort={onSort}
      audioMode={audioMode}
      filters={filters} availableBuckets={availableBuckets}
      onToggleFilter={onToggleFilter} onClearFilters={onClearFilters}
      viewMode={viewMode} onViewMode={onViewMode}
      tileSize={tileSize} onTileSize={onTileSize}
      unplacedCount={browsingFrom ? 0 : unplacedTotal} unplacedOnly={unplacedOnly}
      onToggleUnplaced={() => setUnplacedOnly((v) => !v)}
      onAddFiles={openAddPicker} canEdit={canEdit}
      showUpsell={!isPanel && showStorageUpsell && !!onStorageUpsell}
      onUpsell={() => {
        try { logEventNow(EV.LIST_UPSELL_CTA, { board_id: board.id }); } catch (_) {}
        onStorageUpsell?.();
      }}
      facePeers={isPanel ? [] : facePeers}
      searchRef={searchRef}
      compact={isPanel}
      clusterName={board?.name}
      pathBar={isPanel ? pathBar : null}
      readOnlyNote={isPanel && browsingFrom ? 'Viewing another cluster' : ''}
      dropBanner={dragNote === 'move'
        ? { text: `Drop to move to ${board?.name || 'this cluster'}` }
        : dragNote === 'version'
        ? { text: 'Drop on the file to add a new version — hold ⌥ to add it as a separate file' }
        : dragNote === 'files'
        ? { text: `Drop to add to ${board?.name || 'this cluster'} — they wait in Files, off the board` }
        : dragNote === 'blocked'
          ? { text: browsingFrom ? `Open ${board?.name || 'this cluster'} to add files` : 'This cluster is view-only', blocked: true }
          : null}
      dockControls={dockControls ? { ...dockControls, mode } : null}
    />
  );

  // ── Right-click menu ──────────────────────────────────────────────────────
  // It acts on the selection; right-clicking something outside the selection
  // selects just that first, as Finder does. ⇧F10 opens it from the keyboard.
  const onListContextMenu = (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const fileId = e.target.closest?.('[data-item-id]')?.getAttribute('data-item-id')
      || e.target.closest?.('[data-link-id]')?.getAttribute('data-link-id');
    const folderId = e.target.closest?.('[data-folder-id]')?.getAttribute('data-folder-id');
    if (!fileId && !folderId) return;   // empty floor keeps the browser's menu
    if (fileId && navItems.find((n) => n.id === fileId)?.isGroup) return;
    e.preventDefault();
    if (folderId) {
      if (!selectedBoards.has(folderId)) { setSelectedBoards(new Set([folderId])); setSelectedCards(new Set()); }
    } else if (!selectedCards.has(fileId)) {
      setSelectedCards(new Set([fileId])); setSelectedBoards(new Set());
    }
    setSelectedGroupId(null);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };
  const menuItems = () => {
    const cIds = [...selectedCards];
    const bIds = [...selectedBoards];
    const n = cIds.length + bIds.length;
    const canMove = canEdit && !!onPickCluster;
    // The menu's header already says how many; Delete needn't repeat it.
    const del = canEdit && { id: 'del', label: 'Delete', danger: true, shortcut: '⌫', run: deleteSelection };
    // Info on anything: in full Files it's the panel beside the list, which
    // describes the selection; docked, it's the app's Info drawer.
    const info = (req) => (isPanel
      ? req && { id: 'info', label: 'Get info', shortcut: `${cmdKey}I`, run: () => showInfo(req) }
      : { id: 'info', label: infoOpen ? 'Hide info' : 'Get info', shortcut: `${cmdKey}I`, run: toggleInfo });
    if (n === 1 && bIds.length) {
      const id = bIds[0];
      return composeMenuSections([
        { items: [{ id: 'open', label: 'Open', run: () => onOpenBoard(id) }] },
        { items: [
          renamable(id) && { id: 'rename', label: 'Rename', shortcut: 'F2', run: () => startRename(id) },
          canMove && { id: 'move', label: 'Move to…', run: moveSelection },
          info({ clusterId: id }),
        ] },
        { items: [del] },
      ]);
    }
    const card = n === 1 ? (cards || []).find((c) => c.id === cIds[0]) : null;
    if (card?.kind === 'boardlink') {
      return composeMenuSections([
        { items: [boards[card.target] && { id: 'open', label: 'Open', run: () => onOpenBoard(card.target) }] },
        { items: [boards[card.target] && info({ clusterId: card.target })] },
        { items: [canEdit && { id: 'unlink', label: 'Remove link', danger: true, run: deleteSelection }] },
      ]);
    }
    const item = card ? items.find((it) => it.id === card.id) : null;
    if (item) {
      return composeMenuSections([
        { items: [
          { id: 'ql', label: 'Quick look', shortcut: 'Space', run: () => setQuickId(item.id) },
          onRevealOnCanvas && !item.unplaced && { id: 'show', label: browsingFrom ? 'Show in cluster' : 'Show on board', run: () => onRevealOnCanvas([item.id]) },
          canEdit && item.unplaced && { id: 'put', label: 'Put on board', run: () => putOnBoard([item.id]) },
        ] },
        { items: [
          renamable(item.id) && { id: 'rename', label: 'Rename', shortcut: 'F2', run: () => startRename(item.id) },
          canVersionHere && canVersion(card) && { id: 'newversion', label: 'Upload new version…', run: () => pickVersionFile(versionEnv(), card.id) },
          DOWNLOADABLE.has(item.kind) && !item.pending && { id: 'dl', label: 'Download', run: () => downloadOne(item) },
          // An app action: a signed-out visitor's link wouldn't resolve.
          onRevealOnCanvas && { id: 'link', label: 'Copy link', run: () => copyCardLink(item.id, board.id, feedback) },
          canMove && { id: 'move', label: 'Move to…', run: moveSelection },
          info({ boardId: board.id, cardIds: [item.id] }),
        ] },
        // "Linked from N places" — placed, so Delete stays last and the menu's
        // height (it keeps itself on screen) counts the row.
        { items: [onRevealOnCanvas && { id: 'bl', backlinks: true }, del] },
      ]);
    }
    const offSel = cIds.filter((id) => items.find((it) => it.id === id)?.unplaced);
    return composeMenuSections([
      { header: `${n} selected`, items: [
        canEdit && offSel.length > 0 && { id: 'put', label: offSel.length === 1 ? 'Put 1 on board' : `Put ${offSel.length} on board`, run: () => putOnBoard(offSel) },
        downloadableSelected.length > 0 && {
          // "Download" when it's all of them; else say which part can go.
          id: 'dl', label: downloadableSelected.length === n ? 'Download' : `Download ${downloadableSelected.length} of ${n}`, run: downloadSelected,
        },
        canMove && { id: 'move', label: 'Move to…', run: moveSelection },
        info({ boardId: board.id, cardIds: cIds, clusterIds: bIds }),
      ] },
      { items: [del] },
    ]);
  };
  const menuCard = ctxMenu && onRevealOnCanvas && selectedCards.size === 1 && !selectedBoards.size
    ? (cards || []).find((c) => c.id === [...selectedCards][0] && c.kind !== 'boardlink') || null
    : null;

  return (
    <div className={`list-wrap ${isPanel ? 'is-panel' : ''} ${dragOver ? 'is-drop-target' : ''}`} ref={listWrapRef}
         onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
         onPointerDownCapture={() => setActivePane(paneId)}
         onPointerEnter={() => setActivePane(paneId)}
         onClick={(e) => {
           // A click on empty floor clears the selection; one on a control,
           // a tile or a menu is that thing's business.
           if (e.target.closest?.('button, a, input, select, label, [role="menu"], [role="dialog"], .ct-tile, .ct-row, .ft, .cbt, .list-selbar, .cb-detail')) return;
           setSelectedBoards(new Set()); setSelectedCards(new Set()); setSelectedGroupId(null);
         }}>
      <div className="list-inner" ref={listInnerRef} onContextMenu={onListContextMenu}>
        {isPanel && <div className="lp-sentinel" ref={headSentinelRef} aria-hidden="true" />}
        {isPanel && <div className={`lp-head${headStuck ? ' is-stuck' : ''}`} ref={lpHeadRef}>{toolbarJsx}</div>}
        {/* Full Files opens on the cluster's name and what's in it — then the
            toolbar, sticky, above everything it searches and sorts. */}
        {!isPanel && (
          <header className={`cb-pagehead${hasTrail ? ' has-trail' : ''}`}>
            {hasTrail && <div className="cb-pagehead-trail"><PathBar {...fullPathBar} /></div>}
            <h1 className="cb-pagehead-title">{board?.name || 'Untitled cluster'}</h1>
            <span className="cb-pagehead-meta">{pageMeta}</span>
            {canDownloadAll && (
              <button type="button" className="list-section-act cb-pagehead-dl" onClick={downloadAll} disabled={zipping}>
                <Icon as={Download} size={16} weight="light" />
                <span>{zipping ? 'Preparing…'
                     : narrowed ? `Download ${downloadableVisible.length}`
                     : 'Download all'}</span>
              </button>
            )}
            {dockControls?.canShrink && dockControls?.onShrink && (
              <button type="button" className="cbt-iconbtn cbt-shrink" onClick={dockControls.onShrink}
                      aria-label="Beside board" title="Put Files beside the board">
                <Icon as={ArrowsInSimple} size={16} weight="light" />
              </button>
            )}
          </header>
        )}
        {!isPanel && filesBlockShown && <div className="lp-sentinel" ref={headSentinelRef} aria-hidden="true" />}
        {!isPanel && filesBlockShown && <div className={`cb-head${headStuck ? ' is-stuck' : ''}`} ref={lpHeadRef}>{toolbarJsx}</div>}
        {!isPanel && clusterEmpty && (
          <div className="list-empty">
            <div className="list-empty-title">Empty cluster</div>
            <div className="list-empty-sub">
              {canEdit ? 'Drop files anywhere here, or start with one of these.' : 'Nothing here yet.'}
            </div>
            {canEdit && (
              <div className="list-empty-acts">
                <button className="tb-btn" onClick={openAddPicker}><Icon as={Plus} size={16} weight="light" /> Add files</button>
                {mutators.addNewBoard && <button className="tb-btn" onClick={() => mutators.addNewBoard()}>New cluster</button>}
                {onOpenPicker && <button className="tb-btn" onClick={onOpenPicker}><Icon as={LinkIcon} size={16} weight="light" /> Link a cluster</button>}
              </div>
            )}
          </div>
        )}
        {isPanel && hasFolders && (
          <>
            <div className="list-section">
              <span>Clusters</span><span className="list-section-count">{folderCount}</span>
            </div>
            <div className="ft-grid is-panel" ref={ftGridRef}>
              {subBoards.slice(0, folderShown).map(renderSubFolder)}
              {linkedCards.slice(0, Math.max(0, folderShown - subBoards.length)).map(renderLinkedFolder)}
            </div>
            {folderCount > folderCapN && (
              <button type="button" className="ft-more" onClick={toggleFolders} aria-expanded={foldersOpen}>
                {foldersOpen ? 'Show fewer' : `Show all ${folderCount}`}
                <Icon as={foldersOpen ? ChevronUp : ChevronDown} size={12} weight="light" />
              </button>
            )}
          </>
        )}
        {!isPanel && subBoards.length > 0 && (
          <>
            <div className="list-section">
              <span>Clusters</span><span className="list-section-count">{subBoards.length}</span>
            </div>
            <div className="ft-grid is-full">{subBoards.map(renderSubFolder)}</div>
          </>
        )}
        {!isPanel && linkedCards.length > 0 && (
          <>
            <div className="list-section">
              <span>Linked</span><span className="list-section-count">{linkedCards.length}</span>
            </div>
            <div className="ft-grid is-full">{linkedCards.map(renderLinkedFolder)}</div>
          </>
        )}
        {filesBlockShown && (
          <div className="cluster-browser">
            {(hasFolders || (!isPanel && packSummary)) && (
              <div className="list-section list-section-files">
                <span>Files</span>
                <span className="list-section-count">{loading ? '…' : narrowed ? `${visibleItems.length} of ${otherCards.length}` : otherCards.length}</span>
                {!isPanel && packSummary && <span className="list-section-meta">{packSummary}</span>}
              </div>
            )}
            <div className={`cb-split ${detailTarget ? 'has-detail' : ''}`}>
              <div className="cb-main"
                   onDragStart={filesDraggable ? onFilesDragStart : undefined}
                   onDragEnd={filesDraggable ? onFilesDragEnd : undefined}>
                {visibleItems.length === 0 && descHits.length === 0 ? (
                  loading ? (
                    <div className="list-loading" role="status">Loading files…</div>
                  ) : query || filters.size || unplacedOnly ? (
                    <div className="cluster-browser-empty">
                      <div>No files match.</div>
                      <button type="button" className="cbt-btn cb-empty-clear"
                              onClick={() => { setQuery(''); onClearFilters(); }}>Clear filters</button>
                    </div>
                  ) : (
                    <div className={`list-empty is-compact${canEdit ? "" : " is-readonly"}`}>
                      {canEdit && <span className="list-empty-ico"><Icon as={Upload} size={16} weight="light" /></span>}
                      <div className="list-empty-title">No files in {board?.name || 'this cluster'}</div>
                      <div className="list-empty-sub">
                        {canEdit ? 'Drop files here or add them. They wait in Files until you put them on the board.'
                          : browsingFrom ? `Open ${board?.name || 'it'} to add files.` : 'Nothing here yet.'}
                      </div>
                      {canEdit ? (
                        <button type="button" className="cbt-btn" onClick={openAddPicker}><Icon as={Plus} size={16} weight="light" />Add files</button>
                      ) : browsingFrom && dockControls?.onExpand ? (
                        <button type="button" className="cbt-btn" onClick={dockControls.onExpand}>Open {board?.name || 'cluster'}</button>
                      ) : null}
                    </div>
                  )
                ) : visibleItems.length === 0 ? null : viewMode === 'gallery' ? (
                  <JustifiedGallery tileSize={tileSize}
                    activeId={activeId} registerRow={registerRow} onLayout={onGalleryLayout}
                    renameFor={renameFor} markUnplaced={!browsingFrom}
                    items={displayItems} selectedCards={selectedCards} peerMap={peerMap}
                    recentlyAddedIds={recentlyAddedIds}
                    expandedGroups={expandedGroups} selectedGroupId={selectedGroupId}
                    onGroupClick={onGroupClick}
                    onDownload={downloadOne}
                    onAudition={(it) => { setActiveId(it.id); auditionCard(it.id); }}
                    playingId={playingId}
                    draggableItems={filesDraggable} onBoardIds={onBoardIds}
                    onRowClick={(e, id) => onTileClick(e, 'file', id)}
                    onRowDoubleClick={(e, id) => onTileDoubleClick(e, 'file', id)} />
                ) : (
                  <ClusterTable
                    items={displayItems} selectedCards={selectedCards} peerMap={peerMap}
                    sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                    recentlyAddedIds={recentlyAddedIds}
                    expandedGroups={expandedGroups} selectedGroupId={selectedGroupId}
                    onGroupClick={onGroupClick}
                    onDownload={downloadOne}
                    onAudition={(it) => { setActiveId(it.id); auditionCard(it.id); }}
                    onSeek={seekCard}
                    activeId={activeId} playingId={playingId} registerRow={registerRow}
                    audioMode={audioMode}
                    draggableItems={filesDraggable} onBoardIds={onBoardIds} renameFor={renameFor}
                    markUnplaced={!browsingFrom}
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
              {detailTarget && (
                <DetailPanel
                  target={detailTarget} boards={boards} canEdit={canEdit}
                  selfId={selfId} gridTemplates={gridTemplates}
                  writeMeta={canEdit && !browsingFrom ? mutators?.updateCardMeta : null}
                  versionEnv={canVersionHere ? versionEnv() : null}
                  onOpenCluster={detailTarget.type === 'cluster' && detailTarget.board?.id !== board.id ? onOpenBoard : null}
                  onClose={toggleInfo}
                  onReveal={onRevealOnCanvas ? ((id) => onRevealOnCanvas([id])) : null}
                  onPutOnBoard={canEdit && !browsingFrom ? (id) => putOnBoard([id]) : null}
                  onDelete={onDeleteItems} />
              )}
            </div>
          </div>
        )}
        {ctxMenu && createPortal(
          <CardContextMenu open x={ctxMenu.x} y={ctxMenu.y} items={menuItems()}
                           onClose={() => setCtxMenu(null)}
                           workspaceId={menuCard ? workspaceId : null} boardId={menuCard ? board.id : null} card={menuCard} />,
          document.body,
        )}
        {quickIndex >= 0 && (
          <Suspense fallback={null}>
            <QuickLook
              items={quickItems} index={quickIndex}
              onIndex={(i) => { const it = quickItems[i]; if (it) { setQuickId(it.id); setActiveId(it.id); } }}
              onClose={() => setQuickId(null)}
              onShowOnBoard={onRevealOnCanvas && !quickItems[quickIndex]?.unplaced ? (it) => { setQuickId(null); onRevealOnCanvas([it.id]); } : null}
              showLabel={browsingFrom ? 'Show in cluster' : 'Show on board'}
              onDownload={downloadOne}
              onPutOnBoard={canEdit && !browsingFrom ? (it) => { setQuickId(null); putOnBoard([it.id]); } : null}
              infoOpen={infoOpen} onToggleInfo={toggleInfo}
              boards={boards} canEdit={canEdit}
              onDelete={async (ids) => {
                const next = quickItems[quickIndex + 1] || quickItems[quickIndex - 1] || null;
                if (!(await onDeleteItems(ids))) return;
                setQuickId(next && !ids.includes(next.id) ? next.id : null);
              }} />
          </Suspense>
        )}
        {/* Hidden picker for the toolbar "Add files" button (touch-friendly). */}
        <input ref={addInputRef} type="file" multiple style={{ display: 'none' }}
               onChange={(e) => {
                 if (e.target.files && e.target.files.length) {
                   try { logEvent(EV.LIST_ADD_FILES, { board_id: board.id, n: e.target.files.length, via: 'toolbar' }); } catch (_) {}
                   onDropFilesToCluster?.(e.target.files, { boardId: board.id });
                 }
                 e.target.value = '';
               }} />
        {/* Rendered LAST inside .list-inner and stuck to the bottom of the
            scrollport, so the actions for a selection are still on screen once
            you have scrolled past the rows you made it from. */}
        {totalSel > 0 && (
          <div className="list-selbar">
            <span className="list-selbar-count" aria-live="polite"
                  title={`${isMac ? '⌘A' : 'Ctrl+A'} selects all · ${cmdKey}-click adds · ${isMac ? '⇧' : 'Shift'}-click selects a range`}>{totalSel} selected</span>
            {downloadableSelected.length > 0 && (
              <button type="button" className="list-selbar-act" onClick={downloadSelected} disabled={zipping}
                      title={downloadableSelected.length === 1 ? 'Download' : `Download ${downloadableSelected.length}`}
                      aria-label={downloadableSelected.length === 1 ? 'Download' : `Download ${downloadableSelected.length}`}>
                <Icon as={Download} size={14} weight="light" />
                <span>{zipping ? 'Preparing…'
                     : downloadableSelected.length === 1 ? 'Download'
                     : `Download ${downloadableSelected.length}`}</span>
              </button>
            )}
            {/* A visitor on a shared link can't move or delete, so those
                aren't offered. */}
            {canEdit && selectedUnplaced.length > 0 && (
              <button type="button" className="list-selbar-act" onClick={() => putOnBoard(selectedUnplaced)}
                      title="Put on the board" aria-label="Put on board">
                <Icon as={BoundingBox} size={14} weight="light" /><span>Put on board</span>
              </button>
            )}
            {canEdit && onPickCluster && (
              <button type="button" className="list-selbar-act" onClick={moveSelection} title="Move to…" aria-label="Move to…">
                <Icon as={ArrowBendUpRight} size={14} weight="light" /><span>Move to…</span>
              </button>
            )}
            {canEdit && (
              <button type="button" className="list-selbar-act" onClick={deleteSelection} title="Delete" aria-label="Delete">
                <Icon as={Trash2} size={14} weight="light" /><span>Delete</span>
              </button>
            )}
            {totalSel > 0 && (
              <button type="button" className={`list-selbar-act${!isPanel && infoOpen ? ' is-on' : ''}`} onClick={() => showInfo()}
                      aria-pressed={isPanel ? undefined : infoOpen} title={`Info (${cmdKey}I)`} aria-label="Info">
                <Icon as={Info} size={14} weight="light" /><span>Info</span>
              </button>
            )}
            <button type="button" className="list-selbar-act list-selbar-clear" aria-label="Clear selection" title="Clear selection (Esc)"
                    onClick={() => { setSelectedCards(new Set()); setSelectedBoards(new Set()); setSelectedGroupId(null); }}>
              <Icon as={X} size={14} weight="light" />
            </button>
            {!isPanel && !multiHintSeen && (
              <span className="list-selbar-hint">
                <kbd>{isMac ? '⌘A' : 'Ctrl+A'}</kbd> all · <kbd>{cmdKey}</kbd>-click add · <kbd>{isMac ? '⇧' : 'Shift'}</kbd>-click range
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
