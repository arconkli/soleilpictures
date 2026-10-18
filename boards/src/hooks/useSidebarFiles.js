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
// The most one call returns per shelf (0419 caps p_limit at 200).
const BATCH = 200;
// Grouping by canvas group needs a cluster whole — a group can sit anywhere in
// the order — so in that mode its shelves are paged to the end, this far.
const WHOLE_MAX = 2000;
const REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 200;
// card_index trails a cluster you just left by the client's sync debounce.
const LEFT_RELOAD_MS = 1500;

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

const depthOf = (entry) => Math.max(0, ...Object.values(entry?.byShelf || {}).map((sh) => sh.items.length));

// `source` swaps the network out — { rpc(fn, params), search(params),
// toggleStar(boardId, cardId, on) } — for the dev-only sidebar QA harness
// (?sidebarqa=1) and nothing else. `liveGroupNames` (a Map) names the open
// cluster's canvas groups.
export function useSidebarFiles({
  enabled = true, workspaceId, boards = [], allBoards = {}, liveBoardId = null, liveCards = null,
  liveGroupNames = null, sort = 'newest', groupBy = 'type', chip = 'all', query = '', source = null,
}) {
  const call = source?.rpc || rpc;
  const find = source?.search || searchEntities;
  const [countRows, setCountRows] = useState([]);
  const [contents, setContents] = useState({});   // boardId → { status, byShelf, key, gen }
  const [recentRows, setRecentRows] = useState([]);
  const [starredRows, setStarredRows] = useState([]);
  const [search, setSearch] = useState({ q: '', rows: [], loading: false });
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  // Answers can come back in any order. Each load takes a generation, and
  // only the latest one for a cluster may land; workspace-wide reads check the
  // workspace they were asked for is still the one on screen.
  const genRef = useRef(0);
  const latestGen = useRef({});        // boardId → the generation allowed to land
  const asked = useRef({});            // boardId → the key a load is already out for
  const wsRef = useRef(workspaceId);
  wsRef.current = workspaceId;
  const countsSeq = useRef(0);

  const boardIds = useMemo(() => boards.map((b) => b.id).filter(Boolean), [boards]);
  const boardIdsKey = boardIds.join(',');
  const whole = groupBy === 'canvas';
  const storedOnly = chip === 'unplaced';
  // A loaded cluster belongs to one sort (the server orders it), one depth and
  // one filter (Not on board is asked of the server, 0420's p_unplaced).
  const loadKey = `${sort}|${whole ? 'whole' : 'peek'}|${storedOnly ? 'stored' : 'all'}`;
  const params = useCallback((boardId, extra) => ({
    p_board_id: boardId, p_sort: sort, ...(storedOnly ? { p_unplaced: true } : {}), ...extra,
  }), [sort, storedOnly]);

  const fetchCounts = useCallback(async () => {
    if (!enabled || !boardIds.length) { setCountRows([]); return; }
    const seq = ++countsSeq.current;
    const rows = await call('sidebar_shelf_counts', { p_board_ids: boardIds });
    if (rows && seq === countsSeq.current) setCountRows(rows);
  }, [enabled, boardIdsKey, call]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRecent = useCallback(async () => {
    if (!enabled || !workspaceId) return;
    const rows = await call('sidebar_recent', { p_workspace_id: workspaceId, p_limit: 8 });
    if (rows && wsRef.current === workspaceId) setRecentRows(rows);
  }, [enabled, workspaceId, call]);

  const fetchStarred = useCallback(async () => {
    if (!enabled || !workspaceId) return;
    const rows = await call('sidebar_starred', { p_workspace_id: workspaceId });
    if (rows && wsRef.current === workspaceId) setStarredRows(rows);
  }, [enabled, workspaceId, call]);

  // One cluster's shelves: the peek, or — on a refresh — as deep as the person
  // had paged, or the whole of every shelf (canvas groups). A shelf is only
  // `done` when a call came back short: a full page means there may be more,
  // and the shelf says so instead of quietly stopping.
  const loadPeek = useCallback(async (boardId, key, depth = 0) => {
    const gen = ++genRef.current;
    latestGen.current[boardId] = gen;
    asked.current[boardId] = key;
    const current = () => latestGen.current[boardId] === gen;
    setContents((c) => ({ ...c, [boardId]: { status: 'loading', byShelf: c[boardId]?.byShelf || {}, key, gen } }));
    const first = whole ? BATCH : Math.min(BATCH, Math.max(PEEK_PER_SHELF, depth));
    const rows = await call('sidebar_cluster_items', params(boardId, { p_shelf: null, p_offset: 0, p_limit: first }));
    if (!current()) return;
    if (!rows) {
      if (asked.current[boardId] === key) delete asked.current[boardId];
      setContents((c) => (c[boardId]?.gen === gen ? { ...c, [boardId]: { ...c[boardId], status: 'error' } } : c));
      return;
    }
    const byShelf = byShelfFrom(rows, boardId);
    for (const sh of Object.values(byShelf)) sh.done = sh.items.length < first;
    const target = whole ? WHOLE_MAX : depth;
    for (const [shelfId, sh] of Object.entries(byShelf)) {
      while (!sh.done && sh.items.length < target) {
        const want = Math.min(BATCH, target - sh.items.length);
        const more = await call('sidebar_cluster_items', params(boardId, { p_shelf: shelfId, p_offset: sh.items.length, p_limit: want }));
        if (!current()) return;
        if (!more) break;
        const seen = new Set(sh.items.map((i) => i.cardId));
        for (const r of more) {
          const it = itemFromIndexRow(r, boardId);
          if (it && !seen.has(it.cardId)) sh.items.push(it);
        }
        if (more.length < want) sh.done = true;
      }
    }
    if (asked.current[boardId] === key) delete asked.current[boardId];
    setContents((c) => (c[boardId]?.gen === gen ? { ...c, [boardId]: { status: 'ready', byShelf, key, gen } } : c));
  }, [whole, params, call]);

  // Unfolding a cluster asks for its peek; asking again is free.
  const ensure = useCallback((boardId) => {
    if (!enabled || !boardId || boardId === liveBoardId) return;
    const cur = contentsRef.current[boardId];
    if (cur && cur.key === loadKey && cur.status !== 'error') return;
    if (asked.current[boardId] === loadKey) return;
    loadPeek(boardId, loadKey);
  }, [enabled, liveBoardId, loadKey, loadPeek]);

  const loadMore = useCallback(async (boardId, shelfId) => {
    const cur = contentsRef.current[boardId];
    if (!cur || cur.status === 'loading') return;
    const { gen } = cur;
    const have = cur.byShelf?.[shelfId]?.items?.length || 0;
    const rows = await call('sidebar_cluster_items', params(boardId, { p_shelf: shelfId, p_offset: have, p_limit: PAGE }));
    if (!rows) return;
    setContents((c) => {
      const entry = c[boardId];
      // A refresh or a new sort replaced this cluster while the page was out,
      // so its offset no longer points anywhere.
      if (!entry || entry.gen !== gen) return c;
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
  }, [params, call]);

  // A new sort, depth or filter reorders every closed cluster: reload what was
  // loaded (ensure() sees `asked` and doesn't ask twice in the same commit).
  useEffect(() => {
    for (const [id, entry] of Object.entries(contentsRef.current)) {
      if (entry.key !== loadKey && asked.current[id] !== loadKey) loadPeek(id, loadKey);
    }
  }, [loadKey, loadPeek]);

  const refresh = useCallback(() => {
    fetchCounts();
    fetchRecent();
    fetchStarred();
    for (const [id, entry] of Object.entries(contentsRef.current)) loadPeek(id, loadKey, depthOf(entry));
  }, [fetchCounts, fetchRecent, fetchStarred, loadPeek, loadKey]);

  // The cluster you just left was read before you changed it: read it again
  // once its card_index has caught up.
  const prevLive = useRef(liveBoardId);
  useEffect(() => {
    const left = prevLive.current;
    prevLive.current = liveBoardId;
    if (!left || left === liveBoardId || !contentsRef.current[left]) return undefined;
    const t = setTimeout(() => {
      const entry = contentsRef.current[left];
      if (entry) loadPeek(left, loadKey, depthOf(entry));
    }, LEFT_RELOAD_MS);
    return () => clearTimeout(t);
  }, [liveBoardId]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setContents({});
    setSearch({ q: '', rows: [], loading: false });
    setRecentRows([]);
    setStarredRows([]);
    latestGen.current = {};
    asked.current = {};
  }, [workspaceId]);
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
  // readCards hands back the same object for a card that didn't change, so
  // only what changed is projected again on each edit.
  const itemCache = useRef(new WeakMap());
  const liveItems = useMemo(() => {
    if (!liveBoardId || !Array.isArray(liveCards)) return null;
    const out = [];
    for (const c of liveCards) {
      if (!c) continue;
      const hit = itemCache.current.get(c);
      if (hit && hit.boardId === liveBoardId && hit.groups === liveGroupNames) {
        if (hit.item) out.push(hit.item);
        continue;
      }
      const item = itemFromCard(c, { boardId: liveBoardId, workspaceId, groupNameById: liveGroupNames });
      itemCache.current.set(c, { item, boardId: liveBoardId, groups: liveGroupNames });
      if (item) out.push(item);
    }
    return out;
  }, [liveBoardId, liveCards, liveGroupNames, workspaceId]);

  // ── Numbers ───────────────────────────────────────────────────────────────
  const chipRows = useMemo(() => {
    if (chip === 'all') return countRows;
    if (chip === 'unplaced') return countRows.map((r) => ({ ...r, n: r.n_unplaced || 0 }));
    return countRows.filter((r) => r.shelf === chip);
  }, [countRows, chip]);
  // What the server says each closed cluster holds, for the shelves' totals.
  const serverChipOwn = useMemo(() => countsFromRows(chipRows), [chipRows]);
  const counts = useMemo(() => {
    const scoped = (rows, items) => {
      let own = countsFromRows(rows);
      if (liveBoardId && liveItems) own = withLive(own, liveBoardId, countsFromItems(items));
      return { own, rolled: rollupCounts(boards, own) };
    };
    const all = scoped(countRows, liveItems || []);
    if (chip === 'all') return { ...all, chipRolled: all.rolled, chipOwn: all.own };
    const chipped = scoped(chipRows, filterItems(liveItems || [], { chip }));
    return { ...all, chipRolled: chipped.rolled, chipOwn: chipped.own };
  }, [countRows, chipRows, liveItems, liveBoardId, boards, chip]);

  // ── Contents, shelved ─────────────────────────────────────────────────────
  const shelve = useCallback((items, totals) => {
    const visible = filterItems(items, { chip });
    if (groupBy === 'canvas') {
      return groupItems(visible, { groupBy: 'canvas' }).map((sh) => ({ ...sh, total: sh.items.length }));
    }
    return SHELVES.map((sh) => {
      const mine = visible.filter((i) => i.shelf === sh.id);
      const total = totals ? totals(sh.id, mine.length) : mine.length;
      return { ...sh, items: mine, total };
    }).filter((sh) => sh.total > 0 || sh.items.length > 0);
  }, [chip, groupBy]);

  const liveContents = useMemo(() => {
    if (!liveBoardId || !liveItems) return null;
    const items = q ? filterItems(liveItems, { query: q }) : sortItems(liveItems, sort);
    return { loading: false, shelves: shelve(items, null), searching: !!q };
  }, [liveBoardId, liveItems, q, sort, shelve]);

  // Closed clusters' contents are kept per cluster until something they're
  // made of changes, so an edit on the open canvas re-renders none of them.
  const closedCache = useMemo(
    () => new Map(),
    [contents, serverChipOwn, shelve, q, searchHits, search.loading, whole, chip],
  );
  const contentsOf = useCallback((boardId) => {
    if (boardId === liveBoardId && liveContents) return liveContents;
    if (closedCache.has(boardId)) return closedCache.get(boardId);
    let out;
    if (q) {
      const hits = searchHits.get(boardId) || [];
      out = { loading: search.loading && !hits.length, shelves: shelve(hits, null), searching: true };
    } else {
      const entry = contents[boardId];
      if (!entry || (entry.status === 'loading' && !Object.keys(entry.byShelf).length)) {
        out = { loading: true, shelves: [] };
      } else {
        const own = serverChipOwn.get(boardId);
        const items = Object.values(entry.byShelf).flatMap((sh) => sh.items);
        out = {
          loading: entry.status === 'loading',
          shelves: shelve(items, (shelfId, shownCount) => {
            // Whole clusters know their own totals; a peek takes them from
            // the counts, and a shelf chip shows its own shelf and nothing else.
            if (whole) return shownCount;
            if (chip !== 'all' && chip !== 'unplaced' && shelfId !== chip) return 0;
            return Math.max(own?.byShelf?.[shelfId] || 0, shownCount);
          }),
        };
      }
    }
    closedCache.set(boardId, out);
    return out;
  }, [liveBoardId, liveContents, closedCache, q, searchHits, search.loading, shelve, contents, serverChipOwn, whole, chip]);

  // Whether the server has more of a shelf than the sidebar holds.
  const canLoadMore = useCallback((boardId, shelfId) => {
    if (q || whole || boardId === liveBoardId) return false;
    const entry = contents[boardId];
    return !!entry && !entry.byShelf?.[shelfId]?.done;
  }, [q, whole, liveBoardId, contents]);

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
  // A starred card is keyed where it is now (0420's sidebar_starred follows it
  // by id), which is also where the sidebar shows it.
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
      // A card's star may still be filed under the cluster it was starred in,
      // so it is found by the card's id within the workspace; a cluster's star
      // is its own row.
      const del = supabase.from('starred_items').delete().eq('workspace_id', ws);
      const { error } = cardId
        ? await del.eq('card_id', cardId)
        : await del.eq('board_id', boardId).eq('card_id', '');
      if (error) console.warn('[sidebar] unstar', error.message || error);
    } else {
      const { error } = await supabase.from('starred_items')
        .insert({ workspace_id: ws, board_id: boardId, card_id: cardId || '' });
      if (error) console.warn('[sidebar] star', error.message || error);
    }
    fetchStarred();
  }, [starKeys, allBoards, workspaceId, fetchStarred, source]);

  const countOf = useCallback((boardId) => (counts.chipRolled.get(boardId)?.total || 0), [counts]);
  const totalOf = useCallback((boardId) => (counts.rolled.get(boardId)?.total || 0), [counts]);
  const ownTotalOf = useCallback((boardId) => (counts.own.get(boardId)?.total || 0), [counts]);
  // A cluster's own files only, as the chip sees them: the count on its files line.
  const ownCountOf = useCallback((boardId) => (counts.chipOwn.get(boardId)?.total || 0), [counts]);

  return useMemo(() => ({
    counts, countOf, totalOf, ownTotalOf, ownCountOf,
    contentsOf, ensure, loadMore, canLoadMore, refresh,
    searching: !!q, searchLoading: search.loading, searchClusterIds,
    recent, starred, isStarred, toggleStar,
  }), [counts, countOf, totalOf, ownTotalOf, ownCountOf, contentsOf, ensure, loadMore, canLoadMore, refresh,
    q, search.loading, searchClusterIds, recent, starred, isStarred, toggleStar]);
}
