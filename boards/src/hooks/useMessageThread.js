import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchConversationMessages, markRead } from '../lib/messages.js';
import { subscribeConversation } from '../lib/messageRealtime.js';

// Returns { messages, typingUsers, refetch } for a single conversation.
//   conversationId — the conversation to load
//   userId         — current user (filters self typing, marks read)
//   onMarkedRead   — optional callback fired after a successful
//                    last_read_at write, so the parent (useConversationList)
//                    can refresh its unread counts. Fixes the
//                    "stuck at 1" bug from the old useChannelList.
export function useMessageThread({ conversationId, userId, onMarkedRead }) {
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Map()); // userId → ts
  const onMarkedReadRef = useRef(onMarkedRead);
  onMarkedReadRef.current = onMarkedRead;

  const refetch = useCallback(async () => {
    if (!conversationId) { setMessages([]); return; }
    const rows = await fetchConversationMessages({ conversationId });
    setMessages(rows);
  }, [conversationId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Mark read whenever the conversation opens or new messages arrive.
  // After marking, notify the parent so unread counts refresh.
  useEffect(() => {
    if (!userId || !conversationId) return;
    let cancelled = false;
    (async () => {
      const ok = await markRead({ conversationId, userId });
      if (cancelled) return;
      if (ok) onMarkedReadRef.current?.();
    })();
    return () => { cancelled = true; };
  }, [userId, conversationId, messages.length]);

  // Realtime subscribe.
  useEffect(() => {
    if (!conversationId) return;
    const onMessage = () => refetch();
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
    const unsub = subscribeConversation({ conversationId, onMessage, onTyping });
    return () => unsub();
  }, [conversationId, userId, refetch]);

  return { messages, typingUsers, refetch };
}
