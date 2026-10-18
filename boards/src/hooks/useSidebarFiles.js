// What the sidebar knows about every file in the workspace.
//
// A cluster that is open reads its own live doc, so it is never stale. Every
// other cluster is read from card_index through 0419's RPCs: one call for the
// numbers on every row, one "peek" when a cluster unfolds (the first few of
// each shelf), then a page at a time as "+N more" is pressed. Closed clusters
// only change when someone else edits them, so instead of another realtime
// channel per tab this refreshes when the tab comes back into view and once a
// minute while it's visible, and straight after anything the sidebar itself
// writes.
//
// Never `.catch()` an rpc builder (it is a thenable, not a promise): every call
// here awaits the builder and reads { data, error }.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SHELVES, shelfOf } from '../lib/sidebarShelves.js';
import { itemFromIndexRow, itemFromCard } from '../lib/indexRowCard.js';
import { sortItems, groupItems, filterItems } from '../lib/sidebarSort.js';
import { countsFromRows, countsFromItems, rollupCounts, withLive } from '../lib/sidebarCounts.js';
import { searchEntities } from '../lib/entitySearch.js';

const PEEK_PER_SHELF = 12;
const PAGE = 60;
// Grouping by canvas group, and the Not on board chip, need a cluster whole:
// a group or a stored file can sit anywhere in the order.
const WHOLE = 200;
const REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 200;

async function rpc(fn, params) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) { console.warn(`[sidebar] ${fn}`, error.message || error); return null; }
    return data || [];
  } catch (e) {
    console.warn(`[sidebar] ${fn}`, e?.message || e);
    return null;
  }
}

function byShelfFrom(rows, boardId) {
  const out = {};
  for (const r of rows || []) {
    const item = itemFromIndexRow(r, boardId);
    if (!item) continue;
    (out[item.shelf] ||= { items: [], done: false }).items.push(item);
  }
  return out;
}

// `source` swaps the network out — { rpc(fn, params), search(params),
// toggleStar(boardId, cardId, on) } — for the dev-only sidebar QA harness
// (?sidebarqa=1) and nothing else.
export function useSidebarFiles({
  enabled = true, workspaceId, boards = [], allBoards = {}, liveBoardId = null, liveCards = null,
  sort = 'newest', groupBy = 'type', chip = 'all', query = '', source = null,
}) {
  const call = source?.rpc || rpc;
  const find = source?.search || searchEntities;
  const [countRows, setCountRows] = useState([]);
  const [contents, setContents] = useState({});   // boardId → { status, byShelf, key }
  const [recentRows, setRecentRows] = useState([]);
  const [starredRows, setStarredRows] = useState([]);
  const [search, setSearch] = useState({ q: '', rows: [], loading: false });
  const contentsRef = useRef(contents);
  contentsRef.current = contents;

  const boardIds = useMemo(() => boards.map((b) => b.id).filter(Boolean), [boards]);
  const boardIdsKey = boardIds.join(',');
  const needsWhole = groupBy === 'canvas' || chip === 'unplaced';
  // A loaded cluster belongs to one sort (the server orders it) and one depth.
  const loadKey = `${sort}|${needsWhole ? 'whole' : 'peek'}`;

  const fetchCounts = useCallback(async () => {
    if (!enabled || !boardIds.length) { setCountRows([]); return; }
    const rows = await call('sidebar_shelf_counts', { p_board_ids: boardIds });
    if (rows) setCountRows(rows);
  }, [enabled, boardIdsKey, call]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRecent = useCallback(async () => {
    if (!enabled || !workspaceId) return;
    const rows = await call('sidebar_recent', { p_workspace_id: workspaceId, p_limit: 8 });
    if (rows) setRecentRows(rows);
  }, [enabled, workspaceId, call]);

  const fetchStarred = useCallback(async () => {
    if (!enabled || !workspaceId) return;
    const rows = await call('sidebar_starred', { p_workspace_id: workspaceId });
    if (rows) setStarredRows(rows);
  }, [enabled, workspaceId, call]);

  // `depth` is how many of each shelf to fetch: a peek, a whole cluster, or —
  // on a refresh — as many as the person had already paged in, so a shelf
  // they expanded doesn't shrink back under them once a minute.
  const loadPeek = useCallback(async (boardId, key, depth = null) => {
    setContents((c) => ({ ...c, [boardId]: { status: 'loading', byShelf: c[boardId]?.byShelf || {}, key } }));
    const rows = await call('sidebar_cluster_items', {
      p_board_id: boardId, p_shelf: null, p_sort: sort, p_offset: 0,
      p_limit: needsWhole ? WHOLE : Math.min(WHOLE, Math.max(PEEK_PER_SHELF, depth || 0)),
    });
    setContents((c) => {
      if (c[boardId]?.key !== key) return c;          // superseded by a newer load
      if (!rows) return { ...c, [boardId]: { ...c[boardId], status: 'error' } };
      const byShelf = byShelfFrom(rows, boardId);
      if (needsWhole) for (const s of Object.values(byShelf)) s.done = true;
      return { ...c, [boardId]: { status: 'ready', byShelf, key } };
    });
  }, [sort, needsWhole, call]);

  // Unfolding a cluster asks for its peek; asking again is free.
  const ensure = useCallback((boardId) => {
    if (!enabled || !boardId || boardId === liveBoardId) return;
    const cur = contentsRef.current[boardId];
    if (cur && cur.key === loadKey && cur.status !== 'error') return;
    loadPeek(boardId, loadKey);
  }, [enabled, liveBoardId, loadKey, loadPeek]);

  const loadMore = useCallback(async (boardId, shelfId) => {
    const cur = contentsRef.current[boardId];
    const have = cur?.byShelf?.[shelfId]?.items?.length || 0;
    const rows = await call('sidebar_cluster_items', {
      p_board_id: boardId, p_shelf: shelfId, p_sort: sort, p_offset: have, p_limit: PAGE,
    });
    if (!rows) return;
    setContents((c) => {
      const entry = c[boardId];
      if (!entry) return c;
      const prev = entry.byShelf[shelfId] || { items: [], done: false };
      const seen = new Set(prev.items.map((i) => i.cardId));
      const more = rows.map((r) => itemFromIndexRow(r, boardId)).filter((i) => i && !seen.has(i.cardId));
      return {
        ...c,
        [boardId]: {
          ...entry,
          byShelf: { ...entry.byShelf, [shelfId]: { items: [...prev.items, ...more], done: rows.length < PAGE } },
        },
      };
    });
  }, [sort, call]);

  // A new sort or depth reorders every closed cluster: reload what was loaded.
  useEffect(() => {
    for (const [id, entry] of Object.entries(contentsRef.current)) {
      if (entry.key !== loadKey) loadPeek(id, loadKey);
    }
  }, [loadKey, loadPeek]);

  const refresh = useCallback(() => {
    fetchCounts();
    fetchRecent();
    fetchStarred();
    for (const [id, entry] of Object.entries(contentsRef.current)) {
      const depth = Math.max(0, ...Object.values(entry.byShelf || {}).map((sh) => sh.items.length));
      loadPeek(id, loadKey, depth);
    }
  }, [fetchCounts, fetchRecent, fetchStarred, loadPeek, loadKey]);

  useEffect(() => { setContents({}); setSearch({ q: '', rows: [], loading: false }); }, [workspaceId]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchRecent(); fetchStarred(); }, [fetchRecent, fetchStarred]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(t); };
  }, [enabled, refresh]);

  // ── Search ────────────────────────────────────────────────────────────────
  const q = (query || '').trim();
  useEffect(() => {
    if (!enabled || !workspaceId || !q) { setSearch({ q: '', rows: [], loading: false }); return undefined; }
    setSearch((s) => ({ ...s, loading: true }));
    let alive = true;
    const t = setTimeout(async () => {
      let rows = [];
      try { rows = await find({ workspaceId, query: q, limit: 80 }); } catch (_) { rows = []; }
      if (alive) setSearch({ q, rows: rows || [], loading: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [enabled, workspaceId, q, find]);

  const searchHits = useMemo(() => {
    const out = new Map();
    for (const r of search.rows) {
      if (!r.card_id || shelfOf(r.kind) == null) continue;
      const item = itemFromIndexRow({
        ...r, snippet: String(r.body || '').slice(0, 160), created_at: r.updated_at,
      }, r.board_id);
      if (!item) continue;
      if (!out.has(item.boardId)) out.set(item.boardId, []);
      out.get(item.boardId).push(item);
    }
    return out;
  }, [search.rows]);

  // ── The open cluster, straight from its doc ───────────────────────────────
  const liveItems = useMemo(() => {
    if (!liveBoardId || !Array.isArray(liveCards)) return null;
    return liveCards.map((c) => itemFromCard(c, { boardId: liveBoardId, workspaceId })).filter(Boolean);
  }, [liveBoardId, liveCards, workspaceId]);

  // ── Numbers ───────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const scoped = (rows, items) => {
      let own = countsFromRows(rows);
      if (liveBoardId && liveItems) own = withLive(own, liveBoardId, countsFromItems(items));
      return { own, rolled: rollupCounts(boards, own) };
    };
    const all = scoped(countRows, liveItems || []);
    if (chip === 'all') return { ...all, chipRolled: all.rolled };
    const chipRows = chip === 'unplaced'
      ? countRows.map((r) => ({ ...r, n: r.n_unplaced || 0 }))
      : countRows.filter((r) => r.shelf === chip);
    const chipItems = filterItems(liveItems || [], { chip });
    return { ...all, chipRolled: scoped(chipRows, chipItems).rolled };
  }, [countRows, liveItems, liveBoardId, boards, chip]);

  // ── Contents, shelved ─────────────────────────────────────────────────────
  const shelve = useCallback((items, totals) => {
    const visible = filterItems(items, { chip });
    if (groupBy === 'canvas') {
      return groupItems(visible, { groupBy: 'canvas' }).map((s) => ({ ...s, total: s.items.length }));
    }
    return SHELVES.map((s) => {
      const mine = visible.filter((i) => i.shelf === s.id);
      const total = totals ? totals(s.id, mine.length) : mine.length;
      return { ...s, items: mine, total };
    }).filter((s) => s.total > 0 || s.items.length > 0);
  }, [chip, groupBy]);

  const contentsOf = useCallback((boardId) => {
    if (q) {
      const hits = boardId === liveBoardId && liveItems
        ? filterItems(liveItems, { query: q })
        : (searchHits.get(boardId) || []);
      return { loading: search.loading && !hits.length, shelves: shelve(hits, null) };
    }
    if (boardId === liveBoardId && liveItems) {
      return { loading: false, shelves: shelve(sortItems(liveItems, sort), null) };
    }
    const entry = contents[boardId];
    if (!entry || (entry.status === 'loading' && !Object.keys(entry.byShelf).length)) {
      return { loading: true, shelves: [] };
    }
    const own = counts.own.get(boardId);
    const items = Object.values(entry.byShelf).flatMap((s) => s.items);
    return {
      loading: entry.status === 'loading',
      shelves: shelve(items, (shelfId, shownCount) => {
        // A whole load knows its own totals; a peek takes them from the
        // counts, and a shelf chip shows its own shelf and nothing else.
        if (needsWhole) return shownCount;
        if (chip !== 'all' && shelfId !== chip) return 0;
        return Math.max(own?.byShelf?.[shelfId] || 0, shownCount);
      }),
    };
  }, [q, liveBoardId, liveItems, searchHits, search.loading, shelve, sort, contents, counts, needsWhole, chip]);

  // Whether the server has more of a shelf than the sidebar holds.
  const canLoadMore = useCallback((boardId, shelfId) => {
    if (q || boardId === liveBoardId) return false;
    const entry = contents[boardId];
    return !!entry && !entry.byShelf?.[shelfId]?.done;
  }, [q, liveBoardId, contents]);

  // Clusters a search touches: any with a hit, and any whose name matches.
  const searchClusterIds = useMemo(() => {
    if (!q) return null;
    const needle = q.toLowerCase();
    const ids = new Set(searchHits.keys());
    if (liveBoardId && liveItems && filterItems(liveItems, { query: q }).length) ids.add(liveBoardId);
    for (const b of boards) if ((b.name || '').toLowerCase().includes(needle)) ids.add(b.id);
    return ids;
  }, [q, searchHits, liveBoardId, liveItems, boards]);

  // ── Recent and Starred ────────────────────────────────────────────────────
  const recent = useMemo(
    () => recentRows.map((r) => itemFromIndexRow(r, r.board_id)).filter(Boolean),
    [recentRows],
  );
  const starred = useMemo(() => {
    const clusters = [];
    const items = [];
    for (const r of starredRows) {
      if (r.kind === 'cluster') clusters.push({ boardId: r.board_id, name: r.title || 'Untitled cluster' });
      else {
        const item = itemFromIndexRow(r, r.board_id);
        if (item) items.push(item);
      }
    }
    return { clusters, items };
  }, [starredRows]);
  const starKeys = useMemo(
    () => new Set(starredRows.map((r) => `${r.board_id}:${r.card_id || ''}`)),
    [starredRows],
  );
  const isStarred = useCallback((boardId, cardId = '') => starKeys.has(`${boardId}:${cardId || ''}`), [starKeys]);

  const toggleStar = useCallback(async (boardId, cardId = '') => {
    if (!boardId) return;
    const key = `${boardId}:${cardId || ''}`;
    if (source?.toggleStar) {
      await source.toggleStar(boardId, cardId || '', !starKeys.has(key));
      fetchStarred();
      return;
    }
    if (!supabase) return;
    const ws = allBoards?.[boardId]?.workspace_id || workspaceId;
    if (starKeys.has(key)) {
      setStarredRows((rows) => rows.filter((r) => `${r.board_id}:${r.card_id || ''}` !== key));
      const { error } = await supabase.from('starred_items').delete()
        .eq('board_id', boardId).eq('card_id', cardId || '');
      if (error) console.warn('[sidebar] unstar', error.message || error);
    } else {
      const { error } = await supabase.from('starred_items')
        .insert({ workspace_id: ws, board_id: boardId, card_id: cardId || '' });
      if (error) console.warn('[sidebar] star', error.message || error);
    }
    fetchStarred();
  }, [starKeys, allBoards, workspaceId, fetchStarred, source]);

  return {
    counts,
    countOf: (boardId) => (counts.chipRolled.get(boardId)?.total || 0),
    totalOf: (boardId) => (counts.rolled.get(boardId)?.total || 0),
    ownTotalOf: (boardId) => (counts.own.get(boardId)?.total || 0),
    contentsOf, ensure, loadMore, canLoadMore, refresh,
    searching: !!q, searchLoading: search.loading, searchClusterIds,
    recent, starred, isStarred, toggleStar,
  };
}
