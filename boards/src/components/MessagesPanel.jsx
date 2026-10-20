import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Plus, X, EyeOff, LogOut, Search } from '../lib/icons.js';
import { useConversationList } from '../hooks/useConversationList.js';
import { useMessagesLook } from './messagesLook.js';
import { conversationMatches } from '../lib/messagesCard.js';
import './messagesCard.css';
import { findOrCreateDm, leaveConversation, rejoinConversation } from '../lib/messages.js';
import { hiddenFromInbox, isDmConversation } from '../lib/conversationState.js';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { NewConversationPicker } from './NewConversationPicker.jsx';
import { MessageThread } from './MessageThread.jsx';
import { readOnlyCopy } from '../lib/messageAccess.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

// Right-drawer slot. Single unified conversation list (DMs + group
// chats interleaved by recency). Two modes: list, or thread (one open
// conversation).
//
//   workspaceId, currentUser
//   openConversationId, setOpenConversationId — controlled by App.jsx so a
//     toast's "Open" can open a thread (which thread is on screen, for
//     toast suppression, is threadAttention.js's job)
//   initialOpenConversationId — set by permalink resolver to deep-link
//   jumpToMessageId           — passed through to MessageThread
//   pendingOpenPeerId         — when set, find/create a DM with this
//                               user and open it (used by avatar-click)
//   refreshTick               — bumped externally to invalidate caches
//   onRefreshRequested        — called by children when they need a list refresh
//   onClose
export function MessagesPanel({
  workspaceId, currentUser,
  openConversationId, setOpenConversationId,
  initialOpenConversationId, jumpToMessageId, pendingOpenPeerId,
  suggestedUserIds,
  refreshTick, onRefreshRequested, onPermalinkConsumed, onPeerConsumed,
  onClose,
  canSendMessages = true, // false → a viewer here, or on the waitlist (lib/messageAccess.js)
  readOnlyReason = null,  // why not: 'viewer' | 'waitlist'
}) {
  const userId = currentUser?.id;
  const {
    conversations, participantsByConv, myStateByConv, unreadByConv, loaded, failed, retry,
  } = useConversationList({ workspaceId, userId, refreshTick });

  // A permalinked message to flash once, tied to ITS conversation: it used to
  // outlive the jump and follow you into other threads, closing their search
  // on every arrival (COMMS-09). Cleared once the thread has flashed it.
  const [pendingJump, setPendingJump] = useState(() => (
    jumpToMessageId ? { convId: initialOpenConversationId || null, messageId: jumpToMessageId } : null
  ));
  const [composeAnchor, setComposeAnchor] = useState(null);

  // First-mount permalink: open whatever the parent says is open.
  useEffect(() => {
    if (initialOpenConversationId) {
      setOpenConversationId(initialOpenConversationId);
      setPendingJump(jumpToMessageId ? { convId: initialOpenConversationId, messageId: jumpToMessageId } : null);
    }
  }, [initialOpenConversationId, jumpToMessageId, setOpenConversationId]);

  // The parent passes these as fresh inline arrows on every render. Read
  // them through refs so a re-render can't restart the effect below.
  const onRefreshRequestedRef = useRef(onRefreshRequested);
  onRefreshRequestedRef.current = onRefreshRequested;
  const onPeerConsumedRef = useRef(onPeerConsumed);
  onPeerConsumedRef.current = onPeerConsumed;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Avatar-click DM open: find/create a DM with the requested peer
  // and open the thread.
  //
  // Keyed on the peer and workspace ONLY (COMMS-01). It used to depend on
  // those inline callbacks, so any parent re-render while find_or_create_dm
  // was in flight (opening the panel itself triggers one) cancelled the run
  // and started a second RPC; the first run's `finally` then cleared the
  // pending peer, cancelling the second — and the panel landed on the list,
  // not the DM. Two racing RPCs could also mint two DMs on a first contact.
  // Now only the run that wasn't superseded consumes the peer; a run cut
  // short by the panel closing still consumes it, so a later open doesn't
  // jump into a DM nobody asked for any more.
  useEffect(() => {
    if (!pendingOpenPeerId || !workspaceId) return;
    let cancelled = false;
    (async () => {
      let convId = null;
      try {
        convId = await findOrCreateDm({ workspaceId, peerId: pendingOpenPeerId });
      } catch (e) { console.warn('[MessagesPanel] open peer failed', e); }
      if (cancelled) {
        // Superseded by a newer peer: that run owns it. Panel closed: drop it.
        if (!mountedRef.current) onPeerConsumedRef.current?.();
        return;
      }
      if (convId) {
        setOpenConversationId(convId);
        onRefreshRequestedRef.current?.();
      }
      onPeerConsumedRef.current?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenPeerId, workspaceId]);

  // Resolve names for every participant we encounter so the list and
  // thread bar render real labels instead of "Member".
  useEffect(() => {
    for (const list of participantsByConv.values()) {
      for (const p of list) {
        if (p.user_id !== userId) userProfiles.resolve(p.user_id);
      }
    }
  }, [participantsByConv, userId]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  // Filter out conversations the current user has left or hidden (a hidden
  // DM comes back when the other person writes — see conversationState.js).
  const visibleConversations = useMemo(() => {
    return (conversations || []).filter(c => !hiddenFromInbox({
      conv: c,
      me: myStateByConv.get(c.conversation_id),
      participants: participantsByConv.get(c.conversation_id),
    }));
  }, [conversations, myStateByConv, participantsByConv]);

  // The card look (the files sidebar's, preview only) has a find line over
  // the list: a conversation stays while every word is in its title, its
  // people's names or its last message.
  const card = useMessagesLook() === 'card';
  const [find, setFind] = useState('');
  const shownConversations = useMemo(() => {
    if (!card || !find.trim()) return visibleConversations;
    return visibleConversations.filter((c) => {
      const names = (participantsByConv.get(c.conversation_id) || [])
        .filter(p => p.user_id !== userId)
        .map(p => userProfiles.get(p.user_id)?.name || userProfiles.get(p.user_id)?.email || '');
      return conversationMatches({ title: c.title || '', names, preview: c.last_message_body || '' }, find);
    });
  }, [card, find, visibleConversations, participantsByConv, userId]);

  const handleConversationCreated = useCallback((convId) => {
    setOpenConversationId(convId);
    onRefreshRequested?.();
  }, [onRefreshRequested]);

  // Hide a DM, or leave a group, from the row's menu. It used to fire on a
  // bare right-click (or an Android long-press) with no confirmation and no
  // undo — a full Leave for a group (COMMS-11). Now: a menu, a confirm for a
  // group, and the house Undo toast either way.
  const feedback = useFeedback();
  const [rowMenu, setRowMenu] = useState(null); // { convId, x, y }
  const handleHideRow = useCallback(async (convId) => {
    if (!userId || !convId) return;
    const isGroup = !isDmConversation(participantsByConv.get(convId));
    if (isGroup) {
      const ok = await feedback.confirm({
        title: 'Leave conversation',
        message: "Leave this group? You'll stop receiving its messages.",
        confirmLabel: 'Leave',
        danger: true,
      });
      if (!ok) return;
    }
    const done = await leaveConversation({ conversationId: convId, userId });
    if (!done) {
      feedback.toast({ type: 'error', message: isGroup ? "Couldn't leave the conversation — try again." : "Couldn't hide the conversation — try again." });
      return;
    }
    onRefreshRequested?.();
    undoToast(feedback, {
      message: isGroup ? 'You left the conversation' : 'Conversation hidden',
      onUndo: async () => {
        const back = await rejoinConversation({ conversationId: convId, userId });
        if (!back) { feedback.toast({ type: 'error', message: "Couldn't bring the conversation back — try again." }); return; }
        onRefreshRequested?.();
      },
    });
  }, [userId, participantsByConv, onRefreshRequested, feedback]);

  // Opening a DM you hid — through a toast, a permalink, or because the
  // other person wrote again — takes you back in. Until then the server
  // refuses your replies: you're not an active participant.
  const myOpenState = openConversationId ? myStateByConv.get(openConversationId) : null;
  const openIsDm = isDmConversation(openConversationId ? participantsByConv.get(openConversationId) : null);
  const rejoinedRef = useRef(null);
  useEffect(() => {
    if (!openConversationId || !userId || !myOpenState?.left_at || !openIsDm) return;
    // Once per hide: a failed attempt isn't retried on every render.
    const key = `${openConversationId}:${myOpenState.left_at}`;
    if (rejoinedRef.current === key) return;
    rejoinedRef.current = key;
    rejoinConversation({ conversationId: openConversationId, userId }).then((ok) => {
      if (ok) onRefreshRequestedRef.current?.();
    });
  }, [openConversationId, userId, myOpenState?.left_at, openIsDm]);

  // Escape closes the list view, as its "Close (Esc)" says — only the thread
  // view did (COMMS-22). The list takes focus when it shows, so the key
  // reaches it straight after opening; a press claimed by a picker or menu
  // on top, or meant for something outside the panel, is left alone.
  const listRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (openConversationId) return;
    try { listRef.current?.focus({ preventScroll: true }); } catch (_) {}
    const onKey = (e) => { if (escapeClosesPanel(e, '.msg-panel')) onCloseRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openConversationId]);

  if (openConversationId) {
    const conv = conversations.find(c => c.conversation_id === openConversationId);
    const parts = participantsByConv.get(openConversationId) || [];
    return (
      <MessageThread
        // One instance per conversation: nothing a thread holds (a reply
        // target, staged files, search, the pinned list) can carry into the
        // next one when a toast, an avatar or a link switches it in place.
        key={openConversationId}
        workspaceId={workspaceId}
        // undefined while the list is still loading: the thread reads it itself.
        lastReadAt={myOpenState ? (myOpenState.last_read_at || null) : undefined}
        currentUser={currentUser}
        // A group you left is readable (a permalink, a toast) but not yours
        // to post in; a hidden DM is rejoined above.
        canSend={canSendMessages && !(myOpenState?.left_at && !openIsDm)}
        readOnlyReason={canSendMessages ? 'left' : readOnlyReason}
        conversation={{
          id: openConversationId,
          title: conv?.title || null,
          participants: parts,
        }}
        jumpToMessageId={pendingJump?.convId === openConversationId ? pendingJump.messageId : null}
        onJumpConsumed={() => setPendingJump(null)}
        onChanged={onRefreshRequested}
        onBack={() => {
          setOpenConversationId(null);
          setPendingJump(null);
          onPermalinkConsumed?.();
        }}
        onClose={() => { onPermalinkConsumed?.(); onClose?.(); }}
      />
    );
  }

  return (
    <div className="msg-panel" ref={listRef} tabIndex={-1}>
      <div className="msg-panel-head">
        <div className="msg-panel-title">
          {card ? (
            <div className="msg-panel-name">Messages</div>
          ) : (
            <>
              <div className="t-eyebrow msg-panel-eyebrow">MESSAGES</div>
              <div className="msg-panel-name">All conversations</div>
            </>
          )}
        </div>
        <button
          className="msg-panel-icon"
          onClick={(e) => setComposeAnchor(e.currentTarget.getBoundingClientRect())}
          title={canSendMessages ? 'New chat' : readOnlyCopy(readOnlyReason).newChatTitle}
          aria-label="New chat"
          disabled={!canSendMessages}
        >
          <Icon as={Plus} size={14} />
        </button>
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
      </div>

      {card && visibleConversations.length > 0 && (
        <label className="msg-find">
          <Icon as={Search} size={14} />
          <input type="search" value={find} placeholder="Find a conversation" aria-label="Find a conversation"
                 onChange={(e) => setFind(e.target.value)}
                 onKeyDown={(e) => {
                   // Esc clears a find first; the panel closes on the next one.
                   if (e.key === 'Escape' && find) { e.preventDefault(); setFind(''); }
                 }} />
        </label>
      )}

      <div className="msg-panel-body">
        {!loaded && (
          // First-load skeleton — "no data yet", not "no conversations".
          <div className="msg-skel-list" aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div key={i} className="msg-skel-row">
                <span className="msg-skel-avatar" />
                <span className="msg-skel-lines">
                  <span className="msg-skel-line" />
                  <span className="msg-skel-line msg-skel-line-short" />
                </span>
              </div>
            ))}
          </div>
        )}
        {loaded && failed && (
          // A failed read is not an empty inbox (COMMS-15). Anything listed
          // below is the last good read.
          <div className="msg-load-failed t-meta" role="alert">
            <span>Couldn't load your conversations.</span>
            <button type="button" className="msg-retry-btn" onClick={() => { retry().then(null, () => {}); }}>Retry</button>
          </div>
        )}
        {loaded && !failed && visibleConversations.length === 0 && (
          <div className="msg-empty t-meta">
            No conversations yet. Click <span className="msg-empty-plus"><Icon as={Plus} size={11} /></span> to start one.
          </div>
        )}
        {card && find.trim() && visibleConversations.length > 0 && shownConversations.length === 0 && (
          <div className="msg-empty t-meta">No conversations match “{find.trim()}”.</div>
        )}
        {shownConversations.map(conv => (
          <ConversationRow
            key={conv.conversation_id}
            card={card}
            conv={conv}
            participants={participantsByConv.get(conv.conversation_id) || []}
            unreadCount={unreadByConv.get(conv.conversation_id) || 0}
            currentUserId={userId}
            onOpen={() => setOpenConversationId(conv.conversation_id)}
            onMenu={(x, y) => setRowMenu({ convId: conv.conversation_id, x, y })}
          />
        ))}
      </div>

      {rowMenu && (() => {
        const isGroup = !isDmConversation(participantsByConv.get(rowMenu.convId));
        return (
          <ConversationRowMenu
            x={rowMenu.x} y={rowMenu.y}
            isGroup={isGroup}
            onPick={() => { const id = rowMenu.convId; setRowMenu(null); handleHideRow(id); }}
            onClose={() => setRowMenu(null)}
          />
        );
      })()}

      {composeAnchor && (
        <NewConversationPicker
          workspaceId={workspaceId}
          currentUserId={userId}
          anchor={composeAnchor}
          suggestedUserIds={suggestedUserIds}
          onCreated={(convId) => { setComposeAnchor(null); handleConversationCreated(convId); }}
          onClose={() => setComposeAnchor(null)}
        />
      )}
    </div>
  );
}

function ConversationRow({ card = false, conv, participants, unreadCount, currentUserId, onOpen, onMenu }) {
  const isUnread = unreadCount > 0;
  const peers = participants.filter(p => p.user_id !== currentUserId && !p.left_at);
  const isDm = isDmConversation(participants); // rows, not active members (COMMS-17)

  // Title: explicit title > participant names > fallback.
  const peerProfiles = peers.map(p => ({
    id: p.user_id,
    name: userProfiles.get(p.user_id)?.name
       || userProfiles.get(p.user_id)?.email
       || 'Member',
    color: userProfiles.get(p.user_id)?.color || pickPresenceColor(p.user_id || ''),
  }));
  const title = conv.title || peerProfiles.map(p => p.name).join(', ') || 'New conversation';

  // Avatar: 1 peer = single circle. Multi = stacked 2-3.
  const avatarPeers = peerProfiles.slice(0, 3);

  // Last-message preview: prefix with sender for group chats.
  let preview = conv.last_message_body || '';
  if (conv.last_message_kind === 'system') {
    preview = preview || '— event —';
  } else if (!isDm && conv.last_message_sender_id && conv.last_message_sender_id !== currentUserId) {
    const senderName =
      userProfiles.get(conv.last_message_sender_id)?.name
      || conv.last_message_sender_email
      || 'Member';
    preview = `${senderName.split(' ')[0]}: ${preview}`;
  } else if (conv.last_message_sender_id === currentUserId && preview) {
    preview = `You: ${preview}`;
  }

  return (
    <button
      className={`msg-row ${isUnread ? 'is-unread' : ''}${card ? ' is-card' : ''}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        // Keyboard context-menu key: no pointer position, so anchor on the row.
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX || r.left + 24;
        const y = e.clientY || r.bottom;
        onMenu(x, y);
      }}
      title={title}
    >
      {/* The card look: no gold dot, the time on the name's line and the
          count, a quiet pill, on the preview's (messagesCard.css). */}
      {isUnread && !card && <span className="msg-row-dot" />}
      <span className={`msg-row-avatar ${avatarPeers.length > 1 ? 'is-stack' : ''}`}>
        {avatarPeers.length === 0 ? '·' : avatarPeers.map((p) => (
          <span
            key={p.id}
            className="msg-row-avatar-chip"
            style={{ background: p.color }}
          >
            {(p.name || 'M').charAt(0).toUpperCase()}
          </span>
        ))}
      </span>
      {card ? (
        <span className="msg-row-text">
          <span className="msg-row-line">
            <span className="msg-row-name">{title}</span>
            <span className="msg-row-time t-meta">{relTime(conv.last_message_at)}</span>
          </span>
          <span className="msg-row-line">
            <span className="msg-row-preview">{preview.slice(0, 80)}</span>
            {isUnread && <span className="msg-row-count" aria-label={`${unreadCount} unread`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </span>
        </span>
      ) : (
        <>
          <span className="msg-row-text">
            <span className="msg-row-name">{title}</span>
            {preview && (
              <span className="msg-row-preview">{preview.slice(0, 60)}</span>
            )}
          </span>
          {isUnread
            ? <span className="msg-row-count">{unreadCount > 99 ? '99+' : unreadCount}</span>
            : <span className="msg-row-time t-meta">{relTime(conv.last_message_at)}</span>}
        </>
      )}
    </button>
  );
}

// The row's right-click / long-press menu: Hide (a DM) or Leave (a group).
function ConversationRowMenu({ x, y, isGroup, onPick, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: y, left: x });
  useLayoutEffect(() => {
    const el = popRef.current;
    const w = el?.offsetWidth || 180, h = el?.offsetHeight || 40;
    setPos({
      top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
      left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    // Claim Escape so the panel underneath stays open.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  useEffect(() => { popRef.current?.querySelector('button:not(:disabled)')?.focus(); }, []);
  return createPortal((
    <div ref={popRef} className="msg-group-menu" role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
      {isGroup ? (
        <button type="button" role="menuitem" className="msg-group-menu-item is-danger" onClick={onPick}>
          <Icon as={LogOut} size={12} /> Leave…
        </button>
      ) : (
        <button type="button" role="menuitem" className="msg-group-menu-item" onClick={onPick}>
          <Icon as={EyeOff} size={12} /> Hide conversation
        </button>
      )}
    </div>
  ), document.body);
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
