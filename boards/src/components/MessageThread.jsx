import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search, Pin } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import {
  sendMessage, deleteMessage, editMessage, toggleReaction,
  searchMessagesInBoard, searchMessagesInDm,
  fetchReplies, replyCountsFor, togglePin,
  listPinnedForBoard, listPinnedForDm,
} from '../lib/messages.js';
import {
  broadcastBoardMessage, broadcastDmMessage,
  broadcastBoardTyping,  broadcastDmTyping,
} from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { INBOX_MIME } from '../lib/dragMimes.js';
import { inboxPayloadFor } from '../lib/messageAttachments.js';
import { SoleilMark } from './primitives.jsx';

const STICK_THRESHOLD_PX = 80;

export function MessageThread({ workspaceId, currentUser, thread, onBack, onClose, jumpToMessageId }) {
  const userId = currentUser?.id;
  const { messages, typingUsers, refetch } = useMessageThread({ workspaceId, userId, thread });
  const scrollRef = useRef(null);

  // ── Sticky-scroll behavior ───────────────────────────────────────────
  const wasAtBottomRef = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const prevLenRef = useRef(0);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };
  const onScroll = () => {
    wasAtBottomRef.current = isNearBottom();
    if (wasAtBottomRef.current) setUnseenCount(0);
  };
  const jumpToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseenCount(0);
  };

  // Initial mount + thread switch: jump to bottom instantly.
  useEffect(() => {
    wasAtBottomRef.current = true;
    setUnseenCount(0);
    prevLenRef.current = 0;
    requestAnimationFrame(() => jumpToBottom(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.kind, thread?.boardId, thread?.peerId]);

  useEffect(() => {
    const prev = prevLenRef.current;
    const now = messages.length;
    prevLenRef.current = now;
    if (now <= prev) return;
    if (wasAtBottomRef.current) {
      requestAnimationFrame(() => jumpToBottom(true));
    } else {
      setUnseenCount(c => c + (now - prev));
    }
  }, [messages.length]);

  // ── Search ───────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!searchOpen || !q) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeqRef.current;
    const t = setTimeout(async () => {
      let rows = [];
      try {
        if (thread.kind === 'board') {
          rows = await searchMessagesInBoard({ boardId: thread.boardId, query: q, limit: 50 });
        } else if (thread.kind === 'dm') {
          rows = await searchMessagesInDm({
            workspaceId, userA: userId, userB: thread.peerId, query: q, limit: 50,
          });
        }
      } catch (e) { console.warn('search failed', e); }
      if (seq !== searchSeqRef.current) return;
      setSearchResults(rows);
      setSearching(false);
    }, 150);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen, thread, workspaceId, userId]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // ── Threaded replies ─────────────────────────────────────────────────
  // When non-null, the panel renders in "thread mode": just the parent
  // message + its replies + a composer scoped to that parent_id.
  const [replyParent, setReplyParent] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyCounts, setReplyCounts] = useState(new Map());

  // Refetch replies for the open parent on every refetch tick.
  useEffect(() => {
    if (!replyParent) return;
    let cancelled = false;
    fetchReplies({ parentId: replyParent.id }).then(rows => {
      if (!cancelled) setReplies(rows);
    });
    return () => { cancelled = true; };
  }, [replyParent, messages.length]);

  // Bulk-load reply counts for messages in the main view (only top-
  // level messages — those without parent_id — can have replies).
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
  useEffect(() => {
    let cancelled = false;
    const fn = thread.kind === 'board'
      ? listPinnedForBoard({ boardId: thread.boardId })
      : thread.kind === 'dm'
        ? listPinnedForDm({ workspaceId, userA: userId, userB: thread.peerId })
        : Promise.resolve([]);
    fn.then(rows => { if (!cancelled) setPinned(rows); });
    return () => { cancelled = true; };
  }, [thread, workspaceId, userId, messages.length]);

  // ── Permalink scroll ─────────────────────────────────────────────────
  useEffect(() => {
    if (!jumpToMessageId) return;
    const t = setTimeout(() => flashMessage(jumpToMessageId), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId, messages.length]);

  // ⌘F + j/k/r/e/Esc keyboard shortcuts.
  const [focusedId, setFocusedId] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      // Only when the messages panel is on screen / under focus.
      if (!e.target?.closest?.('.msg-panel')) return;
      // Don't intercept keys while typing in inputs / textareas.
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
          // Bubble's own edit handler is gated; signal via a custom event.
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

  // Map of message id → message, used to render a parent-preview chip
  // on top of each reply in the main feed (iMessage-style). The thread
  // panel still owns full back-and-forth via the "X replies" badge.
  const messagesById = useMemo(() => {
    const m = new Map();
    for (const x of messages || []) m.set(x.id, x);
    return m;
  }, [messages]);

  // ── Day-divider grouping ─────────────────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastKey = null;
    // Main view shows everything — top-level messages AND their replies
    // (each reply gets a small preview chip pointing at its parent). The
    // thread mode below renders parent + replies separately.
    const list = replyParent ? [] : (messages || []);
    for (const m of list) {
      const k = dayKey(m.created_at);
      if (k !== lastKey) {
        groups.push({ kind: 'divider', key: 'd-' + k, label: dayLabel(m.created_at) });
        lastKey = k;
      }
      groups.push({ kind: 'msg', key: m.id, msg: m });
    }
    return groups;
  }, [messages, replyParent]);

  // ── Send / Edit / Delete / React / Reply / Pin / Copy-link ──────────
  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    const dmPeerId = thread.kind === 'dm' ? thread.peerId : null;
    const boardId  = thread.kind === 'board' ? thread.boardId : null;
    try {
      const inserted = await sendMessage({
        workspaceId, boardId, dmPeerId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        parentId: replyParent?.id || null,
        body, attachments, mentions,
      });
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      if (boardId) await broadcastBoardMessage({ boardId, payload });
      else         await broadcastDmMessage({ userA: userId, userB: dmPeerId, payload });
      wasAtBottomRef.current = true;
      refetch();
    } catch (e) { console.warn('send failed', e); }
  }, [workspaceId, userId, thread, currentUser, refetch, replyParent]);

  const handleDelete = useCallback(async (msg) => {
    await deleteMessage({ id: msg.id });
    refetch();
  }, [refetch]);

  const handleEdit = useCallback(async (msg, newBody) => {
    await editMessage({ id: msg.id, body: newBody });
    refetch();
  }, [refetch]);

  const handleReact = useCallback(async (msg, emoji) => {
    if (!emoji) return;
    await toggleReaction({ messageId: msg.id, emoji, userId });
    refetch();
  }, [userId, refetch]);

  const handleReply = useCallback((msg) => {
    setReplyParent(msg);
    setFocusedId(null);
  }, []);

  const handlePin = useCallback(async (msg) => {
    try {
      await togglePin(msg.id);
      // Refetch pinned + main list.
      refetch();
      const fn = thread.kind === 'board'
        ? listPinnedForBoard({ boardId: thread.boardId })
        : listPinnedForDm({ workspaceId, userA: userId, userB: thread.peerId });
      const rows = await fn;
      setPinned(rows);
    } catch (e) { console.warn('pin failed', e); }
  }, [thread, workspaceId, userId, refetch]);

  const handleCopyLink = useCallback(async (msg) => {
    const url = `${window.location.origin}${window.location.pathname}?m=${msg.id}`;
    try { await navigator.clipboard.writeText(url); } catch (_) {}
  }, []);

  const handleTyping = useCallback(() => {
    if (thread.kind === 'board') broadcastBoardTyping({ boardId: thread.boardId, userId });
    else                          broadcastDmTyping({ userA: userId, userB: thread.peerId, userId });
  }, [thread, userId]);

  const handleAttachmentDragStart = (e, att) => {
    const payload = inboxPayloadFor(att);
    if (!payload) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(INBOX_MIME, JSON.stringify(payload));
  };

  // ── Render ───────────────────────────────────────────────────────────
  const isEmpty = !searchOpen && !replyParent && messages.length === 0;
  const subtitle = replyParent ? 'THREAD' : (thread?.kind === 'dm' ? 'DIRECT MESSAGE' : 'BOARD CHAT');
  const titleText = replyParent ? 'Reply in thread' : (thread?.name || 'Thread');

  // Threading mode: only parent + its replies are shown.
  const threadList = replyParent
    ? [{ kind: 'msg', key: replyParent.id, msg: replyParent }, ...replies.map(r => ({ kind: 'msg', key: r.id, msg: r }))]
    : null;

  // Pinned strip is hidden in thread mode + search mode.
  const showPinned = !replyParent && !searchOpen && pinned.length > 0;

  // Draft-key for the composer (so reply-mode has its own draft).
  const draftKey = thread?.kind === 'board'
    ? (replyParent ? `b:${thread.boardId}:r:${replyParent.id}` : `b:${thread.boardId}`)
    : (replyParent ? `d:${thread.peerId}:r:${replyParent.id}` : `d:${thread.peerId}`);

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="msg-panel-icon"
                onClick={() => { if (replyParent) setReplyParent(null); else onBack?.(); }}
                title={replyParent ? 'Back to thread' : 'Back'}
                aria-label="Back">
          <Icon as={ChevronLeft} size={14} />
        </button>
        <div className="msg-panel-title">
          <div className="t-eyebrow msg-panel-eyebrow">{subtitle}</div>
          <div className="msg-panel-name" title={titleText}>{titleText}</div>
        </div>
        <button className={`msg-panel-icon ${searchOpen ? 'is-active' : ''}`}
                onClick={() => {
                  if (searchOpen) closeSearch();
                  else { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }
                }}
                title="Search messages (⌘F)" aria-label="Search messages">
          <Icon as={Search} size={14} />
        </button>
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
      </div>

      {searchOpen && (
        <div className="msg-search">
          <Icon as={Search} size={12} />
          <input ref={searchInputRef}
                 className="msg-search-input"
                 placeholder="Find in conversation…"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)} />
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
                <button key={p.id}
                        className="msg-pinned-item"
                        onClick={() => flashMessage(p.id)}
                        title={`Jump to message · ${new Date(p.created_at).toLocaleString()}`}>
                  <span className="msg-pinned-item-body">{(p.body || '').slice(0, 80)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="msg-thread-body" ref={scrollRef} onScroll={onScroll}>
        {searchOpen && searchQuery.trim() ? (
          <>
            <div className="msg-search-summary t-meta">
              {searching ? 'Searching…' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
            </div>
            {searchResults.length === 0 && !searching && (
              <div className="msg-empty">No matches for "{searchQuery}".</div>
            )}
            {searchResults.map(m => (
              <button key={m.id}
                      className="msg-search-result"
                      onClick={() => flashMessage(m.id)}>
                <MessageBubble msg={m} selfId={userId} highlight={searchQuery}
                               onDelete={handleDelete}
                               onAttachmentDragStart={handleAttachmentDragStart}
                               onReact={handleReact}
                               onEdit={handleEdit} />
              </button>
            ))}
          </>
        ) : isEmpty ? (
          <div className="msg-empty msg-empty-hero">
            <SoleilMark size={32} color="var(--soleil)" glow />
            <div className="msg-empty-title">No messages yet</div>
            <div className="msg-empty-sub">Say hi 👋</div>
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
                             onAttachmentDragStart={handleAttachmentDragStart} />
            ))}
          </>
        ) : (
          <>
            {groupedMessages.map(g => g.kind === 'divider' ? (
              <div key={g.key} className="msg-day-divider"><span>{g.label}</span></div>
            ) : (
              <MessageBubble
                key={g.key} msg={g.msg} selfId={userId}
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

      <MessageComposer
        onSend={handleSend}
        onTyping={handleTyping}
        workspaceId={workspaceId}
        userId={userId}
        draftKey={draftKey}
        placeholder={replyParent ? 'Reply…' : 'Message…'} />
    </div>
  );
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
