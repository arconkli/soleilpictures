import { useEffect, useState, useMemo } from 'react';
import { listBoardChannels, listDmThreads, listMessageReadsForUser, getUnreadCounts } from '../lib/messages.js';

// Returns the unified Messages-panel list:
//   { boardChannels: [...], dmThreads: [...], unreadByKey: Map, hidden: Set }
// Re-fetches on mount + on `refreshTick` change. Realtime updates are layered
// on by the caller (when a chat-message broadcast fires, bump refreshTick).
export function useChannelList({ workspaceId, userId, refreshTick = 0 }) {
  const [boards, setBoards] = useState([]);
  const [dms,    setDms]    = useState([]);
  const [reads,  setReads]  = useState([]);
  // Real per-channel counts from get_unread_counts() (migration 0020).
  // Shape: { "b:<board>": 5, "d:<peer>": 2, ... }
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    (async () => {
      const [b, d, r, c] = await Promise.all([
        listBoardChannels({ workspaceId }),
        listDmThreads({ workspaceId }),
        listMessageReadsForUser({ userId }),
        getUnreadCounts(),
      ]);
      if (cancelled) return;
      setBoards(b); setDms(d); setReads(r); setCounts(c || {});
    })();
    return () => { cancelled = true; };
  }, [workspaceId, userId, refreshTick]);

  const { unreadByKey, hidden } = useMemo(() => {
    const readsByKey = new Map();
    const hiddenSet = new Set();
    for (const r of reads) {
      const key = r.reads_board_id ? `b:${r.reads_board_id}` : `d:${r.reads_dm_peer}`;
      readsByKey.set(key, r);
      if (r.hidden_at) hiddenSet.add(key);
    }
    // Real counts come from get_unread_counts(); fall back to the
    // binary "anything newer than last_read_at" if the RPC fails.
    const unread = new Map();
    for (const ch of boards) {
      const key = `b:${ch.board_id}`;
      const real = counts[key];
      if (typeof real === 'number') {
        unread.set(key, real);
      } else {
        const r = readsByKey.get(key);
        const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
        const lastMsg  = ch.last_message_at ? new Date(ch.last_message_at) : new Date(0);
        unread.set(key, lastMsg > lastRead ? 1 : 0);
      }
    }
    for (const t of dms) {
      const peer = t.user_a === userId ? t.user_b : t.user_a;
      const key = `d:${peer}`;
      const real = counts[key];
      if (typeof real === 'number') {
        unread.set(key, real);
      } else {
        const r = readsByKey.get(key);
        const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
        const lastMsg  = t.last_message_at ? new Date(t.last_message_at) : new Date(0);
        unread.set(key, lastMsg > lastRead ? 1 : 0);
      }
    }
    return { unreadByKey: unread, hidden: hiddenSet };
  }, [boards, dms, reads, counts, userId]);

  return { boardChannels: boards, dmThreads: dms, unreadByKey, hidden };
}
