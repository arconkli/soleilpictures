import { useState, useEffect, useMemo, useCallback } from 'react';
import { Icon } from './Icon.jsx';
import { Plus, X } from '../lib/icons.js';
import { useConversationList } from '../hooks/useConversationList.js';
import { findOrCreateDm, leaveConversation } from '../lib/messages.js';
import { NewConversationPicker } from './NewConversationPicker.jsx';
import { MessageThread } from './MessageThread.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

// Right-drawer slot. Single unified conversation list (DMs + group
// chats interleaved by recency). Two modes: list, or thread (one open
// conversation).
//
//   workspaceId, currentUser
//   openConversationId, setOpenConversationId — controlled by App.jsx
//     so useInboxLive can suppress toasts for the active thread
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
  canSendMessages = true, // false → demo user on someone else's workspace
}) {
  const userId = currentUser?.id;
  const {
    conversations, participantsByConv, myStateByConv, unreadByConv, loaded,
  } = useConversationList({ workspaceId, userId, refreshTick });

  const [pendingJumpMessageId, setPendingJumpMessageId] = useState(jumpToMessageId || null);
  const [composeAnchor, setComposeAnchor] = useState(null);

  // First-mount permalink: open whatever the parent says is open.
  useEffect(() => {
    if (initialOpenConversationId) {
      setOpenConversationId(initialOpenConversationId);
      setPendingJumpMessageId(jumpToMessageId || null);
    }
  }, [initialOpenConversationId, jumpToMessageId, setOpenConversationId]);

  // Avatar-click DM open: find/create a DM with the requested peer
  // and open the thread.
  useEffect(() => {
    if (!pendingOpenPeerId || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const convId = await findOrCreateDm({ workspaceId, peerId: pendingOpenPeerId });
        if (cancelled || !convId) return;
        setOpenConversationId(convId);
        onRefreshRequested?.();
      } catch (e) { console.warn('[MessagesPanel] open peer failed', e); }
      finally { onPeerConsumed?.(); }
    })();
    return () => { cancelled = true; };
  }, [pendingOpenPeerId, workspaceId, onPeerConsumed, onRefreshRequested]);

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

  // Filter out conversations the current user has left.
  const visibleConversations = useMemo(() => {
    return (conversations || []).filter(c => {
      const me = myStateByConv.get(c.conversation_id);
      // If we're not a participant (shouldn't happen via RLS, but safety) — hide.
      if (!me) return false;
      if (me.left_at) return false;
      return true;
    });
  }, [conversations, myStateByConv]);

  const handleConversationCreated = useCallback((convId) => {
    setOpenConversationId(convId);
    onRefreshRequested?.();
  }, [onRefreshRequested]);

  const handleHideRow = useCallback(async (convId) => {
    if (!userId || !convId) return;
    await leaveConversation({ conversationId: convId, userId });
    onRefreshRequested?.();
  }, [userId, onRefreshRequested]);

  if (openConversationId) {
    const conv = conversations.find(c => c.conversation_id === openConversationId);
    const parts = participantsByConv.get(openConversationId) || [];
    return (
      <MessageThread
        workspaceId={workspaceId}
        currentUser={currentUser}
        canSend={canSendMessages}
        conversation={{
          id: openConversationId,
          title: conv?.title || null,
          participants: parts,
        }}
        jumpToMessageId={pendingJumpMessageId}
        onChanged={onRefreshRequested}
        onBack={() => {
          setOpenConversationId(null);
          setPendingJumpMessageId(null);
          onPermalinkConsumed?.();
        }}
        onClose={() => { onPermalinkConsumed?.(); onClose?.(); }}
      />
    );
  }

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <div className="msg-panel-title">
          <div className="t-eyebrow msg-panel-eyebrow">MESSAGES</div>
          <div className="msg-panel-name">All conversations</div>
        </div>
        <button
          className="msg-panel-icon"
          onClick={(e) => setComposeAnchor(e.currentTarget.getBoundingClientRect())}
          title={canSendMessages ? 'New chat' : 'Upgrade to start chats in shared workspaces'}
          aria-label="New chat"
          disabled={!canSendMessages}
        >
          <Icon as={Plus} size={14} />
        </button>
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
      </div>

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
        {loaded && visibleConversations.length === 0 && (
          <div className="msg-empty t-meta">
            No conversations yet. Click <span className="msg-empty-plus"><Icon as={Plus} size={11} /></span> to start one.
          </div>
        )}
        {visibleConversations.map(conv => (
          <ConversationRow
            key={conv.conversation_id}
            conv={conv}
            participants={participantsByConv.get(conv.conversation_id) || []}
            unreadCount={unreadByConv.get(conv.conversation_id) || 0}
            currentUserId={userId}
            onOpen={() => setOpenConversationId(conv.conversation_id)}
            onHide={() => handleHideRow(conv.conversation_id)}
          />
        ))}
      </div>

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

function ConversationRow({ conv, participants, unreadCount, currentUserId, onOpen, onHide }) {
  const isUnread = unreadCount > 0;
  const peers = participants.filter(p => p.user_id !== currentUserId && !p.left_at);
  const isDm = participants.filter(p => !p.left_at).length === 2;

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
      className={`msg-row ${isUnread ? 'is-unread' : ''}`}
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onHide(); }}
      title={title}
    >
      {isUnread && <span className="msg-row-dot" />}
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
      <span className="msg-row-text">
        <span className="msg-row-name">{title}</span>
        {preview && (
          <span className="msg-row-preview">{preview.slice(0, 60)}</span>
        )}
      </span>
      {isUnread
        ? <span className="msg-row-count">{unreadCount > 99 ? '99+' : unreadCount}</span>
        : <span className="msg-row-time t-meta">{relTime(conv.last_message_at)}</span>}
    </button>
  );
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
