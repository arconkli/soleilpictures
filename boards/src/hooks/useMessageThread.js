import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchConversationMessages, markRead } from '../lib/messages.js';
import { subscribeConversation } from '../lib/messageRealtime.js';
import { MESSAGE_PAGE, mergeNewestPage, prependOlder, lastMessageId } from '../lib/messagePaging.js';
import { tabIsAttended } from '../lib/threadAttention.js';

// Returns { messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder }
// for a single conversation. `messages` is the newest page plus whatever
// older history the reader has paged back to with loadOlder().
//   conversationId — the conversation to load
//   userId         — current user (filters self typing, marks read)
//   onMarkedRead   — optional callback fired after a successful
//                    last_read_at write, so the parent (useConversationList)
//                    can refresh its unread counts. Fixes the
//                    "stuck at 1" bug from the old useChannelList.
export function useMessageThread({ conversationId, userId, onMarkedRead }) {
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Map()); // userId → ts
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const onMarkedReadRef = useRef(onMarkedRead);
  onMarkedReadRef.current = onMarkedRead;
  // A fetch that resolves after a conversation switch must not paint the
  // previous thread into this one.
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const loadingOlderRef = useRef(false);
  // Set once "load older" comes back short: the start of the conversation is
  // on screen, and later newest-page refetches keep it there.
  const reachedStartRef = useRef(false);

  useEffect(() => {
    reachedStartRef.current = false;
    setHasOlder(false);
  }, [conversationId]);

  const refetch = useCallback(async () => {
    if (!conversationId) { setMessages([]); setHasOlder(false); return; }
    const rows = await fetchConversationMessages({ conversationId, limit: MESSAGE_PAGE });
    if (convRef.current !== conversationId || rows == null) return;
    setMessages(prev => mergeNewestPage(prev, rows, { conversationId, pageSize: MESSAGE_PAGE }));
    setHasOlder(rows.length >= MESSAGE_PAGE && !reachedStartRef.current);
  }, [conversationId]);

  useEffect(() => { refetch(); }, [refetch]);

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!conversationId || !oldest || loadingOlderRef.current) return;
    if (oldest.conversation_id !== conversationId) return; // switch still loading
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const rows = await fetchConversationMessages({
        conversationId, limit: MESSAGE_PAGE, before: oldest.created_at,
      });
      if (convRef.current !== conversationId || rows == null) return;
      if (rows.length < MESSAGE_PAGE) { reachedStartRef.current = true; setHasOlder(false); }
      setMessages(prev => prependOlder(prev, rows));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId]);

  // Whether anyone can see this thread: tab visible and focused. A thread
  // left open in a background tab used to mark every arrival read at once,
  // so the title badge never showed (COMMS-03). Coming back marks it read.
  const [attended, setAttended] = useState(() => tabIsAttended());
  useEffect(() => {
    const sync = () => setAttended(tabIsAttended());
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
    };
  }, []);

  // Mark read whenever the conversation opens, a new message arrives, or the
  // reader comes back to the tab — keyed on the newest id, not the length,
  // which stops moving at a full page and jumps when older history loads.
  // After marking, notify the parent so unread counts refresh.
  const lastId = lastMessageId(messages);
  useEffect(() => {
    if (!userId || !conversationId || !attended) return;
    let cancelled = false;
    (async () => {
      const ok = await markRead({ conversationId, userId });
      if (cancelled) return;
      if (ok) onMarkedReadRef.current?.();
    })();
    return () => { cancelled = true; };
  }, [userId, conversationId, lastId, attended]);

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

  return { messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder };
}
