import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X, Search, Pin, MoreHorizontal, UserPlus, LogOut, Edit } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers.js';
import {
  sendMessage, deleteMessage, editMessage, toggleReaction,
  searchMessagesInConversation,
  fetchReplies, replyCountsFor, togglePin,
  listPinnedForConversation,
  addParticipants, leaveConversation, renameConversation,
} from '../lib/messages.js';
import {
  broadcastConversationMessage, broadcastConversationTyping,
} from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { INBOX_MIME } from '../lib/dragMimes.js';
import { inboxPayloadFor } from '../lib/messageAttachments.js';
import { SoleilMark } from './primitives.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

const STICK_THRESHOLD_PX = 80;

// conversation = { id, title, participants: [{ user_id, left_at, ... }] }
export function MessageThread({
  workspaceId, currentUser, conversation,
  onBack, onClose, onChanged, jumpToMessageId,
}) {
  const userId = currentUser?.id;
  const conversationId = conversation?.id;

  const { messages, typingUsers, refetch } = useMessageThread({
    conversationId, userId,
    onMarkedRead: onChanged,
  });

  const scrollRef = useRef(null);

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

  // Initial mount + conversation switch: jump to bottom instantly.
  useEffect(() => {
    wasAtBottomRef.current = true;
    setUnseenCount(0);
    prevLenRef.current = 0;
    requestAnimationFrame(() => jumpToBottom(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

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
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    listPinnedForConversation({ conversationId }).then(rows => { if (!cancelled) setPinned(rows); });
    return () => { cancelled = true; };
  }, [conversationId, messages.length]);

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

  // ── Day-divider grouping ─────────────────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastKey = null;
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
    if (!conversationId) return;
    try {
      const inserted = await sendMessage({
        workspaceId, conversationId,
        senderId: userId,
        senderEmail: currentUser?.email || null,
        parentId: replyParent?.id || null,
        body, attachments, mentions,
      });
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      await broadcastConversationMessage({ conversationId, payload });
      wasAtBottomRef.current = true;
      refetch();
      onChanged?.();
    } catch (e) { console.warn('send failed', e); }
  }, [workspaceId, userId, conversationId, currentUser, refetch, replyParent, onChanged]);

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
      refetch();
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
    } catch (e) { console.warn('rename failed', e); }
  };

  const openLeaveConfirm = async () => {
    if (isDm) return;
    setMenuAnchor(null);
    if (!window.confirm(`Leave "${titleText}"?`)) return;
    try {
      await leaveConversation({ conversationId, userId });
      onChanged?.();
      onBack?.();
    } catch (e) { console.warn('leave failed', e); }
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
          onAdded={() => { setAddPickerAnchor(null); onChanged?.(); refetch(); }}
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
                  onClick={() => flashMessage(p.id)}
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
                onClick={() => flashMessage(m.id)}
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
                onAttachmentDragStart={handleAttachmentDragStart}
              />
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
        placeholder={replyParent ? 'Reply…' : 'Message…'}
      />
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
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
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
  );
}

// ── Add-participants picker (workspace member list + addParticipants) ──
function AddParticipantsPicker({ workspaceId, conversationId, existingIds, anchor, onClose, onAdded, actorId, currentUser }) {
  const { members } = useWorkspaceMembers(workspaceId);
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
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
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
          name: p?.name || p?.email || 'Member',
          email: p?.email || '',
          color: p?.color || pickPresenceColor(m.user_id),
        };
      })
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, existingIds, query]);

  const handleAdd = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      await addParticipants({ conversationId, userIds: picked });
      // Post a system message announcing the additions.
      const names = picked.map(uid => userProfiles.get(uid)?.name || userProfiles.get(uid)?.email || 'someone');
      const verb = picked.length === 1 ? 'added' : 'added';
      const me = currentUser?.name || currentUser?.email || 'Someone';
      const body = `${me} ${verb} ${names.join(', ')}`;
      await sendMessage({
        workspaceId,
        conversationId,
        senderId: actorId,
        senderEmail: currentUser?.email || null,
        body,
        kind: 'system',
      });
      onAdded?.();
    } catch (e) {
      console.warn('add participants failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={popRef}
      className="msg-newconv-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 320, maxHeight: pos.maxHeight }}
    >
      <div className="msg-newconv-head">
        <span className="t-eyebrow">ADD PEOPLE</span>
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
          <div className="msg-empty t-meta">No more members to add.</div>
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
