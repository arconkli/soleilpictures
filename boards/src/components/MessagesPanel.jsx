import { useState, useMemo, useEffect } from 'react';
import { Icon } from './Icon.jsx';
import { Plus, MessageSquare, X } from '../lib/icons.js';
import { useChannelList } from '../hooks/useChannelList.js';
import { hideRow } from '../lib/messages.js';
import { NewDMPicker } from './NewDMPicker.jsx';
import { MessageThread } from './MessageThread.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

// Right-drawer slot. Two modes: list (BOARDS + DIRECT) or thread (one open
// conversation). The currently-open board is pinned at the bottom of BOARDS
// even if it has no messages yet (option-C "currently-open pin").
export function MessagesPanel({ workspaceId, currentUser, currentBoard, refreshTick, onClose }) {
  const userId = currentUser?.id;
  const { boardChannels, dmThreads, unreadByKey, hidden } = useChannelList({ workspaceId, userId, refreshTick });
  const [openThread, setOpenThread] = useState(null);
  const [newDmAnchor, setNewDmAnchor] = useState(null);
  // Subscribe to userProfiles so unresolved peer names re-render when
  // the batched users_by_ids RPC returns. Pre-warm the cache for
  // every DM peer so first paint already has names.
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);
  useEffect(() => {
    for (const t of (dmThreads || [])) {
      const peerId = t.user_a === userId ? t.user_b : t.user_a;
      if (peerId) userProfiles.resolve(peerId);
    }
  }, [dmThreads, userId]);

  const visibleBoardChannels = useMemo(() => {
    const seenIds = new Set();
    const list = [];
    for (const ch of boardChannels) {
      if (hidden.has(`b:${ch.board_id}`)) continue;
      seenIds.add(ch.board_id);
      list.push(ch);
    }
    return { active: list, currentPin: currentBoard && !seenIds.has(currentBoard.id) ? currentBoard : null };
  }, [boardChannels, hidden, currentBoard]);

  if (openThread) {
    return (
      <MessageThread
        workspaceId={workspaceId}
        currentUser={currentUser}
        thread={openThread}
        onBack={() => setOpenThread(null)}
        onClose={onClose}
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
        <button className="msg-panel-icon" onClick={onClose} title="Close (Esc)" aria-label="Close messages">
          <Icon as={X} size={14} />
        </button>
      </div>

      <div className="msg-panel-body">
        <div className="msg-section">
          <div className="msg-section-head">
            <span className="t-eyebrow">DIRECT</span>
            <button className="msg-section-add"
                    onClick={(e) => setNewDmAnchor(e.currentTarget.getBoundingClientRect())}
                    title="New message">
              <Icon as={Plus} size={14} />
            </button>
          </div>
          {dmThreads.filter(t => !hidden.has(`d:${t.user_a === userId ? t.user_b : t.user_a}`)).map(t => {
            const peerId = t.user_a === userId ? t.user_b : t.user_a;
            const isUnread = unreadByKey.get(`d:${peerId}`) > 0;
            const peer = userProfiles.get(peerId);
            const peerName = peer?.name || peer?.email || 'Member';
            const peerColor = peer?.color || pickPresenceColor(peerId || '');
            return (
              <button key={peerId}
                      className={`msg-row ${isUnread ? 'is-unread' : ''}`}
                      onClick={() => setOpenThread({ kind: 'dm', peerId, name: peerName })}
                      onContextMenu={(e) => { e.preventDefault(); hideRow({ userId, dmPeerId: peerId }); }}>
                {isUnread && <span className="msg-row-dot" />}
                <span className="msg-row-avatar" style={{ background: peerColor }}>
                  {peerName.charAt(0).toUpperCase()}
                </span>
                <span className="msg-row-text">
                  <span className="msg-row-name">{peerName}</span>
                  {t.last_message && (
                    <span className="msg-row-preview">{t.last_message.slice(0, 60)}</span>
                  )}
                </span>
                <span className="msg-row-time t-meta">{relTime(t.last_message_at)}</span>
              </button>
            );
          })}
          {dmThreads.length === 0 && (
            <div className="msg-empty t-meta">No direct messages yet.</div>
          )}
        </div>

        <div className="msg-section">
          <div className="msg-section-head">
            <span className="t-eyebrow">BOARDS</span>
          </div>
          {visibleBoardChannels.active.map(ch => {
            const isUnread = unreadByKey.get(`b:${ch.board_id}`) > 0;
            return (
              <button key={ch.board_id}
                      className={`msg-row ${isUnread ? 'is-unread' : ''}`}
                      onClick={() => setOpenThread({ kind: 'board', boardId: ch.board_id, name: ch.board_name })}
                      onContextMenu={(e) => { e.preventDefault(); hideRow({ userId, boardId: ch.board_id }); }}>
                {isUnread && <span className="msg-row-dot" />}
                <span className="msg-row-avatar msg-row-avatar-board">#</span>
                <span className="msg-row-text">
                  <span className="msg-row-name">{ch.board_name}</span>
                  {ch.last_message && (
                    <span className="msg-row-preview">{String(ch.last_message).slice(0, 60)}</span>
                  )}
                </span>
                <span className="msg-row-time t-meta">{relTime(ch.last_message_at)}</span>
              </button>
            );
          })}
          {visibleBoardChannels.currentPin && (
            <>
              <div className="msg-section-sub t-meta">— currently open</div>
              <button className="msg-row msg-row-pinned"
                      onClick={() => setOpenThread({ kind: 'board', boardId: visibleBoardChannels.currentPin.id, name: visibleBoardChannels.currentPin.name })}>
                <Icon as={MessageSquare} size={12} />
                <span className="msg-row-name">{visibleBoardChannels.currentPin.name}</span>
                <span className="msg-row-time t-meta">empty</span>
              </button>
            </>
          )}
        </div>
      </div>

      {newDmAnchor && (
        <NewDMPicker
          workspaceId={workspaceId}
          anchor={newDmAnchor}
          onPick={(u) => { setNewDmAnchor(null); setOpenThread({ kind: 'dm', peerId: u.id, name: u.name }); }}
          onClose={() => setNewDmAnchor(null)}
        />
      )}
    </div>
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
