import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import {
  sendMessage, deleteMessage, editMessage, toggleReaction,
  searchMessagesInBoard, searchMessagesInDm,
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

export function MessageThread({ workspaceId, currentUser, thread, onBack, onClose }) {
  const userId = currentUser?.id;
  const { messages, typingUsers, refetch } = useMessageThread({ workspaceId, userId, thread });
  const scrollRef = useRef(null);

  // Sticky-scroll behavior: if the user is at-or-near the bottom when
  // a new message arrives, auto-scroll to it. If they're scrolled up
  // reading history, leave them put + show a "↓ N new" pill.
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

  // New message arrived: stick if near bottom, else show pill.
  useEffect(() => {
    const prev = prevLenRef.current;
    const now = messages.length;
    prevLenRef.current = now;
    if (now <= prev) return; // delete / refetch noise
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

  // Run a debounced server-side search whenever the query or thread changes.
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

  // ⌘F opens search when this thread has focus.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        if (e.target?.closest?.('.msg-panel')) {
          e.preventDefault();
          setSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }
      } else if (e.key === 'Escape' && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // Scroll to a specific message (used when a search result is clicked).
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

  // ── Day-divider grouping ─────────────────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastKey = null;
    for (const m of messages) {
      const k = dayKey(m.created_at);
      if (k !== lastKey) {
        groups.push({ kind: 'divider', key: 'd-' + k, label: dayLabel(m.created_at) });
        lastKey = k;
      }
      groups.push({ kind: 'msg', key: m.id, msg: m });
    }
    return groups;
  }, [messages]);

  // ── Send / Edit / Delete / React ─────────────────────────────────────
  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    const dmPeerId = thread.kind === 'dm' ? thread.peerId : null;
    const boardId  = thread.kind === 'board' ? thread.boardId : null;
    try {
      const inserted = await sendMessage({
        workspaceId, boardId, dmPeerId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        body, attachments, mentions,
      });
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      if (boardId) await broadcastBoardMessage({ boardId, payload });
      else         await broadcastDmMessage({ userA: userId, userB: dmPeerId, payload });
      // Sender just typed — they're at the bottom by definition.
      wasAtBottomRef.current = true;
      refetch();
    } catch (e) { console.warn('send failed', e); }
  }, [workspaceId, userId, thread, currentUser, refetch]);

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
  const isEmpty = !searchOpen && messages.length === 0;
  const subtitle = thread?.kind === 'dm'
    ? 'DIRECT MESSAGE'
    : thread?.kind === 'board'
      ? 'BOARD CHAT'
      : '';

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="msg-panel-icon" onClick={onBack} title="Back" aria-label="Back to channels">
          <Icon as={ChevronLeft} size={14} />
        </button>
        <div className="msg-panel-title">
          <div className="t-eyebrow msg-panel-eyebrow">{subtitle}</div>
          <div className="msg-panel-name" title={thread?.name || 'Thread'}>{thread?.name || 'Thread'}</div>
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
        ) : (
          <>
            {groupedMessages.map(g => g.kind === 'divider' ? (
              <div key={g.key} className="msg-day-divider"><span>{g.label}</span></div>
            ) : (
              <MessageBubble
                key={g.key}
                msg={g.msg}
                selfId={userId}
                onDelete={handleDelete}
                onAttachmentDragStart={handleAttachmentDragStart}
                onReact={handleReact}
                onEdit={handleEdit}
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

      <MessageComposer onSend={handleSend} onTyping={handleTyping}
                       workspaceId={workspaceId} userId={userId} />
    </div>
  );
}

// Stable per-day key for grouping (locale-aware date string).
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
  // Within the past week: weekday name.
  const days = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  // Older: full date.
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
