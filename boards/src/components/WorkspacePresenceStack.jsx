// Workspace-level presence stack for the topbar.
// Shows everyone currently in the workspace as a clickable avatar; click
// teleports the local user to that peer's current board. Includes a small
// status dot reflecting the workspace realtime channel state.

import { useState } from 'react';

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected:  'Live',
  error:      'Reconnecting…',
  disconnected: 'Offline',
};

export function WorkspacePresenceStack({ peers, status, selfId, onJumpTo }) {
  const [hovered, setHovered] = useState(null);
  // Dedupe by user.id — a single user with two tabs collapses to one avatar
  // (we keep the most-recent location for the click target).
  const byUser = new Map();
  for (const p of peers || []) {
    if (!p.user || p.user.id === selfId) continue;
    const existing = byUser.get(p.user.id);
    if (!existing || (p.lastSeen || 0) > (existing.lastSeen || 0)) byUser.set(p.user.id, p);
  }
  const list = [...byUser.values()];
  const visible = list.slice(0, 4);
  const overflow = list.length - visible.length;

  const dotClass = status === 'connected' ? 'on'
                 : status === 'error' || status === 'disconnected' ? 'off'
                 : 'pending';

  return (
    <div className="ws-presence" aria-label={`${list.length} ${list.length === 1 ? 'person' : 'people'} online`}>
      <span className={`ws-presence-status ${dotClass}`} title={STATUS_LABEL[status] || status} />
      {visible.map(p => {
        const onSameBoard = p.location?.boardId && p.location.boardId === hovered;
        const initial = (p.user.name || p.user.email || '?')[0].toUpperCase();
        const where = p.location?.boardName
          ? `${p.user.name || p.user.email} · in ${p.location.boardName}`
          : `${p.user.name || p.user.email}`;
        return (
          <button key={p.key}
                  className="ws-presence-avatar"
                  style={{ background: p.user.color || '#4f8df8' }}
                  onClick={() => onJumpTo?.(p.location)}
                  title={`${where} · click to jump there`}>
            {initial}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="ws-presence-avatar ws-presence-overflow" title={`+${overflow} more`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}
