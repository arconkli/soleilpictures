import { useContext, useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search, Pin, MoreHorizontal, UserPlus, LogOut, Edit } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { useMessageableUsers } from '../hooks/useMessageableUsers.js';
import {
  sendMessage, deleteMessage, restoreMessage, editMessage, toggleReaction,
  searchMessagesInConversation, fetchMessagesByIds,
  fetchReplies, replyCountsFor, togglePin,
  listPinnedForConversation,
  addParticipants, leaveConversation, rejoinConversation, renameConversation,
} from '../lib/messages.js';
import {
  broadcastConversationMessage, broadcastConversationTyping, broadcastConversationChange,
} from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { INBOX_MIME } from '../lib/dragMimes.js';
import { inboxPayloadFor } from '../lib/messageAttachments.js';
import { SoleilMark } from './primitives.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { lastMessageId } from '../lib/messagePaging.js';
import { newMessageId, toggleReactionMap } from '../lib/messageStore.js';
import { showingConversation } from '../lib/threadAttention.js';
import { readOnlyCopy } from '../lib/messageAccess.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { isDmConversation } from '../lib/conversationState.js';
import { useMessagesLook } from './messagesLook.js';
import { membersLine } from '../lib/messagesCard.js';
import { MessagesFixtureContext } from '../lib/messagesFixture.js';

const STICK_THRESHOLD_PX = 80;
// Start fetching the previous page this far before the reader hits the top.
const LOAD_OLDER_THRESHOLD_PX = 120;

// conversation = { id, title, participants: [{ user_id, left_at, ... }] }
export function MessageThread({
  workspaceId, currentUser, conversation,
  onBack, onClose, onChanged, jumpToMessageId, onJumpConsumed,
  canSend = true, readOnlyReason = null,
}) {
  const userId = currentUser?.id;
  const conversationId = conversation?.id;
  const feedback = useFeedback();
  // The files sidebar's card look: who's in it under the name, the thread in
  // bubbles (messagesCard.css), no glowing mark on an empty one.
  const card = useMessagesLook() === 'card';
  // The dev QA harness's rows, when it provides them (lib/messagesFixture.js).
  const fixture = useContext(MessagesFixtureContext);

  const {
    messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder, failed: loadFailed, loading,
    sendLocal, markSendState, confirmSend, patchLocal, removeLocal, upsertLocal, settle, rollback,
  } = useMessageThread({
    conversationId, userId,
    onMarkedRead: onChanged,
  });

  const scrollRef = useRef(null);

  // Tell the inbox this conversation is on screen, so its toast and OS
  // notification stay quiet only while it really is (COMMS-03).
  useEffect(() => showingConversation(conversationId), [conversationId]);

  // ── Active participants (for title + group menu) ─────────────────────
  const activeParticipants = useMemo(
    () => (conversation?.participants || []).filter(p => !p.left_at),
    [conversation?.participants],
  );
  const peers = useMemo(
    () => activeParticipants.filter(p => p.user_id !== userId),
    [activeParticipants, userId],
  );
  // A DM is two participant ROWS, left or not. Counting only active ones
  // turned a group that dropped to two members into a "DIRECT MESSAGE" with
  // no way to rename it, add people or leave (COMMS-17).
  const isDm = isDmConversation(conversation?.participants);

  // Resolve display names.
  useEffect(() => {
    for (const p of peers) userProfiles.resolve(p.user_id);
  }, [peers]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  const peerLabels = peers.map(p => {
    const u = userProfiles.get(p.user_id);
    return u?.name || u?.email || 'Member';
  });
  const titleText = conversation?.title || (peerLabels.length ? peerLabels.join(', ') : 'New conversation');

  // ── Sticky-scroll behavior ───────────────────────────────────────────
  const wasAtBottomRef = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const prevLastIdRef = useRef(null);
  // Scroll height captured just before an older page is prepended, so the
  // message the reader is looking at stays put instead of jumping down.
  const anchorRef = useRef(null);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };
  const requestOlder = () => {
    const el = scrollRef.current;
    if (!hasOlder || loadingOlder || !el) return;
    const anchor = { height: el.scrollHeight, top: el.scrollTop };
    anchorRef.current = anchor;
    // A bail (mid-switch) brings no page: a stale anchor would shift the
    // next arrival by its height.
    loadOlder().then(started => { if (!started && anchorRef.current === anchor) anchorRef.current = null; });
  };
  const lastScrollTopRef = useRef(0);
  const onScroll = () => {
    wasAtBottomRef.current = isNearBottom();
    if (wasAtBottomRef.current) setUnseenCount(0);
    const el = scrollRef.current;
    if (!el) return;
    // Only an UPWARD scroll near the top pages back: the opening jump to the
    // bottom starts at scrollTop 0 and must not fetch history on its way down.
    const goingUp = el.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (goingUp && el.scrollTop < LOAD_OLDER_THRESHOLD_PX && !searchOpen && !replyParent) requestOlder();
  };
  const jumpToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseenCount(0);
  };

  // Initial mount + conversation switch: jump to bottom instantly.
  useEffect(() => {
    wasAtBottomRef.current = true;
    setUnseenCount(0);
    prevLastIdRef.current = null;
    anchorRef.current = null;
    requestAnimationFrame(() => jumpToBottom(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // New messages land at the END, so "something arrived" is the newest id
  // moving — not the length, which also grows when older history is
  // prepended and stays flat once a thread holds a full page.
  const lastId = lastMessageId(messages);
  useEffect(() => {
    const prevId = prevLastIdRef.current;
    prevLastIdRef.current = lastId;
    if (!lastId || lastId === prevId) return;
    if (wasAtBottomRef.current || !prevId) {
      // The first page of a conversation lands instantly: smooth-scrolling
      // it animated through the whole history on every open (COMMS-16).
      // Only a later arrival glides.
      requestAnimationFrame(() => jumpToBottom(!!prevId));
    } else {
      const at = messages.findIndex(m => m.id === prevId);
      const added = at >= 0 ? messages.length - 1 - at : 1;
      if (added > 0) setUnseenCount(c => c + added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  // An image that finishes loading above the newest message grows the thread
  // under the reader; while they're at the bottom, keep them there. (load
  // doesn't bubble — listen in the capture phase.)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onLoad = (e) => {
      if (e.target?.tagName !== 'IMG' || !wasAtBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, []);

  // After an older page is prepended, push the scroll position down by the
  // height it added so the reader's place doesn't move.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = scrollRef.current;
    if (!a || !el || loadingOlder) return;
    anchorRef.current = null;
    el.scrollTop = el.scrollHeight - a.height + a.top;
  }, [messages, loadingOlder]);

  // ── Search ───────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!searchOpen || !q || !conversationId) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeqRef.current;
    const t = setTimeout(async () => {
      let rows = [];
      try {
        rows = await searchMessagesInConversation({ conversationId, query: q, limit: 50 });
      } catch (e) { console.warn('search failed', e); }
      if (seq !== searchSeqRef.current) return;
      setSearchResults(rows);
      setSearching(false);
    }, 150);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen, conversationId]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // ── Threaded replies ─────────────────────────────────────────────────
  const [replyParent, setReplyParent] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyCounts, setReplyCounts] = useState(new Map());

  useEffect(() => {
    if (!replyParent) return;
    let cancelled = false;
    fetchReplies({ parentId: replyParent.id }).then(rows => {
      if (!cancelled) setReplies(rows);
    });
    return () => { cancelled = true; };
  }, [replyParent, messages.length]);

  useEffect(() => {
    if (replyParent) return;
    const topLevelIds = (messages || []).filter(m => !m.parent_id).map(m => m.id);
    if (topLevelIds.length === 0) { setReplyCounts(new Map()); return; }
    if (fixture) { setReplyCounts(new Map(Object.entries(fixture.replyCounts?.[conversationId] || {}))); return; }
    let cancelled = false;
    replyCountsFor(topLevelIds).then(map => {
      if (!cancelled) setReplyCounts(map);
    });
    return () => { cancelled = true; };
  }, [messages, replyParent, fixture, conversationId]);

  // ── Pinned strip ─────────────────────────────────────────────────────
  const [pinned, setPinned] = useState([]);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  // Also re-read when a loaded message is pinned or unpinned: a peer's pin
  // arrives as a refetch that leaves the count where it was.
  const pinnedSig = messages.filter(m => m.is_pinned).map(m => m.id).join(',');
  useEffect(() => {
    if (!conversationId) return;
    if (fixture) { setPinned(messages.filter(m => m.is_pinned)); return; }
    let cancelled = false;
    listPinnedForConversation({ conversationId }).then(rows => { if (!cancelled) setPinned(rows); });
    return () => { cancelled = true; };
  }, [conversationId, messages.length, pinnedSig, fixture]);

  // ── Permalink scroll ─────────────────────────────────────────────────
  // Once, when the target's page is on screen. It re-ran on every new
  // message, so each arrival — your own sends too — yanked the view back up
  // to the permalinked message and closed an open search (COMMS-09). Keyed
  // on whether the target is loaded, not on the message count.
  const jumpTargetLoaded = !!jumpToMessageId && messages.some(m => m.id === jumpToMessageId);
  const jumpDoneRef = useRef(null);
  useEffect(() => {
    if (!jumpToMessageId || !jumpTargetLoaded) return;
    const key = `${conversationId}:${jumpToMessageId}`;
    if (jumpDoneRef.current === key) return;
    const t = setTimeout(() => {
      jumpDoneRef.current = key;
      flashMessage(jumpToMessageId);
      onJumpConsumed?.();
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId, jumpTargetLoaded, conversationId]);

  // A target older than the loaded pages is paged back to, a few pages at
  // most, so a permalink, pinned or search jump into old history still lands.
  // seekId is an in-thread jump (pinned / search) still waiting on its page;
  // a permalink is flashed by the effect above once its page arrives.
  const PERMALINK_MAX_PAGES = 5;
  const [seekId, setSeekId] = useState(null);
  const permalinkPagesRef = useRef(0);
  const seekTarget = seekId || jumpToMessageId;
  useEffect(() => { permalinkPagesRef.current = 0; }, [seekTarget, conversationId]);
  useEffect(() => { setSeekId(null); }, [conversationId]);
  useEffect(() => {
    if (!seekTarget) return;
    if (messages[0]?.conversation_id !== conversationId) return; // switch still loading
    if (messages.some(m => m.id === seekTarget)) {
      if (seekId) { setSeekId(null); flashMessage(seekId); }
      return;
    }
    if (loadingOlder) return;
    if (!hasOlder || permalinkPagesRef.current >= PERMALINK_MAX_PAGES) {
      if (seekId) setSeekId(null);
      return;
    }
    permalinkPagesRef.current += 1;
    loadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTarget, messages.length, hasOlder, loadingOlder, conversationId]);

  // ⌘F + j/k/r/e/Esc keyboard shortcuts.
  const [focusedId, setFocusedId] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!e.target?.closest?.('.msg-panel')) return;
      const inField = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'Escape') {
        // The nearest layer only. A control inside the panel that handled it
        // (the edit box, rename, the link field, the ⋯ menu, the emoji
        // palette) has claimed it with preventDefault; closing the whole
        // panel on the same press threw away what you were in (COMMS-10).
        if (e.defaultPrevented || e.isComposing) return;
        if (searchOpen) { closeSearch(); return; }
        if (replyParent) { setReplyParent(null); return; }
        if (escapeClosesPanel(e, '.msg-panel')) onClose?.();
        return;
      }
      if (inField) return;
      const list = replyParent ? [replyParent, ...replies] : messages;
      if (list.length === 0) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const dir = e.key === 'j' ? 1 : -1;
        const idx = focusedId ? list.findIndex(m => m.id === focusedId) : (dir > 0 ? -1 : list.length);
        const next = list[Math.max(0, Math.min(list.length - 1, idx + dir))];
        if (next) {
          setFocusedId(next.id);
          requestAnimationFrame(() => {
            const el = scrollRef.current?.querySelector(`[data-msg-id="${next.id}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        }
      } else if (e.key === 'r' && focusedId) {
        const m = list.find(x => x.id === focusedId);
        if (m && !m.parent_id) { e.preventDefault(); setReplyParent(m); }
      } else if (e.key === 'e' && focusedId) {
        const m = list.find(x => x.id === focusedId);
        if (m && m.sender_id === userId) {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('soleil-msg-edit', { detail: { id: m.id }}));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, replyParent, messages, replies, focusedId, userId, onClose]);

  const flashMessage = (msgId) => {
    closeSearch();
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-flashed');
      setTimeout(() => el.classList.remove('is-flashed'), 1600);
    });
  };

  const messagesById = useMemo(() => {
    const m = new Map();
    for (const x of messages || []) m.set(x.id, x);
    return m;
  }, [messages]);
  // Jump within the thread: flash it if it's loaded, else page back to it.
  const jumpTo = (msgId) => {
    if (messagesById.has(msgId)) { flashMessage(msgId); return; }
    closeSearch();
    setSeekId(msgId);
  };

  // ── Day-divider + consecutive-sender grouping ───────────────────────
  // A message is a "continuation" of the one above it when it's from the
  // same sender, within 5 minutes, on the same day, and is neither a reply
  // nor pinned. Continuations drop their avatar/name/time header (see
  // MessageBubble's isContinuation) so a burst reads as one block instead
  // of repeating the author on every line.
  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastKey = null;
    let prevMsg = null; // previous *message* row actually rendered (not a divider/system)
    const list = replyParent ? [] : (messages || []);
    for (const m of list) {
      const k = dayKey(m.created_at);
      let brokeDay = false;
      if (k !== lastKey) {
        groups.push({ kind: 'divider', key: 'd-' + k, label: dayLabel(m.created_at) });
        lastKey = k; brokeDay = true; prevMsg = null;
      }
      if (m.kind === 'system') {
        groups.push({ kind: 'msg', key: m.id, msg: m });
        prevMsg = null; // a system row always breaks the run
        continue;
      }
      const within5 = prevMsg && m.created_at && prevMsg.created_at
        && (new Date(m.created_at) - new Date(prevMsg.created_at)) < 5 * 60 * 1000;
      const isContinuation = !brokeDay && !!prevMsg
        && prevMsg.sender_id === m.sender_id
        && !m.parent_id && !m.is_pinned && within5;
      groups.push({ kind: 'msg', key: m.id, msg: m, isContinuation });
      prevMsg = m;
    }
    return groups;
  }, [messages, replyParent]);

  // ── Send / Edit / Delete / React / Reply / Pin / Copy-link ──────────
  // Everything shows before the server answers (useMessageThread's local
  // writes). A send appears at once with the id the server will keep, so its
  // bubble never remounts or changes shape when it's confirmed; a reaction,
  // edit, pin or delete shows at once and rolls back, with a toast, if the
  // server refuses it. A failed send stays in the thread with Retry/Discard
  // (the composer already cleared, so the bubble owns recovery) plus a toast
  // in case you've scrolled away.
  const sendOpsRef = useRef(new Map()); // message id → its send's write

  const deliverPending = useCallback(async (row) => {
    const opId = sendOpsRef.current.get(row.id);
    let saved = null;
    try {
      saved = await sendMessage({
        id: row.id,
        workspaceId, conversationId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        parentId: row.parent_id,
        body: row.body, attachments: row.attachments, mentions: row.mentions,
      });
    } catch (e) {
      // A retry whose first try was saved after all (its answer was lost)
      // hits the id it already has: show the stored message, not a copy.
      if (e?.code === '23505') saved = (await fetchMessagesByIds({ conversationId, ids: [row.id] }))?.[0] || null;
      if (!saved) {
        console.warn('send failed', e);
        markSendState(opId, 'failed');
        feedback.toast({ type: 'error', message: "Message didn't send — it's kept in the thread with a Retry button." });
        return;
      }
    }
    sendOpsRef.current.delete(row.id);
    confirmSend(opId, saved);
    // Tell the others once it's saved, without waiting on the socket: a slow
    // or failed broadcast must never make a saved message look unsent. They
    // re-read it by id; the payload carries nothing else.
    broadcastConversationMessage({ conversationId, payload: { id: saved.id, sender_id: saved.sender_id } })
      .then(null, (e) => console.warn('send broadcast failed', e));
    onChanged?.();
  }, [workspaceId, conversationId, userId, currentUser, markSendState, confirmSend, onChanged, feedback]);

  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    if (!conversationId) return false;
    const row = {
      id: newMessageId(),
      conversation_id: conversationId,
      workspace_id: workspaceId,
      kind: 'user',
      body, attachments, mentions,
      parent_id: replyParent?.id || null,
      sender_id: userId,
      sender_email: currentUser?.email || null,
      sender_name: currentUser?.name || currentUser?.email,
      reactions: {},
      created_at: new Date().toISOString(),
    };
    sendOpsRef.current.set(row.id, sendLocal(row));
    wasAtBottomRef.current = true;
    deliverPending(row);
    return true;
  }, [conversationId, workspaceId, replyParent, userId, currentUser, sendLocal, deliverPending]);

  const retryPending = useCallback((msg) => {
    markSendState(sendOpsRef.current.get(msg.id), 'sending');
    deliverPending(msg);
  }, [markSendState, deliverPending]);
  const discardPending = useCallback((msg) => {
    rollback(sendOpsRef.current.get(msg.id));
    sendOpsRef.current.delete(msg.id);
  }, [rollback]);

  const handleDelete = useCallback(async (msg) => {
    // No confirm: it goes at once and the toast's Undo brings it back (the
    // house convention for deleting). Messages soft-delete via deleted_at.
    const opId = removeLocal(msg.id);
    try {
      await deleteMessage({ id: msg.id });
    } catch (e) {
      console.warn('delete failed', e);
      rollback(opId);
      feedback.toast({ type: 'error', message: 'Could not delete the message — try again.' });
      return;
    }
    settle(opId);
    // Peers only learn of a change already in the thread from a nudge:
    // messages aren't in the realtime publication (COMMS-04).
    broadcastConversationChange({ conversationId, changed: 'delete', id: msg.id });
    undoToast(feedback, {
      message: 'Message deleted',
      onUndo: async () => {
        const back = upsertLocal({ ...msg, deleted_at: null });
        try {
          await restoreMessage({ id: msg.id });
          settle(back);
          broadcastConversationChange({ conversationId, changed: 'restore', id: msg.id });
        }
        catch (e) {
          rollback(back);
          feedback.toast({ type: 'error', message: 'Could not restore the message — try again.' });
        }
      },
    });
  }, [conversationId, removeLocal, upsertLocal, settle, rollback, feedback]);

  // Resolves false when the save failed, so the bubble reopens with your text.
  const handleEdit = useCallback(async (msg, newBody) => {
    const opId = patchLocal(msg.id, { body: newBody, edited_at: new Date().toISOString() });
    try {
      await editMessage({ id: msg.id, body: newBody });
    } catch (e) {
      console.warn('edit failed', e);
      rollback(opId);
      feedback.toast({ type: 'error', message: 'Could not save your edit — try again.' });
      return false;
    }
    settle(opId);
    broadcastConversationChange({ conversationId, changed: 'edit', id: msg.id });
    return true;
  }, [conversationId, patchLocal, settle, rollback, feedback]);

  const handleReact = useCallback(async (msg, emoji) => {
    if (!emoji) return;
    const opId = patchLocal(msg.id, { reactions: toggleReactionMap(msg.reactions, emoji, userId) });
    try {
      const reactions = await toggleReaction({ messageId: msg.id, emoji, userId });
      settle(opId, reactions && typeof reactions === 'object' ? { patch: { reactions } } : {});
      broadcastConversationChange({ conversationId, changed: 'react', id: msg.id });
    } catch (e) {
      rollback(opId);
      feedback.toast({ type: 'error', message: "Couldn't save your reaction — try again." });
    }
  }, [conversationId, userId, patchLocal, settle, rollback, feedback]);

  const handleReply = useCallback((msg) => {
    setReplyParent(msg);
    setFocusedId(null);
  }, []);

  const handlePin = useCallback(async (msg) => {
    const opId = patchLocal(msg.id, { is_pinned: !msg.is_pinned });
    try {
      const isPinned = await togglePin(msg.id);
      settle(opId, { patch: { is_pinned: isPinned } });
      broadcastConversationChange({ conversationId, changed: 'pin', id: msg.id });
      const rows = await listPinnedForConversation({ conversationId });
      setPinned(rows);
    } catch (e) {
      console.warn('pin failed', e);
      rollback(opId);
      feedback.toast({ type: 'error', message: msg.is_pinned ? "Couldn't unpin the message — try again." : "Couldn't pin the message — try again." });
    }
  }, [conversationId, patchLocal, settle, rollback, feedback]);

  // Say whether it worked: a silent copy left you guessing (COMMS-24).
  const handleCopyLink = useCallback(async (msg) => {
    const url = `${window.location.origin}${window.location.pathname}?m=${msg.id}`;
    try {
      await navigator.clipboard.writeText(url);
      feedback.toast({ type: 'success', message: 'Link copied' });
    } catch (_) {
      feedback.toast({ type: 'error', message: "Couldn't copy the link — your browser blocked the clipboard." });
    }
  }, [feedback]);

  const handleTyping = useCallback(() => {
    if (!conversationId) return;
    broadcastConversationTyping({ conversationId, userId });
  }, [conversationId, userId]);

  const handleAttachmentDragStart = (e, att) => {
    const payload = inboxPayloadFor(att);
    if (!payload) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(INBOX_MIME, JSON.stringify(payload));
  };

  // ── Group chat actions ───────────────────────────────────────────────
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [addPickerAnchor, setAddPickerAnchor] = useState(null);

  const beginRename = () => {
    setRenameValue(conversation?.title || '');
    setRenaming(true);
    setMenuAnchor(null);
  };
  const commitRename = async () => {
    const next = renameValue.trim();
    setRenaming(false);
    if (next === (conversation?.title || '')) return;
    try {
      await renameConversation({ conversationId, title: next });
      onChanged?.();
    } catch (e) {
      console.warn('rename failed', e);
      feedback.toast({ type: 'error', message: 'Could not rename the conversation — try again.' });
    }
  };

  const openLeaveConfirm = async () => {
    if (isDm) return;
    setMenuAnchor(null);
    const ok = await feedback.confirm({
      title: 'Leave conversation',
      message: `Leave "${titleText}"? You'll stop receiving its messages.`,
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    // leaveConversation resolves false on a failed write (it never threw, so
    // a failure used to pass as a leave).
    const convId = conversationId;
    const left = await leaveConversation({ conversationId: convId, userId });
    if (!left) {
      feedback.toast({ type: 'error', message: 'Could not leave the conversation — try again.' });
      return;
    }
    onChanged?.();
    onBack?.();
    undoToast(feedback, {
      message: 'You left the conversation',
      onUndo: async () => {
        const back = await rejoinConversation({ conversationId: convId, userId });
        if (!back) { feedback.toast({ type: 'error', message: "Couldn't bring the conversation back — try again." }); return; }
        onChanged?.();
      },
    });
  };

  // ── Render ───────────────────────────────────────────────────────────
  const isEmpty = !searchOpen && !replyParent && messages.length === 0;
  const subtitle = replyParent ? 'THREAD' : (isDm ? 'DIRECT MESSAGE' : 'GROUP CHAT');

  const threadList = replyParent
    ? [{ kind: 'msg', key: replyParent.id, msg: replyParent }, ...replies.map(r => ({ kind: 'msg', key: r.id, msg: r }))]
    : null;

  const showPinned = !replyParent && !searchOpen && pinned.length > 0;

  const draftKey = conversationId
    ? (replyParent ? `${conversationId}:r:${replyParent.id}` : conversationId)
    : '';

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button
          className="msg-panel-icon"
          onClick={() => { if (replyParent) setReplyParent(null); else onBack?.(); }}
          title={replyParent ? 'Back to thread' : 'Back'}
          aria-label="Back"
        >
          <Icon as={ChevronLeft} size={14} />
        </button>
        <div className="msg-panel-title">
          {!card && <div className="t-eyebrow msg-panel-eyebrow">{subtitle}</div>}
          {renaming ? (
            <input
              className="msg-panel-name-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                // Claim the key: cancelling the rename must not close the panel.
                if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
              }}
              onBlur={commitRename}
              maxLength={80}
            />
          ) : (
            <button
              className="msg-panel-name"
              title={titleText}
              onClick={!isDm && !replyParent ? beginRename : undefined}
            >
              {titleText}
            </button>
          )}
          {card && (
            <div className="msg-panel-sub">
              {replyParent ? 'Thread' : isDm ? 'Direct message' : membersLine(peerLabels)}
            </div>
          )}
        </div>
        {!isDm && !replyParent && (
          <button
            className="msg-panel-icon"
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
            title="Conversation actions"
            aria-label="Conversation actions"
          >
            <Icon as={MoreHorizontal} size={14} />
          </button>
        )}
        <button
          className={`msg-panel-icon ${searchOpen ? 'is-active' : ''}`}
          onClick={() => {
            if (searchOpen) closeSearch();
            else { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }
          }}
          title="Search messages (⌘F)"
          aria-label="Search messages"
        >
          <Icon as={Search} size={14} />
        </button>
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
      </div>

      {menuAnchor && (
        <GroupChatMenu
          anchor={menuAnchor}
          onRename={beginRename}
          onAdd={() => { setAddPickerAnchor(menuAnchor); setMenuAnchor(null); }}
          onLeave={openLeaveConfirm}
          // Any group can be left. The old 3+ rule only existed because a
          // group at two members was mistaken for a DM (COMMS-17).
          canLeave
          onClose={() => setMenuAnchor(null)}
        />
      )}

      {addPickerAnchor && (
        <AddParticipantsPicker
          workspaceId={workspaceId}
          conversationId={conversationId}
          existingIds={new Set(activeParticipants.map(p => p.user_id))}
          anchor={addPickerAnchor}
          onClose={() => setAddPickerAnchor(null)}
          onAdded={() => {
            setAddPickerAnchor(null); onChanged?.(); refetch();
            broadcastConversationChange({ conversationId, changed: 'participants' });
          }}
          actorId={userId}
          currentUser={currentUser}
        />
      )}

      {searchOpen && (
        <div className="msg-search">
          <Icon as={Search} size={12} />
          <input
            ref={searchInputRef}
            className="msg-search-input"
            placeholder="Find in conversation…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="msg-search-clear" onClick={closeSearch}>×</button>
        </div>
      )}

      {showPinned && (
        <div className={`msg-pinned-strip ${pinnedExpanded ? 'is-expanded' : ''}`}>
          {card ? (
            // One row: the newest pin's words, then how many there are.
            <button className="msg-pinned-head" onClick={() => setPinnedExpanded(v => !v)} aria-expanded={pinnedExpanded}>
              <Icon as={Pin} size={13} />
              <span className="msg-pinned-text">{(pinned[pinned.length - 1]?.body || '').replace(/\s+/g, ' ').trim()}</span>
              <span className="msg-pinned-n">{pinned.length} pinned</span>
            </button>
          ) : (
            <button className="msg-pinned-head" onClick={() => setPinnedExpanded(v => !v)}>
              <Icon as={Pin} size={11} />
              <span className="t-eyebrow">PINNED · {pinned.length}</span>
              <span className="msg-pinned-chev">{pinnedExpanded ? '▾' : '▸'}</span>
            </button>
          )}
          {pinnedExpanded && (
            <div className="msg-pinned-list">
              {pinned.map(p => (
                <button
                  key={p.id}
                  className="msg-pinned-item"
                  onClick={() => jumpTo(p.id)}
                  title={`Jump to message · ${new Date(p.created_at).toLocaleString()}`}
                >
                  <span className="msg-pinned-item-body">{(p.body || '').slice(0, 80)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`msg-thread-body${card ? (isDm ? ' is-dm' : ' is-group') : ''}`} ref={scrollRef} onScroll={onScroll}>
        {!searchOpen && !replyParent && hasOlder && (
          <button
            type="button"
            className="msg-load-older t-meta"
            onClick={requestOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        )}
        {searchOpen && searchQuery.trim() ? (
          <>
            <div className="msg-search-summary t-meta">
              {searching ? 'Searching…' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
            </div>
            {searchResults.length === 0 && !searching && (
              <div className="msg-empty">No matches for "{searchQuery}".</div>
            )}
            {searchResults.map(m => (
              <button
                key={m.id}
                className="msg-search-result"
                onClick={() => jumpTo(m.id)}
              >
                <MessageBubble msg={m} selfId={userId} highlight={searchQuery}
                  onDelete={handleDelete}
                  onAttachmentDragStart={handleAttachmentDragStart}
                  onReact={handleReact}
                  onEdit={handleEdit}
                />
              </button>
            ))}
          </>
        ) : isEmpty && loadFailed ? (
          // A failed read is not an empty conversation (COMMS-15).
          <div className="msg-empty msg-load-failed" role="alert">
            <span>Couldn't load messages.</span>
            <button type="button" className="msg-retry-btn" onClick={() => refetch()}>Retry</button>
          </div>
        ) : isEmpty && loading ? (
          // Still reading this conversation: not "No messages yet".
          null
        ) : isEmpty ? (
          <div className="msg-empty msg-empty-hero">
            {!card && <SoleilMark size={32} color="var(--soleil)" glow />}
            <div className="msg-empty-title">No messages yet</div>
            <div className="msg-empty-sub">Say hi</div>
          </div>
        ) : replyParent && threadList ? (
          <>
            <div className="msg-thread-header">
              <span className="t-eyebrow">REPLYING TO</span>
            </div>
            {threadList.map(g => (
              <MessageBubble key={g.key} msg={g.msg} selfId={userId}
                isFocused={focusedId === g.msg.id}
                onDelete={handleDelete}
                onReact={handleReact}
                onEdit={handleEdit}
                onPin={handlePin}
                onCopyLink={handleCopyLink}
                onAttachmentDragStart={handleAttachmentDragStart}
              />
            ))}
            {messages.filter(m => m.sendState && m.parent_id === replyParent.id).map(m => (
              <MessageBubble key={m.id} msg={m} selfId={userId}
                onRetrySend={retryPending} onDiscardSend={discardPending} />
            ))}
          </>
        ) : (
          <>
            {groupedMessages.map(g => g.kind === 'divider' ? (
              <div key={g.key} className="msg-day-divider"><span>{g.label}</span></div>
            ) : g.msg.kind === 'system' ? (
              <div key={g.key} className="msg-system-row t-meta">{g.msg.body}</div>
            ) : (
              <MessageBubble
                key={g.key} msg={g.msg} selfId={userId}
                isContinuation={g.isContinuation}
                replyMeta={replyCounts.get(g.msg.id) || null}
                parent={g.msg.parent_id ? messagesById.get(g.msg.parent_id) : null}
                onJumpToMessage={flashMessage}
                isFocused={focusedId === g.msg.id}
                onDelete={handleDelete}
                onAttachmentDragStart={handleAttachmentDragStart}
                onReact={handleReact}
                onEdit={handleEdit}
                onReply={handleReply}
                onPin={handlePin}
                onCopyLink={handleCopyLink}
                onRetrySend={retryPending}
                onDiscardSend={discardPending}
              />
            ))}
            {typingUsers.size > 0 && (
              <div className="msg-typing">
                <span className="msg-typing-dots"><span /><span /><span /></span>
                <span className="t-meta">{typingUsers.size === 1 ? 'Typing…' : `${typingUsers.size} typing…`}</span>
              </div>
            )}
          </>
        )}
      </div>

      {!searchOpen && unseenCount > 0 && (
        <button className="msg-jump-pill" onClick={() => jumpToBottom(true)}>
          ↓ {unseenCount} new message{unseenCount === 1 ? '' : 's'}
        </button>
      )}

      {canSend ? (
        <MessageComposer
          onSend={handleSend}
          onTyping={handleTyping}
          workspaceId={workspaceId}
          userId={userId}
          draftKey={draftKey}
          placeholder={replyParent ? 'Reply…' : 'Message…'}
        />
      ) : (
        <ReadOnlyComposerNotice reason={readOnlyReason} />
      )}
    </div>
  );
}

// Shown in place of the composer when the current user can't send from this
// workspace. Server-side: messages.insert RLS requires can_write_workspace on
// the current workspace — a role rule, not a plan rule (lib/messageAccess.js),
// so the note gives the real reason instead of blaming the plan (COMMS-08).
function ReadOnlyComposerNotice({ reason }) {
  return (
    <div className="msg-composer-readonly" role="status">
      <span className="msg-composer-readonly-text">
        {readOnlyCopy(reason).notice}
      </span>
    </div>
  );
}

// ── Group chat menu (rename / add / leave) ──────────────────────────
function GroupChatMenu({ anchor, onRename, onAdd, onLeave, canLeave, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const vw = window.innerWidth;
    const top = anchor.bottom + 4;
    const left = Math.min(anchor.left, vw - 180);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    // Claim Escape (preventDefault) so the layer beneath — the Messages panel —
    // doesn't close on the same press.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal((
    <div ref={popRef} className="msg-group-menu" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
      <button className="msg-group-menu-item" onClick={onRename}>
        <Icon as={Edit} size={12} /> Rename
      </button>
      <button className="msg-group-menu-item" onClick={onAdd}>
        <Icon as={UserPlus} size={12} /> Add people
      </button>
      <button
        className="msg-group-menu-item is-danger"
        onClick={canLeave ? onLeave : undefined}
        disabled={!canLeave}
        title={canLeave ? 'Leave conversation' : 'Need 3+ members to leave'}
      >
        <Icon as={LogOut} size={12} /> Leave
      </button>
    </div>
  ), document.body);
}

// ── Add-participants picker (messageable-users list + addParticipants) ──
function AddParticipantsPicker({ workspaceId, conversationId, existingIds, anchor, onClose, onAdded, actorId, currentUser }) {
  const { users: members } = useMessageableUsers(workspaceId);
  const feedback = useFeedback();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 });

  useEffect(() => {
    for (const m of members || []) userProfiles.resolve(m.user_id);
  }, [members]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const top = Math.min(anchor.bottom + 8, vh - 360);
    const left = Math.min(anchor.left, vw - 328);
    setPos({ top, left, maxHeight: Math.round(vh * 0.7) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    // Claim Escape (preventDefault) so the layer beneath — the Messages panel —
    // doesn't close on the same press.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members || [])
      .filter(m => !existingIds.has(m.user_id))
      .map(m => {
        const p = userProfiles.get(m.user_id);
        return {
          user_id: m.user_id,
          name: p?.name || m.name || p?.email || m.email || 'Member',
          email: p?.email || m.email || '',
          color: p?.color || m.color || pickPresenceColor(m.user_id),
        };
      })
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, existingIds, query]);

  const handleAdd = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    const nameOf = (uid) => userProfiles.get(uid)?.name || userProfiles.get(uid)?.email || 'someone';
    try {
      const joined = await addParticipants({ conversationId, userIds: picked });
      if (!joined.length) {
        feedback.toast({ type: 'info', message: 'They’re already in this conversation.' });
        onAdded?.();
        return;
      }
      const names = joined.map(nameOf);
      // Announce only the people who actually joined.
      const me = currentUser?.name || currentUser?.email || 'Someone';
      const body = `${me} added ${names.join(', ')}`;
      await sendMessage({
        workspaceId,
        conversationId,
        senderId: actorId,
        senderEmail: currentUser?.email || null,
        body,
        kind: 'system',
      });
      feedback.toast({ type: 'success', message: `Added ${names.join(', ')} to the conversation.` });
      onAdded?.();
    } catch (e) {
      console.warn('add participants failed', e);
      feedback.toast({ type: 'error', message: 'Could not add people — try again.' });
    } finally {
      setBusy(false);
    }
  };

  return createPortal((
    <div
      ref={popRef}
      className="msg-newconv-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 320, maxHeight: pos.maxHeight }}
    >
      <div className="msg-newconv-head">
        <span className="t-eyebrow">ADD TO THIS CONVERSATION</span>
        <button className="msg-panel-icon" onClick={onClose} aria-label="Close">
          <Icon as={X} size={12} />
        </button>
      </div>
      <div className="msg-newconv-search">
        <Icon as={Search} size={12} />
        <input
          ref={inputRef}
          className="msg-newconv-input"
          placeholder="Find people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="msg-newconv-list">
        {visibleMembers.length === 0 && (
          <div className="msg-empty t-meta">No more people to add.</div>
        )}
        {visibleMembers.map(m => {
          const sel = picked.includes(m.user_id);
          return (
            <button
              key={m.user_id}
              className={`msg-newconv-row ${sel ? 'is-picked' : ''}`}
              onClick={() => setPicked(p => sel ? p.filter(x => x !== m.user_id) : [...p, m.user_id])}
            >
              <span className="msg-row-avatar" style={{ background: m.color }}>
                {(m.name || 'M').charAt(0).toUpperCase()}
              </span>
              <span className="msg-row-text">
                <span className="msg-row-name">{m.name}</span>
                {m.email && m.email !== m.name && <span className="msg-row-preview t-meta">{m.email}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="msg-newconv-foot">
        <button
          className="msg-newconv-btn primary"
          disabled={picked.length === 0 || busy}
          onClick={handleAdd}
        >
          Add {picked.length || ''}
        </button>
      </div>
    </div>
  ), document.body);
}

function dayKey(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const days = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
