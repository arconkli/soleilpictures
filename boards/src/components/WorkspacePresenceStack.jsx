// Workspace-level presence stack for the topbar.
// Shows everyone currently in the workspace as a clickable avatar; click
// teleports the local user to that peer's current board. Includes a small
// status dot reflecting the workspace realtime channel state.
//
// Right-click an avatar → popover listing the peer's recent comments
// across the workspace. Useful "what's <person> been weighing in on?"
// audit, scoped by RLS to boards the local user can read.

import { useEffect, useRef, useState } from 'react';
import { listCommentsByAuthor } from '../lib/commentsApi.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { useOpenDm } from '../hooks/useOpenDm.js';

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected:  'Live',
  error:      'Reconnecting…',
  disconnected: 'Offline',
};

export function WorkspacePresenceStack({ peers, status, selfId, onJumpTo, workspaceId }) {
  const [hovered, setHovered] = useState(null);
  const [auditPeer, setAuditPeer] = useState(null);   // { peer, anchorRect }
  // Dedupe by user.id — a single user with two tabs collapses to one avatar.
  // Prefer the tab that's foregrounded (isActive) so click-to-jump goes to
  // the board they're actually viewing, not a random background tab. Fall
  // back to most-recent lastSeen when nothing's active. `isActive === false`
  // means "explicitly backgrounded"; undefined (older bundle) is treated as
  // active for back-compat.
  const isActive = (p) => p?.location?.isActive !== false;
  const byUser = new Map();
  for (const p of peers || []) {
    if (!p.user || p.user.id === selfId) continue;
    const existing = byUser.get(p.user.id);
    if (!existing) { byUser.set(p.user.id, p); continue; }
    const pActive = isActive(p);
    const eActive = isActive(existing);
    if (pActive && !eActive) { byUser.set(p.user.id, p); continue; }
    if (eActive && !pActive) continue;
    if ((p.lastSeen || 0) > (existing.lastSeen || 0)) byUser.set(p.user.id, p);
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
        const initial = (p.user.name || p.user.email || '?')[0].toUpperCase();
        const inactive = p.location?.isActive === false;
        const baseLabel = p.location?.boardName
          ? `${p.user.name || p.user.email} · in ${p.location.boardName}`
          : `${p.user.name || p.user.email}`;
        const where = inactive ? `${baseLabel} · (away)` : baseLabel;
        return (
          <button key={p.key}
                  className={`ws-presence-avatar${inactive ? ' is-inactive' : ''}`}
                  style={{ background: p.user.color || '#4f8df8' }}
                  onClick={() => onJumpTo?.(p.location)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAuditPeer({ peer: p, anchorRect: rect });
                  }}
                  title={`${where} · click to jump · right-click for recent comments`}>
            {initial}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="ws-presence-avatar ws-presence-overflow" title={`+${overflow} more`}>
          +{overflow}
        </span>
      )}
      {auditPeer && (
        <PeerCommentsAudit peer={auditPeer.peer}
                           anchorRect={auditPeer.anchorRect}
                           workspaceId={workspaceId}
                           onClose={() => setAuditPeer(null)}
                           onJumpTo={onJumpTo} />
      )}
    </div>
  );
}

function PeerCommentsAudit({ peer, anchorRect, workspaceId, onClose, onJumpTo }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const openDm = useOpenDm();

  useEffect(() => {
    if (!workspaceId || !peer?.user?.id) return;
    let cancelled = false;
    listCommentsByAuthor({ workspaceId, authorId: peer.user.id, limit: 30 })
      .then(data => { if (!cancelled) setRows(data); })
      .catch(err => { if (!cancelled) setError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [workspaceId, peer?.user?.id]);

  // Close on outside click + Escape.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      onClose?.();
    };
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

  const top = Math.min(window.innerHeight - 360, anchorRect.bottom + 6);
  const left = Math.max(8, Math.min(window.innerWidth - 320, anchorRect.left));

  return (
    <div ref={ref} className="ws-presence-audit"
         style={{ position: 'fixed', top, left, width: 304 }}
         role="dialog">
      <div className="ws-presence-audit-head">
        <span className="ws-presence-audit-name">
          {peer.user.name || peer.user.email}
        </span>
        <span className="ws-presence-audit-sub">recent comments</span>
        {openDm && peer?.user?.id && (
          <button
            className="ws-presence-audit-dm"
            onClick={() => { openDm(peer.user.id); onClose?.(); }}
            title="Send a direct message"
          >
            Message
          </button>
        )}
      </div>
      <div className="ws-presence-audit-body">
        {error && <div className="ws-presence-audit-empty">Couldn't load comments.</div>}
        {!error && rows == null && <div className="ws-presence-audit-empty">Loading…</div>}
        {!error && rows && rows.length === 0 && (
          <div className="ws-presence-audit-empty">No comments yet.</div>
        )}
        {!error && rows && rows.length > 0 && rows.map(r => (
          <button key={r.id}
                  className="ws-presence-audit-row"
                  onClick={() => {
                    onClose?.();
                    onJumpTo?.({ boardId: r.board_id });
                  }}>
            <div className="ws-presence-audit-row-body">{r.body}</div>
            <div className="ws-presence-audit-row-meta">
              {relativeTimeShort(r.created_at)}
              {r.resolved && <span className="ws-presence-audit-tag">resolved</span>}
              {r.hidden && <span className="ws-presence-audit-tag is-muted">hidden</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
