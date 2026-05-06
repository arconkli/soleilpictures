import { useEffect, useState, useCallback } from 'react';
import { fetchBoardChannelMessages, fetchDmThreadMessages, markRead } from '../lib/messages.js';
import { subscribeBoardChat, subscribeDmChat } from '../lib/messageRealtime.js';

// Returns { messages, typingUsers, refetch } for a single thread.
//   thread = { kind:'board', boardId, name } | { kind:'dm', peerId, name }
//   userId = current user (for marking read + filtering self typing)
export function useMessageThread({ workspaceId, userId, thread }) {
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Map()); // userId → ts

  const refetch = useCallback(async () => {
    if (!workspaceId || !thread) return;
    let rows = [];
    if (thread.kind === 'board') rows = await fetchBoardChannelMessages({ boardId: thread.boardId });
    else if (thread.kind === 'dm') rows = await fetchDmThreadMessages({ workspaceId, userA: userId, userB: thread.peerId });
    setMessages(rows);
  }, [workspaceId, userId, thread?.kind, thread?.boardId, thread?.peerId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Mark read whenever the thread or its message list changes.
  useEffect(() => {
    if (!userId || !thread) return;
    if (thread.kind === 'board') markRead({ userId, boardId: thread.boardId });
    if (thread.kind === 'dm')    markRead({ userId, dmPeerId: thread.peerId });
  }, [userId, thread?.kind, thread?.boardId, thread?.peerId, messages.length]);

  // Realtime subscribe.
  useEffect(() => {
    if (!thread) return;
    const onMessage = () => {
      console.log('[chat-rt] onMessage → refetch');
      refetch();
    };
    const onTyping = ({ user_id, ts }) => {
      if (user_id === userId) return;
      setTypingUsers(m => { const next = new Map(m); next.set(user_id, ts); return next; });
      setTimeout(() => {
        setTypingUsers(m => {
          const stamp = m.get(user_id);
          if (stamp === ts) { const next = new Map(m); next.delete(user_id); return next; }
          return m;
        });
      }, 3000);
    };
    let unsub = () => {};
    if (thread.kind === 'board') unsub = subscribeBoardChat({ boardId: thread.boardId, onMessage, onTyping });
    if (thread.kind === 'dm')    unsub = subscribeDmChat({ userA: userId, userB: thread.peerId, onMessage, onTyping });
    return () => unsub();
  }, [thread?.kind, thread?.boardId, thread?.peerId, userId, refetch]);

  return { messages, typingUsers, refetch };
}
