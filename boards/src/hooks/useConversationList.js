import { useEffect, useState, useMemo } from 'react';
import { listConversations, listMyConversationParticipants, getUnreadCounts } from '../lib/messages.js';

// Returns the unified Messages-panel list:
//   {
//     conversations: [...conversation_summary rows],
//     participantsByConv: Map<conversationId, [{user_id, left_at, last_read_at, ...}]>,
//     myStateByConv: Map<conversationId, { left_at, last_read_at }>,
//     unreadByConv: Map<conversationId, number>,
//   }
// Re-fetches on mount + on `refreshTick` change. Bump refreshTick from
// the caller after any markRead / new message / addParticipant /
// rename / leave so the panel stays in sync.
export function useConversationList({ workspaceId, userId, refreshTick = 0 }) {
  const [conversations, setConversations] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    (async () => {
      const [convs, parts, c] = await Promise.all([
        listConversations({ workspaceId }),
        listMyConversationParticipants({ workspaceId }),
        getUnreadCounts(),
      ]);
      if (cancelled) return;
      setConversations(convs);
      setParticipants(parts);
      setCounts(c || {});
    })();
    return () => { cancelled = true; };
  }, [workspaceId, userId, refreshTick]);

  const { participantsByConv, myStateByConv, unreadByConv } = useMemo(() => {
    const byConv = new Map();
    const mine = new Map();
    for (const p of participants) {
      const list = byConv.get(p.conversation_id) || [];
      list.push(p);
      byConv.set(p.conversation_id, list);
      if (p.user_id === userId) mine.set(p.conversation_id, p);
    }
    const unread = new Map();
    for (const conv of conversations) {
      const v = counts[conv.conversation_id];
      unread.set(conv.conversation_id, typeof v === 'number' ? v : 0);
    }
    return { participantsByConv: byConv, myStateByConv: mine, unreadByConv: unread };
  }, [conversations, participants, counts, userId]);

  return { conversations, participantsByConv, myStateByConv, unreadByConv };
}
