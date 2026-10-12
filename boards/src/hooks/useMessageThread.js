import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchConversationMessages, fetchConversationRange, markRead } from '../lib/messages.js';
import { subscribeConversation } from '../lib/messageRealtime.js';
import { MESSAGE_PAGE, mergeNewestPage, prependOlder, lastMessageId } from '../lib/messagePaging.js';
import { tabIsAttended } from '../lib/threadAttention.js';
import { subscribeInbox } from '../lib/inboxBus.js';
import { watchForResync } from '../lib/messageResync.js';

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
  // created_at of the oldest row "load older" brought in: the start of the
  // history every refetch re-reads, so edits, deletes, undos and reactions
  // to old messages reach the screen (the newest page alone never covers them).
  const historyFromRef = useRef(null);

  useEffect(() => {
    reachedStartRef.current = false;
    historyFromRef.current = null;
    setHasOlder(false);
  }, [conversationId]);

  const refetch = useCallback(async () => {
    if (!conversationId) { setMessages([]); setHasOlder(false); return; }
    const rows = await fetchConversationMessages({ conversationId, limit: MESSAGE_PAGE });
    if (convRef.current !== conversationId) return;
    if (rows == null) {
      // A failed read keeps this thread on screen, but never the previous
      // one: the thread isn't remounted on a switch, so a failed first read
      // would otherwise paint the last conversation under this header.
      setMessages(prev => prev.filter(m => m.conversation_id === conversationId));
      return;
    }
    const historyFrom = historyFromRef.current;
    let history = null;
    if (historyFrom && rows.length >= MESSAGE_PAGE) {
      history = await fetchConversationRange({ conversationId, from: historyFrom, to: rows[0].created_at });
      if (convRef.current !== conversationId) return;
    }
    setMessages(prev => mergeNewestPage(prev, rows, {
      conversationId, pageSize: MESSAGE_PAGE, history, historyFrom,
    }));
    setHasOlder(rows.length >= MESSAGE_PAGE && !reachedStartRef.current);
  }, [conversationId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Resolves true once a page was asked for, false when it bailed — so the
  // caller can drop the scroll anchor it set for a page that isn't coming.
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!conversationId || !oldest || loadingOlderRef.current) return false;
    if (oldest.conversation_id !== conversationId) return false; // switch still loading
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const rows = await fetchConversationMessages({
        conversationId, limit: MESSAGE_PAGE, before: oldest.created_at,
      });
      if (convRef.current !== conversationId || rows == null) return true;
      if (rows.length < MESSAGE_PAGE) { reachedStartRef.current = true; setHasOlder(false); }
      if (rows.length) historyFromRef.current = rows[0].created_at;
      setMessages(prev => prependOlder(prev, rows));
      return true;
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
    // Read again whenever the live feed may have dropped something: the
    // channel (re)joining, the tab coming back, the network returning, or an
    // inbox ping for this conversation — which also lands when the conv:
    // join itself failed, so the thread can't freeze silently (COMMS-04).
    const resync = watchForResync(() => refetch());
    const unsub = subscribeConversation({ conversationId, onMessage, onTyping, onSubscribed: resync.kick });
    const unsubInbox = subscribeInbox(userId, (payload) => {
      if (payload?.conversation_id === conversationId) resync.kick();
    });
    return () => { resync.stop(); unsubInbox(); unsub(); };
  }, [conversationId, userId, refetch]);

  return { messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder };
}
