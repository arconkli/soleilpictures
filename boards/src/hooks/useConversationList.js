import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { listConversations, listMyConversationParticipants, getUnreadCounts } from '../lib/messages.js';
import { supabase } from '../lib/supabase.js';
import { subscribeInbox } from '../lib/inboxBus.js';

// Returns the unified Messages-panel list:
//   {
//     conversations: [...conversation_summary rows],
//     participantsByConv: Map<conversationId, [{user_id, left_at, last_read_at, ...}]>,
//     myStateByConv: Map<conversationId, { left_at, last_read_at }>,
//     unreadByConv: Map<conversationId, number>,
//   }
// Re-fetches on:
//   - mount + workspace/user change
//   - external `refreshTick` bump (legacy callers)
//   - postgres_changes on conversations + conversation_participants
//     (debounced 350ms to coalesce trigger bursts)
//   - inboxBus ping for the current user (optimistic +1 unread)
export function useConversationList({ workspaceId, userId, refreshTick = 0 }) {
  const [conversations, setConversations] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [counts, setCounts] = useState({});
  // True once the first fetch settles — lets the panel show a skeleton
  // instead of flashing "No conversations yet" while the list loads.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId || !userId) return;
    const [convs, parts, c] = await Promise.all([
      listConversations({ workspaceId }),
      listMyConversationParticipants({ workspaceId }),
      getUnreadCounts(),
    ]);
    setConversations(convs);
    setParticipants(parts);
    setCounts(c || {});
  }, [workspaceId, userId]);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    (async () => {
      try { await refresh(); } catch (_) {}
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, userId, refreshTick, refresh]);

  // Realtime: postgres_changes on conversations + conversation_participants.
  // RLS already filters wire traffic to my participations (0058), so we
  // don't need server-side filters on conversations. For participant
  // INSERTs we filter to user_id=me so we don't get spammed when peers
  // join group chats we're not in.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (!supabase || !workspaceId || !userId) return;
    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        refresh().catch(() => {});
      }, 350);
    };
    const ch = supabase.channel(`conv-list:${userId}:${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, schedule)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, userId, refresh]);

  // Optimistic unread bump: when the inbox bus fires a ping for a
  // conversation in this workspace, bump the count immediately. The
  // debounced refetch (next 350ms) reconciles against ground truth.
  useEffect(() => {
    if (!userId || !workspaceId) return;
    return subscribeInbox(userId, (payload) => {
      if (!payload || !payload.conversation_id) return;
      // Unified inbox: bump for any conversation we participate in, regardless
      // of which workspace it's anchored to (DMs with board collaborators live
      // in the starter's workspace). The debounced refetch reconciles truth.
      setCounts(prev => ({
        ...prev,
        [payload.conversation_id]: (Number(prev[payload.conversation_id]) || 0) + 1,
      }));
    });
  }, [userId, workspaceId]);

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

  return { conversations, participantsByConv, myStateByConv, unreadByConv, loaded };
}
