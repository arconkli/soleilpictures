import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search, Pin, MoreHorizontal, UserPlus, LogOut, Edit } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { useMessageableUsers } from '../hooks/useMessageableUsers.js';
import {
  sendMessage, deleteMessage, restoreMessage, editMessage, toggleReaction,
  searchMessagesInConversation,
  fetchReplies, replyCountsFor, togglePin,
  listPinnedForConversation,
  addParticipants, leaveConversation, renameConversation,
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
import { showingConversation } from '../lib/threadAttention.js';
import { readOnlyCopy } from '../lib/messageAccess.js';

const STICK_THRESHOLD_PX = 80;
// Start fetching the previous page this far before the reader hits the top.
const LOAD_OLDER_THRESHOLD_PX = 120;

// conversation = { id, title, participants: [{ user_id, left_at, ... }] }
export function MessageThread({
  workspaceId, currentUser, conversation,
  onBack, onClose, onChanged, jumpToMessageId,
  canSend = true, readOnlyReason = null,
}) {
  const userId = currentUser?.id;
  const conversationId = conversation?.id;
  const feedback = useFeedback();

  const { messages, typingUsers, refetch, hasOlder, loadingOlder, loadOlder, failed: loadFailed } = useMessageThread({
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
  const isDm = activeParticipants.length === 2;

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
      requestAnimationFrame(() => jumpToBottom(true));
    } else {
      const at = messages.findIndex(m => m.id === prevId);
      const added = at >= 0 ? messages.length - 1 - at : 1;
      if (added > 0) setUnseenCount(c => c + added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

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
    let cancelled = false;
    replyCountsFor(topLevelIds).then(map => {
      if (!cancelled) setReplyCounts(map);
    });
    return () => { cancelled = true; };
  }, [messages, replyParent]);

  // ── Pinned strip ─────────────────────────────────────────────────────
  const [pinned, setPinned] = useState([]);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  // Also re-read when a loaded message is pinned or unpinned: a peer's pin
  // arrives as a refetch that leaves the count where it was.
  const pinnedSig = messages.filter(m => m.is_pinned).map(m => m.id).join(',');
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    listPinnedForConversation({ conversationId }).then(rows => { if (!cancelled) setPinned(rows); });
    return () => { cancelled = true; };
  }, [conversationId, messages.length, pinnedSig]);

  // ── Permalink scroll ─────────────────────────────────────────────────
  useEffect(() => {
    if (!jumpToMessageId) return;
    const t = setTimeout(() => flashMessage(jumpToMessageId), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId, messages.length]);

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
        if (searchOpen) closeSearch();
        else if (replyParent) setReplyParent(null);
        else onClose?.();
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
  // Optimistic sends: the message renders instantly with a "Sending…"
  // state; on failure it flips to a failed bubble with Retry/Discard (the
  // composer already cleared, so the bubble owns recovery — plus an error
  // toast in case the user has scrolled away).
  const [pendingMsgs, setPendingMsgs] = useState([]);
  useEffect(() => { setPendingMsgs([]); }, [conversationId]);

  const deliverPending = useCallback(async (tmp) => {
    try {
      const inserted = await sendMessage({
        workspaceId, conversationId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        parentId: tmp.parent_id,
        body: tmp.body, attachments: tmp.attachments, mentions: tmp.mentions,
      });
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      await broadcastConversationMessage({ conversationId, payload });
      // refetch resolves after setMessages, so the real row is in place
      // before the optimistic one unmounts — no flicker gap.
      await refetch();
      setPendingMsgs(p => p.filter(x => x.id !== tmp.id));
      onChanged?.();
    } catch (e) {
      console.warn('send failed', e);
      setPendingMsgs(p => p.map(x => x.id === tmp.id ? { ...x, sendState: 'failed' } : x));
      feedback.toast({ type: 'error', message: "Message didn't send — it's kept in the thread with a Retry button." });
    }
  }, [workspaceId, conversationId, userId, currentUser, refetch, onChanged, feedback]);

  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    if (!conversationId) return false;
    const tmp = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      body, attachments, mentions,
      parent_id: replyParent?.id || null,
      sender_id: userId,
      sender_name: currentUser?.name || currentUser?.email,
      created_at: new Date().toISOString(),
      sendState: 'sending',
    };
    setPendingMsgs(p => [...p, tmp]);
    wasAtBottomRef.current = true;
    deliverPending(tmp);
    return true;
  }, [conversationId, replyParent, userId, currentUser, deliverPending]);

  const retryPending = useCallback((msg) => {
    setPendingMsgs(p => p.map(x => x.id === msg.id ? { ...x, sendState: 'sending' } : x));
    deliverPending(msg);
  }, [deliverPending]);
  const discardPending = useCallback((msg) => {
    setPendingMsgs(p => p.filter(x => x.id !== msg.id));
  }, []);

  const handleDelete = useCallback(async (msg) => {
    // ("This can't be undone" was a lie — messages soft-delete via
    // deleted_at. Keep the confirm because deletion is peer-visible, but be
    // honest, and offer the Undo the mechanism always allowed.)
    const ok = await feedback.confirm({
      title: 'Delete message',
      message: 'Delete this message? You can undo for a few seconds after.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMessage({ id: msg.id });
      refetch();
      // Peers only learn of a change already in the thread from a nudge:
      // messages aren't in the realtime publication (COMMS-04).
      broadcastConversationChange({ conversationId, changed: 'delete', id: msg.id });
      undoToast(feedback, {
        message: 'Message deleted',
        onUndo: async () => {
          try {
            await restoreMessage({ id: msg.id });
            refetch();
            broadcastConversationChange({ conversationId, changed: 'restore', id: msg.id });
          }
          catch (e) { feedback.toast({ type: 'error', message: 'Could not restore the message — try again.' }); }
        },
      });
    } catch (e) {
      console.warn('delete failed', e);
      feedback.toast({ type: 'error', message: 'Could not delete the message — try again.' });
    }
  }, [conversationId, refetch, feedback]);

  const handleEdit = useCallback(async (msg, newBody) => {
    try {
      await editMessage({ id: msg.id, body: newBody });
      refetch();
      broadcastConversationChange({ conversationId, changed: 'edit', id: msg.id });
    } catch (e) {
      console.warn('edit failed', e);
      feedback.toast({ type: 'error', message: 'Could not save your edit — try again.' });
    }
  }, [conversationId, refetch, feedback]);

  const handleReact = useCallback(async (msg, emoji) => {
    if (!emoji) return;
    try {
      await toggleReaction({ messageId: msg.id, emoji, userId });
      refetch();
      broadcastConversationChange({ conversationId, changed: 'react', id: msg.id });
    } catch (e) {
      feedback.toast({ type: 'error', message: "Couldn't save your reaction — try again." });
    }
  }, [conversationId, userId, refetch, feedback]);

  const handleReply = useCallback((msg) => {
    setReplyParent(msg);
    setFocusedId(null);
  }, []);

  const handlePin = useCallback(async (msg) => {
    try {
      await togglePin(msg.id);
      refetch();
      broadcastConversationChange({ conversationId, changed: 'pin', id: msg.id });
      const rows = await listPinnedForConversation({ conversationId });
      setPinned(rows);
    } catch (e) { console.warn('pin failed', e); }
  }, [conversationId, refetch]);

  const handleCopyLink = useCallback(async (msg) => {
    const url = `${window.location.origin}${window.location.pathname}?m=${msg.id}`;
    try { await navigator.clipboard.writeText(url); } catch (_) {}
  }, []);

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
    try {
      await leaveConversation({ conversationId, userId });
      onChanged?.();
      onBack?.();
    } catch (e) {
      console.warn('leave failed', e);
      feedback.toast({ type: 'error', message: 'Could not leave the conversation — try again.' });
    }
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
          <div className="t-eyebrow msg-panel-eyebrow">{subtitle}</div>
          {renaming ? (
            <input
              className="msg-panel-name-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { setRenaming(false); }
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
          canLeave={activeParticipants.length > 2}
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
          <button className="msg-pinned-head" onClick={() => setPinnedExpanded(v => !v)}>
            <Icon as={Pin} size={11} />
            <span className="t-eyebrow">PINNED · {pinned.length}</span>
            <span className="msg-pinned-chev">{pinnedExpanded ? '▾' : '▸'}</span>
          </button>
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

      <div className="msg-thread-body" ref={scrollRef} onScroll={onScroll}>
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
        ) : isEmpty ? (
          <div className="msg-empty msg-empty-hero">
            <SoleilMark size={32} color="var(--soleil)" glow />
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
            {pendingMsgs.filter(m => m.parent_id === replyParent.id).map(m => (
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
              />
            ))}
            {pendingMsgs.filter(m => !m.parent_id).map(m => (
              <MessageBubble key={m.id} msg={m} selfId={userId}
                onRetrySend={retryPending} onDiscardSend={discardPending} />
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
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
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
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
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
