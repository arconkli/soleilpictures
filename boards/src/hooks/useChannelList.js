import { useEffect, useState, useMemo } from 'react';
import { listBoardChannels, listDmThreads, listMessageReadsForUser } from '../lib/messages.js';

// Returns the unified Messages-panel list:
//   { boardChannels: [...], dmThreads: [...], unreadByKey: Map, hidden: Set }
// Re-fetches on mount + on `refreshTick` change. Realtime updates are layered
// on by the caller (when a chat-message broadcast fires, bump refreshTick).
export function useChannelList({ workspaceId, userId, refreshTick = 0 }) {
  const [boards, setBoards] = useState([]);
  const [dms,    setDms]    = useState([]);
  const [reads,  setReads]  = useState([]);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    (async () => {
      const [b, d, r] = await Promise.all([
        listBoardChannels({ workspaceId }),
        listDmThreads({ workspaceId }),
        listMessageReadsForUser({ userId }),
      ]);
      if (cancelled) return;
      setBoards(b); setDms(d); setReads(r);
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
    const unread = new Map();
    for (const ch of boards) {
      const r = readsByKey.get(`b:${ch.board_id}`);
      const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
      const lastMsg  = ch.last_message_at ? new Date(ch.last_message_at) : new Date(0);
      unread.set(`b:${ch.board_id}`, lastMsg > lastRead ? 1 : 0);
    }
    for (const t of dms) {
      const peer = t.user_a === userId ? t.user_b : t.user_a;
      const r = readsByKey.get(`d:${peer}`);
      const lastRead = r?.last_read_at ? new Date(r.last_read_at) : new Date(0);
      const lastMsg  = t.last_message_at ? new Date(t.last_message_at) : new Date(0);
      unread.set(`d:${peer}`, lastMsg > lastRead ? 1 : 0);
    }
    return { unreadByKey: unread, hidden: hiddenSet };
  }, [boards, dms, reads, userId]);

  return { boardChannels: boards, dmThreads: dms, unreadByKey, hidden };
}
