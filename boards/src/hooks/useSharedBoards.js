// Boards the caller has access to via a per-board share but is NOT a
// workspace member of — PLUS every descendant of those boards (0244), so a
// shared production carries its shoot-day clusters with it. Powers the sidebar
// "Shared with you" section (roots only) and the boards map (everything).
//
// Refetches when the caller's user.id changes (login/logout). Consumers
// can call refresh() after sharing/unsharing to update immediately.
//
// meta (0901) says, per shared root, when it was shared with you, whether
// you've opened it since and whether you took it off your list. It is read
// once the page has settled, never on the boot path (lib/afterBoot.js), and
// again whenever the set of shared roots changes. patchMeta changes it here
// first when you open or remove one; a refetch that hasn't caught up yet
// doesn't undo that.

import { useEffect, useState, useCallback, useRef } from 'react';
import { listSharedBoards, listSharedBoardMeta, listMyBoardShares } from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';
import { takeBootResponse, peekBootRows } from '../lib/bootPrefetch.js';
import { afterBoot } from '../lib/afterBoot.js';
import { sharedMetaMap, patchSharedMeta } from '../lib/sharedList.js';
import { sharedBoardUpdateNeedsRefetch } from '../lib/boardEventGates.js';

const rootsKey = (rows) => (rows || [])
  .filter((r) => r && r.is_shared_root !== false)
  .map((r) => r.board_id)
  .sort()
  .join(',');

export function useSharedBoards(userId, memberWorkspaceIds) {
  // The read bootPrefetch started at sign-in: held from the first render when
  // it has landed, and taken by the first fetch either way.
  const [seed] = useState(() => (userId ? peekBootRows('shared', userId) : null));
  const [shared, setShared] = useState(() => seed || []);
  const sharedRef = useRef(shared);       // the list as last rendered, for the realtime check
  sharedRef.current = shared;
  const memberWsRef = useRef(memberWorkspaceIds); // your workspaces, kept current without resubscribing
  memberWsRef.current = memberWorkspaceIds;
  const [loading, setLoading] = useState(false);
  // True once the first fetch has settled (either way). App prunes its
  // navigation stack of ids it can't find; before this, a reload inside a
  // shared cluster could prune it in the gap between the workspace's own list
  // arriving and this one, and land the user on their root.
  const [loaded, setLoaded] = useState(!userId || !!seed);

  const [meta, setMeta] = useState(() => new Map());
  const [metaLoaded, setMetaLoaded] = useState(false);
  // The clusters you've shared (list_my_board_shares): the Shared page's By
  // you, and whether the sidebar offers All shared when nothing is shared
  // with you. Read after boot, and again when the page opens.
  const [byYou, setByYou] = useState([]);
  const [byYouLoaded, setByYouLoaded] = useState(false);
  const metaReadyRef = useRef(false);        // the after-boot read has started
  const metaSeqRef = useRef(0);              // only the newest read lands
  const pendingRef = useRef(new Map());      // board_id → a change not yet read back
  const lastRootsRef = useRef(seed ? rootsKey(seed) : null);

  const loadMeta = useCallback(async () => {
    if (!userId) { setMeta(new Map()); return; }
    const seq = ++metaSeqRef.current;
    let rows;
    try {
      rows = await listSharedBoardMeta();
    } catch (e) {
      console.warn('[shared-boards] meta fetch failed', e);
      return;
    }
    if (seq !== metaSeqRef.current) return;
    let next = sharedMetaMap(rows);
    for (const [id, patch] of [...pendingRef.current]) {
      const got = next.get(id);
      if (!got) { pendingRef.current.delete(id); continue; }
      const caughtUp = (!('openedAt' in patch) || !!got.openedAt === !!patch.openedAt)
        && (!('hiddenAt' in patch) || !!got.hiddenAt === !!patch.hiddenAt);
      if (caughtUp) pendingRef.current.delete(id);
      else next = patchSharedMeta(next, id, patch);
    }
    setMeta(next);
    setMetaLoaded(true);
  }, [userId]);

  const byYouSeqRef = useRef(0);
  const refreshByYou = useCallback(async () => {
    if (!userId) { setByYou([]); setByYouLoaded(true); return; }
    const seq = ++byYouSeqRef.current;
    try {
      const rows = await listMyBoardShares();
      if (seq === byYouSeqRef.current) setByYou(rows);
    } catch (e) {
      console.warn('[shared-boards] by-you fetch failed', e);
    } finally {
      if (seq === byYouSeqRef.current) setByYouLoaded(true);
    }
  }, [userId]);

  const patchMeta = useCallback((boardId, patch) => {
    if (!boardId || !patch) return;
    pendingRef.current.set(boardId, { ...(pendingRef.current.get(boardId) || {}), ...patch });
    setMeta((m) => patchSharedMeta(m, boardId, patch));
  }, []);

  // Read meta again, once the after-boot read has started (never on the boot
  // path). A share that comes back after an unshare keeps the same set of
  // roots, so the list refetch alone doesn't notice it.
  const refreshMeta = useCallback(() => {
    if (metaReadyRef.current) loadMeta();
  }, [loadMeta]);

  // The server has the change patchMeta made: forget the patch, so a later
  // re-share isn't covered by it, and read meta again. Starting a new read
  // also drops any read already in flight from before the change.
  const settleMeta = useCallback((boardId) => {
    if (boardId) pendingRef.current.delete(boardId);
    refreshMeta();
  }, [refreshMeta]);

  const bootRef = useRef(true);
  const refresh = useCallback(async () => {
    if (!userId) { setShared([]); setLoaded(true); return; }
    const taken = bootRef.current ? takeBootResponse('shared', userId) : null;
    bootRef.current = false;
    setLoading(true);
    try {
      let rows;
      if (taken) {
        const { data, error } = await taken;
        rows = error ? await listSharedBoards() : (data || []);
      } else {
        rows = await listSharedBoards();
      }
      setShared(rows);
      // A share came or went: what's new changed with it.
      const key = rootsKey(rows);
      if (key !== lastRootsRef.current) {
        lastRootsRef.current = key;
        if (metaReadyRef.current) loadMeta();
      }
    } catch (e) {
      // Keep the last good list. A failed refetch (one of the realtime-driven
      // ones, mid-session) used to clear it, so a network blip dropped every
      // shared cluster from the boards map and ejected anyone inside one.
      console.warn('[shared-boards] fetch failed', e);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [userId, loadMeta]);

  useEffect(() => { refresh(); }, [refresh]);

  // The first read of meta waits until the page has done what the visit came
  // for: it decides only a dot and an order, never what opens.
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    metaReadyRef.current = false;
    afterBoot(() => {
      if (!alive) return;
      metaReadyRef.current = true;
      loadMeta();
      refreshByYou();
    }, { signedInApp: true });
    return () => { alive = false; };
  }, [userId, loadMeta, refreshByYou]);

  // Until now this hook had NO subscription at all — it fetched on mount and
  // then went quiet, so anything the owner changed was invisible to a
  // share-based collaborator until they reloaded. That was survivable when the
  // rows were just board names; it is not once a shared production's calendar
  // is drawn from these rows and a shoot date can move under you.
  //
  // No workspace filter is possible here (shared boards span workspaces by
  // definition), so this listens broadly and leans on Realtime applying RLS
  // per row: the only board events that arrive are ones this user may read.
  // Debounced at 350ms to match useBoardList, since a single move can arrive
  // as several row events.
  const timerRef = useRef(null);
  useEffect(() => {
    if (!supabase || !userId) return undefined;
    const schedule = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { refresh(); }, 350);
    };
    // Per-mount suffix, as useCanvasComments: <Workspace> remounts on every
    // workspace switch, and realtime-js hands a same-named channel that is
    // still LEAVING back to the new mount, where subscribe() is a no-op and
    // the bindings die with the leave. The list then stopped updating.
    const sfx = Math.random().toString(36).slice(2, 9);
    const ch = supabase
      .channel(`shared-boards:${userId}:${sfx}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (payload) => {
        // An UPDATE that changes nothing the list shows needs no read. `old`
        // holds only the key here, so compare the new row to the cached one.
        if (payload?.eventType === 'UPDATE') {
          const cached = (sharedRef.current || []).find((r) => r.board_id === payload.new?.id);
          if (!sharedBoardUpdateNeedsRefetch(cached, payload.new, memberWsRef.current)) return;
        }
        schedule();
      })
      .subscribe();
    return () => {
      clearTimeout(timerRef.current);
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [userId, refresh]);

  return {
    shared, loading, loaded, refresh,
    meta, metaLoaded, patchMeta, refreshMeta, settleMeta,
    byYou, byYouLoaded, refreshByYou,
  };
}
