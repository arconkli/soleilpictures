import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { BoardCard, BoardLinkCard } from './cards.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, BOARD_REF_LIST_MIME, readBoardRefIds, inboxItemToCard } from '../lib/dragMimes.js';
import { wouldCreateCycle, collectDescendantIds } from '../lib/boardTree.js';
import { useFeedback } from './AppFeedback.jsx';
import { setActivePane, getActivePane } from '../lib/activePane.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { undoToast } from '../lib/undoToast.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { toListItem, sortItems, filterItems, matchItems } from '../lib/listItem.js';
import { formatDuration } from '../lib/loopMeta.js';
import { searchEntities } from '../lib/entitySearch.js';
import { getMeta, primeImageMetaForBoard } from '../lib/imageMeta.js';
import { usePeerSelections } from '../hooks/usePeerSelections.js';
import { ClusterBrowserToolbar } from './clusterBrowser/ClusterBrowserToolbar.jsx';
import { ClusterTable } from './clusterBrowser/ClusterTable.jsx';
import { ClusterGallery } from './clusterBrowser/ClusterGallery.jsx';
import { DetailPanel } from './clusterBrowser/DetailPanel.jsx';
import { groupGridFamilies } from '../lib/gridFamilies.js';
import * as audioBus from '../lib/audioBus.js';
import { resolveSrc } from '../lib/r2.js';
import { Icon } from './Icon.jsx';
import { Download } from '../lib/icons.js';
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
  // Drop / picked OS files → auto-arranged on the canvas (list has no viewport).
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
  // Quiet "Any file, any size — Creator" toolbar nudge for free workspace
  // owners; opens the storage upgrade modal. Off in the ?local harness.
  showStorageUpsell = false,
  onStorageUpsell = null,
  // Split-pane shortcut arbitration — see lib/activePane.js. Without the
  // gate, the window keydown below deleted from BOTH panes on one Backspace.
  paneId = 'main',
  hasSplit = false,
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
      setSortKey('updated');
      setSortDir('desc');
      writeBrowserPrefs({ sortKey: 'updated', sortDir: 'desc' });
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

  // Re-sorting or filtering strands the cursor on a row that has moved or gone.
  useEffect(() => {
    if (activeId && !navItems.some(it => it.id === activeId)) setActiveId(null);
  }, [navItems, activeId]);
  useEffect(() => { setActiveId(null); setPlayingId(null); }, [board.id]);

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
    setSelectedGroupId(null);
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
      else { setSelectedCards(new Set([id])); setSelectedBoards(new Set()); }
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
      // A file/card: jump to it on the canvas (files had no dbl-click action).
      onRevealOnCanvas?.([id]);
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

  // Delete from the detail popout — same undo-safe confirm as Backspace.
  const onDeleteItems = useCallback(async (ids) => {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    const ok = await feedback.confirm({
      title: 'Delete', danger: true, confirmLabel: 'Delete',
      message: list.length === 1 ? 'Delete this card?' : `Delete ${list.length} cards?`,
    });
    if (!ok) return;
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
  }, [feedback, mutators]);

  // Keyboard: move through rows, audition, delete.
  //
  // Extends the existing Delete handler rather than adding a second window
  // listener, so the new keys inherit BOTH guards it already has — a modal
  // owning the keyboard, and split-view's active-pane arbitration. A second
  // listener would have fired in both panes on every arrow press.
  useEffect(() => {
    const onKey = async (e) => {
      if (anyModalOpen()) return; // dialogs own the keyboard (lib/modalGuard)
      if (hasSplit && getActivePane() !== paneId) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      // A focused control owns Enter and Space. Without this the window
      // handler preventDefault()s them out from under every button in the
      // list — and `activeId` is set by clicking any row's own Play button,
      // so that was the ordinary case rather than an edge one. Arrows are not
      // gated: a button does nothing with them and moving the cursor is the
      // useful reading.
      const onControl = !!e.target.closest?.('button, a[href], [role="button"], select');

      // ↑/↓ move the cursor; Space auditions it; Enter selects it.
      if (navItems.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const i = activeId ? navItems.findIndex(it => it.id === activeId) : -1;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = i < 0
          ? (step > 0 ? 0 : navItems.length - 1)
          : Math.max(0, Math.min(navItems.length - 1, i + step));
        setActiveId(navItems[next].id);
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        // Only claim Space when there is actually something to audition —
        // otherwise leave the page's own scroll behaviour alone.
        const target = activeId || (selectedCards.size === 1 ? [...selectedCards][0] : null);
        const it = target && navItems.find(n => n.id === target);
        if (it && it.kind === 'audio' && !onControl) {
          e.preventDefault();
          setActiveId(it.id);
          auditionCard(it.id);
        }
        return;
      }
      if (e.key === 'Enter' && activeId && !onControl) {
        e.preventDefault();
        setSelectedCards(new Set([activeId]));
        setSelectedBoards(new Set());
        setSelectedGroupId(null);
        return;
      }

      // Read-only surfaces (the public viewer) reach this component too.
      // canEdit already hides every delete affordance; the KEY has to be
      // gated separately or Backspace on a shared link would try to delete.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!canEdit) return;
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback, selectedBoards, selectedCards, boards, mutators, hasSplit, paneId,
      navItems, activeId, auditionCard, canEdit]);

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
      try { logEvent(EV.LIST_ADD_FILES, { board_id: board.id, n: e.dataTransfer.files.length, via: 'drop' }); } catch (_) {}
      onDropFilesToCluster?.(e.dataTransfer.files, { boardId: board.id });
      return;
    }
    // URLs / plain text still have no home in list view — nudge to canvas.
    feedback?.toast?.({ type: 'info', message: 'Switch to canvas view to drop links or text onto a cluster.' });
  };

  const totalSel = selectedBoards.size + selectedCards.size;
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  // What the right-side detail popout shows: a single selected card, or a
  // selected grid family. Nothing selected (or multi-select) → no popout.
  const detailTarget = useMemo(() => {
    if (selectedGroupId) {
      const g = displayItems.find(d => d.isGroup && d.id === selectedGroupId);
      if (g) return { type: 'group', group: g };
    }
    if (selectedCards.size === 1) {
      const id = [...selectedCards][0];
      const it = items.find(i => i.id === id);
      if (it) return { type: 'card', item: it };
    }
    return null;
  }, [selectedGroupId, selectedCards, displayItems, items]);

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
  const narrowed = !!query || filters.size > 0;
  const canDownloadAll = downloadableVisible.length > 1 && bulkDownloadSupported();
  const downloadAll = useCallback(
    () => downloadMany(downloadableVisible), [downloadMany, downloadableVisible]);

  return (
    <div className={`list-wrap ${dragOver ? 'is-drop-target' : ''}`}
         onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
         onPointerDownCapture={() => setActivePane(paneId)}
         onPointerEnter={() => setActivePane(paneId)}
         onClick={() => { setSelectedBoards(new Set()); setSelectedCards(new Set()); }}>
      <div className="list-inner" onClick={(e) => e.stopPropagation()}>
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
                             onRename={canEdit
                               // Passing this unconditionally is what made
                               // BoardCard render an EditableText for a
                               // signed-out visitor on a published page —
                               // it only checks that the prop is truthy.
                               ? ((name) => mutators.renameBoardById?.(b.id, name))
                               : undefined} />
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
            <div className="list-section list-section-files">
              <span>Files</span>
              {packSummary && <span className="list-section-meta">{packSummary}</span>}
              {canDownloadAll && (
                <button type="button" className="list-section-act" onClick={downloadAll} disabled={zipping}>
                  <Icon as={Download} size={12} />
                  <span>{zipping ? 'Preparing…'
                       : narrowed ? `Download ${downloadableVisible.length}`
                       : 'Download all'}</span>
                </button>
              )}
            </div>
            <ClusterBrowserToolbar
              query={query} onQueryChange={setQuery}
              sortKey={sortKey} sortDir={sortDir} onSort={onSort}
              audioMode={audioMode}
              filters={filters} availableBuckets={availableBuckets}
              onToggleFilter={onToggleFilter} onClearFilters={onClearFilters}
              viewMode={viewMode} onViewMode={onViewMode}
              onAddFiles={openAddPicker} canEdit={canEdit}
              showUpsell={showStorageUpsell && !!onStorageUpsell}
              onUpsell={() => {
                try { logEventNow(EV.LIST_UPSELL_CTA, { board_id: board.id }); } catch (_) {}
                onStorageUpsell?.();
              }}
              facePeers={facePeers}
            />
            <div className={`cb-split ${detailTarget ? 'has-detail' : ''}`}>
              <div className="cb-main">
                {visibleItems.length === 0 && descHits.length === 0 ? (
                  <div className="cluster-browser-empty">
                    {query || filters.size ? 'No files match your search.' : 'No files yet.'}
                  </div>
                ) : visibleItems.length === 0 ? null : viewMode === 'gallery' ? (
                  <ClusterGallery
                    items={displayItems} selectedCards={selectedCards} peerMap={peerMap}
                    recentlyAddedIds={recentlyAddedIds}
                    expandedGroups={expandedGroups} selectedGroupId={selectedGroupId}
                    onGroupClick={onGroupClick}
                    onDownload={downloadOne}
                    onAudition={(it) => { setActiveId(it.id); auditionCard(it.id); }}
                    playingId={playingId}
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
                  onClose={() => { setSelectedCards(new Set()); setSelectedGroupId(null); }}
                  onReveal={onRevealOnCanvas ? ((id) => onRevealOnCanvas([id])) : null}
                  onDelete={onDeleteItems} />
              )}
            </div>
          </div>
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
            <span className="list-selbar-count" aria-live="polite">{totalSel} selected</span>
            {downloadableSelected.length > 0 && (
              <button type="button" className="list-selbar-act" onClick={downloadSelected} disabled={zipping}>
                <Icon as={Download} size={13} />
                <span>{zipping ? 'Preparing…'
                     : downloadableSelected.length === 1 ? 'Download'
                     : `Download ${downloadableSelected.length}`}</span>
              </button>
            )}
            {/* A visitor on a shared link cannot delete — the key is gated on
                canEdit — so do not offer them a shortcut that does nothing. */}
            <span className="list-selbar-hint">
              {canEdit ? `⌫ to delete · ${cmdKey}-click to multi-select`
                       : `${cmdKey}-click to multi-select · ⇧-click for a range`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
