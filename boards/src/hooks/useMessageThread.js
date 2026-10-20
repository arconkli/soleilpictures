import { useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { fetchConversationMessages, fetchConversationRange, fetchMessagesByIds, markRead } from '../lib/messages.js';
import { subscribeConversation } from '../lib/messageRealtime.js';
import { MESSAGE_PAGE, mergeNewestPage, prependOlder, lastMessageId } from '../lib/messagePaging.js';
import {
  applyWrites, pruneWrites, upsertWrite, patchWrite, removeWrite, ackWrite, updateWrite, dropWrite,
} from '../lib/messageStore.js';
import { getCachedThread, putCachedThread } from '../lib/threadCache.js';
import { tabIsAttended } from '../lib/threadAttention.js';
import { subscribeInbox } from '../lib/inboxBus.js';
import { watchForResync } from '../lib/messageResync.js';
import { MessagesFixtureContext } from '../lib/messagesFixture.js';

const NO_MESSAGES = [];
// A burst of nudges (a broadcast and its inbox ping, two quick reactions)
// becomes one read.
const NUDGE_BATCH_MS = 50;
const time = (m) => Date.parse(m?.created_at || '') || 0;

// Returns { messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder, failed, loading }
// plus the local-write calls below, for a single conversation. `messages` is
// the newest page plus whatever older history the reader has paged back to
// with loadOlder(), with this tab's local writes (lib/messageStore.js)
// replayed over it: sends in flight, optimistic changes, rows re-read after a
// peer's nudge.
//   conversationId — the conversation to load
//   userId         — current user (filters self typing, marks read)
//   onMarkedRead   — optional callback fired after a successful
//                    last_read_at write, so the parent (useConversationList)
//                    can refresh its unread counts. Fixes the
//                    "stuck at 1" bug from the old useChannelList.
export function useMessageThread({ conversationId, userId, onMarkedRead }) {
  // The dev QA harness's rows, when it provides them (lib/messagesFixture.js).
  const fixture = useContext(MessagesFixtureContext);
  // Going back to a conversation paints what it showed last time, then reads
  // again (lib/threadCache.js).
  const [cached] = useState(() => (fixture ? null : getCachedThread(userId, conversationId)));
  const [messages, setMessages] = useState(() => cached?.rows || []);
  // The local write log. The ref is the truth, updated synchronously, so a
  // server answer that lands before React renders still finds its write;
  // the state only makes React render it.
  const writesRef = useRef([]);
  const [writes, setWritesState] = useState(writesRef.current);
  const commitWrites = useCallback((fn) => {
    const next = fn(writesRef.current);
    if (next === writesRef.current) return;
    writesRef.current = next;
    setWritesState(next);
  }, []);
  const [typingUsers, setTypingUsers] = useState(new Map()); // userId → ts
  const [hasOlder, setHasOlder] = useState(() => !!cached?.hasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // The last newest-page read failed. The thread keeps what it shows; an
  // empty one says "Couldn't load" rather than "No messages yet" (COMMS-15).
  const [failed, setFailed] = useState(false);
  const onMarkedReadRef = useRef(onMarkedRead);
  onMarkedReadRef.current = onMarkedRead;
  // A fetch that resolves after a conversation switch must not paint the
  // previous thread into this one.
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const hasOlderRef = useRef(hasOlder);
  hasOlderRef.current = hasOlder;
  const loadingOlderRef = useRef(false);
  // Set once "load older" comes back short: the start of the conversation is
  // on screen, and later newest-page refetches keep it there.
  const reachedStartRef = useRef(!!cached?.reachedStart);
  // created_at of the oldest row "load older" brought in: the start of the
  // history every refetch re-reads, so edits, deletes, undos and reactions
  // to old messages reach the screen (the newest page alone never covers them).
  const historyFromRef = useRef(cached?.historyFrom || null);

  // The conversation whose first read has settled — until then the thread is
  // loading, not empty. A cached conversation has something to show already.
  const [loadedFor, setLoadedFor] = useState(cached ? conversationId : null);
  // Reads overlap (a send's refetch, a peer's nudge, a resync); only the
  // newest one may paint. An older snapshot landing last took back a message
  // you had just sent, after its optimistic bubble was gone (COMMS-23).
  const seqRef = useRef(0);
  const latestReadRef = useRef(null);
  // Every acknowledgement from the server bumps the epoch, and every read is
  // stamped with it as it starts: a write acknowledged after a read started
  // survives that read (lib/messageStore.js pruneWrites).
  const epochRef = useRef(0);
  // Reads started and not landed yet. With none out, a confirmed change folds
  // straight into the rows instead of waiting in the write log.
  const inFlightRef = useRef(0);

  // The thread is keyed by conversation, so a switch is a fresh mount and this
  // only runs for a caller that switches in place.
  const initialConvRef = useRef(conversationId);
  useEffect(() => {
    if (initialConvRef.current === conversationId) return;
    initialConvRef.current = conversationId;
    reachedStartRef.current = false;
    historyFromRef.current = null;
    setHasOlder(false);
    setFailed(false);
    commitWrites(() => []);
    // Drop the last conversation's rows rather than show them under this
    // one's header (COMMS-23).
    setMessages(prev => (prev.length && prev[0].conversation_id !== conversationId ? [] : prev));
  }, [conversationId]);

  const refetch = useCallback(() => {
    const seq = ++seqRef.current;
    // A read overtaken by a newer one resolves when THAT one has painted, so
    // a caller awaiting refetch() (the optimistic send) still finds its row
    // on screen when it resumes.
    const superseded = () => seq !== seqRef.current;
    // The local writes this read can't reflect: everything acknowledged after now.
    const issuedAt = epochRef.current;
    inFlightRef.current += 1;
    const read = (async () => {
      try {
        if (!conversationId) { setMessages([]); setHasOlder(false); setFailed(false); return; }
        const rows = fixture
          ? (fixture.messages?.[conversationId] || [])
          : await fetchConversationMessages({ conversationId, limit: MESSAGE_PAGE });
        if (convRef.current !== conversationId) return;
        if (superseded()) return latestReadRef.current;
        setFailed(rows == null);
        setLoadedFor(conversationId);
        if (rows == null) {
          // A failed read keeps this thread on screen, but never another
          // conversation's rows.
          setMessages(prev => prev.filter(m => m.conversation_id === conversationId));
          return;
        }
        const historyFrom = historyFromRef.current;
        let history = null;
        if (historyFrom && rows.length >= MESSAGE_PAGE) {
          history = await fetchConversationRange({ conversationId, from: historyFrom, to: rows[0].created_at });
          if (convRef.current !== conversationId) return;
          if (superseded()) return latestReadRef.current;
        }
        // Writes this read reflects leave the log. Ones aimed at rows it didn't
        // re-read (history held over from earlier) fold into those rows first,
        // or a reaction to an old message would vanish with its write.
        const covered = new Set(rows.map(m => m.id));
        if (history) history.forEach(m => covered.add(m.id));
        const stale = writesRef.current.filter(w => w.ackedAt != null && w.ackedAt <= issuedAt
          && w.op !== 'upsert' && !covered.has(w.id));
        setMessages(prev => applyWrites(mergeNewestPage(prev, rows, {
          conversationId, pageSize: MESSAGE_PAGE, history, historyFrom,
        }), stale));
        commitWrites(ws => pruneWrites(ws, issuedAt));
        setHasOlder(rows.length >= MESSAGE_PAGE && !reachedStartRef.current);
      } finally {
        inFlightRef.current -= 1;
      }
    })();
    latestReadRef.current = read;
    return read;
  }, [conversationId, fixture, commitWrites]);

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

  // ── Local writes ────────────────────────────────────────────────────
  // Each returns the write's opId. settle() records the server's answer;
  // rollback() takes a change back. A settled write folds into the rows at
  // once when no read is out, else waits for a read that started after it.
  const addWrite = useCallback((w) => {
    commitWrites(ws => ws.concat(w));
    return w.opId;
  }, [commitWrites]);
  const settle = useCallback((opId, result = {}) => {
    const w = writesRef.current.find(x => x.opId === opId);
    if (!w) return;
    if (inFlightRef.current === 0) {
      const [done] = ackWrite([w], opId, 0, result);
      setMessages(prev => applyWrites(prev, [done]));
      commitWrites(ws => dropWrite(ws, opId));
      return;
    }
    const epoch = ++epochRef.current;
    commitWrites(ws => ackWrite(ws, opId, epoch, result));
  }, [commitWrites]);
  const rollback = useCallback((opId) => commitWrites(ws => dropWrite(ws, opId)), [commitWrites]);
  const sendLocal = useCallback((row) => addWrite(upsertWrite({ ...row, sendState: 'sending' })), [addWrite]);
  const markSendState = useCallback((opId, sendState) => {
    commitWrites(ws => updateWrite(ws, opId, w => ({ ...w, row: { ...w.row, sendState } })));
  }, [commitWrites]);
  const confirmSend = useCallback((opId, row) => settle(opId, { row }), [settle]);
  const patchLocal = useCallback((id, patch) => addWrite(patchWrite(id, patch)), [addWrite]);
  const removeLocal = useCallback((id) => addWrite(removeWrite(id)), [addWrite]);
  // Put a known row back (a delete's Undo).
  const upsertLocal = useCallback((row) => addWrite(upsertWrite(row)), [addWrite]);

  // Rows a peer's nudge named, re-read from the database. A message older than
  // what is loaded stays off screen until the reader pages back to it.
  const applyServerRows = useCallback((rows, askedIds) => {
    const byId = new Map(rows.filter(r => r.conversation_id === conversationId).map(r => [r.id, r]));
    const shownNow = messagesRef.current;
    const shownIds = new Set(shownNow.map(m => m.id));
    const oldest = shownNow[0];
    const out = [];
    for (const id of askedIds) {
      const r = byId.get(id);
      if (!r || r.deleted_at) {
        if (shownIds.has(id)) out.push(removeWrite(id));
        continue;
      }
      if (!shownIds.has(id) && oldest && hasOlderRef.current && time(r) < time(oldest)) continue;
      out.push(upsertWrite(r));
    }
    if (!out.length) return;
    if (inFlightRef.current === 0) {
      setMessages(prev => applyWrites(prev, out.map(w => ({ ...w, ackedAt: 0 }))));
      return;
    }
    const epoch = ++epochRef.current;
    commitWrites(ws => ws.concat(out.map(w => ({ ...w, ackedAt: epoch }))));
  }, [conversationId, commitWrites]);

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

  // Never hand out the previous conversation's rows, not even for the one
  // render before the switch effect clears them.
  const shown = messages.length && messages[0].conversation_id !== conversationId ? NO_MESSAGES : messages;
  const view = useMemo(() => applyWrites(shown, writes), [shown, writes]);

  // Mark read whenever the conversation opens, a new message arrives, or the
  // reader comes back to the tab — keyed on the newest id the server has, not
  // the length, which stops moving at a full page and jumps when older
  // history loads. After marking, notify the parent so unread counts refresh.
  const lastId = lastMessageId(view.filter(m => !m.sendState));
  useEffect(() => {
    if (fixture) return;
    if (!userId || !conversationId || !attended) return;
    let cancelled = false;
    (async () => {
      const ok = await markRead({ conversationId, userId });
      if (cancelled) return;
      if (ok) onMarkedReadRef.current?.();
    })();
    return () => { cancelled = true; };
  }, [userId, conversationId, lastId, attended, fixture]);

  // Remember this conversation for a quick return: the server's rows only.
  useEffect(() => () => {
    if (fixture) return;
    putCachedThread(userId, conversationId, {
      rows: messagesRef.current.filter(m => m.conversation_id === conversationId),
      hasOlder: hasOlderRef.current,
      reachedStart: reachedStartRef.current,
      historyFrom: historyFromRef.current,
    });
  }, [userId, conversationId, fixture]);

  // Realtime subscribe.
  useEffect(() => {
    if (!conversationId) return;
    if (fixture) {
      setTypingUsers(new Map(Object.entries(fixture.typing?.[conversationId] || {})));
      return;
    }
    let alive = true;
    // Read again whenever the live feed may have dropped something: the
    // channel (re)joining, the tab coming back, the network returning, or a
    // nudge whose re-read failed (COMMS-04).
    const resync = watchForResync(() => refetch());
    // A broadcast only says WHICH message changed. Its payload is never
    // trusted for content (anyone in the conversation can send anything on
    // conv:*): the named rows are read again from the database instead.
    const queue = new Set();
    let timer = null;
    const flush = async () => {
      timer = null;
      const ids = [...queue];
      queue.clear();
      if (!ids.length) return;
      const rows = await fetchMessagesByIds({ conversationId, ids });
      if (!alive || convRef.current !== conversationId) return;
      if (rows == null) { resync.kick(); return; }
      applyServerRows(rows, ids);
    };
    const nudge = (id) => {
      if (!id) { resync.kick(); return; }
      queue.add(id);
      if (!timer) timer = setTimeout(flush, NUDGE_BATCH_MS);
    };
    const clearTyping = (uid) => setTypingUsers(m => {
      if (!m.has(uid)) return m;
      const next = new Map(m); next.delete(uid); return next;
    });
    const onMessage = (payload) => {
      if (payload?.changed === 'participants') { resync.kick(); return; }
      // Their message landed: they've stopped typing.
      if (payload?.sender_id) clearTyping(payload.sender_id);
      nudge(payload?.id);
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
    const unsub = subscribeConversation({ conversationId, onMessage, onTyping, onSubscribed: resync.kick });
    // An inbox ping for this conversation names its new message, and lands
    // even when the conv: join itself failed, so the thread can't freeze.
    const unsubInbox = subscribeInbox(userId, (payload) => {
      if (payload?.conversation_id === conversationId) nudge(payload.message_id);
    });
    return () => { alive = false; clearTimeout(timer); resync.stop(); unsubInbox(); unsub(); };
  }, [conversationId, userId, refetch, fixture, applyServerRows]);

  return {
    messages: view, typingUsers, refetch, hasOlder, loadingOlder, loadOlder, failed,
    loading: !!conversationId && loadedFor !== conversationId,
    sendLocal, markSendState, confirmSend, patchLocal, removeLocal, upsertLocal, settle, rollback,
  };
}
