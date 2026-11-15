// Workspace-level presence stack for the topbar.
// Shows everyone currently in the workspace as a clickable avatar; click
// teleports the local user to that peer's current board. Includes a small
// status dot reflecting the workspace realtime channel state.
//
// Right-click an avatar → popover listing the peer's recent comments
// across the workspace. Useful "what's <person> been weighing in on?"
// audit, scoped by RLS to boards the local user can read. Under a finger a
// hold opens the same popover (iOS never fires contextmenu for a touch).

import { useEffect, useRef, useState } from 'react';
import { listCommentsByAuthor } from '../lib/commentsApi.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { useOpenDm } from '../hooks/useOpenDm.js';
import { useLongPress } from '../hooks/useLongPress.js';
import { useBackLayer, fingerIsPointer } from '../hooks/useBackLayer.js';
import { swallowNextClick } from '../lib/swallowClick.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { initialOf } from '../lib/graphemes.js';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { shownError } from '../lib/errorWords.js';

const STATUS_LABEL = {
  get connecting() { return t`Connecting…`; },
  get connected() { return t`Live`; },
  get error() { return t`Reconnecting…`; },
  get disconnected() { return t`Offline`; },
};

export function WorkspacePresenceStack({ peers, status, selfId, onJumpTo, workspaceId, max = 4 }) {
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
  const visible = list.slice(0, max);
  const overflow = list.length - visible.length;

  // A hold on an avatar: the recent-comments popover a right-click opens. The
  // click the lift leaves behind is swallowed, so it doesn't also jump to them.
  const stackRef = useRef(null);
  useLongPress(stackRef, (x, y, e) => {
    const btn = e.target?.closest?.('button.ws-presence-avatar');
    const peer = btn && visible.find(p => String(p.key) === btn.dataset.peerKey);
    if (!peer) return false;
    swallowNextClick({ held: true });
    setAuditPeer({ peer, anchorRect: btn.getBoundingClientRect() });
    return true;
  }, { ms: 480, tolerance: 8, pointerType: 'touch' });
  const touch = fingerIsPointer();

  const dotClass = status === 'connected' ? 'on'
                 : status === 'error' || status === 'disconnected' ? 'off'
                 : 'pending';

  return (
    <div className="ws-presence" ref={stackRef} aria-label={plural(list.length, { one: '# person online', other: '# people online' })}>
      <span className={`ws-presence-status ${dotClass}`} title={STATUS_LABEL[status] || status} />
      {visible.map(p => {
        const initial = initialOf(p.user.name || p.user.email);
        const inactive = p.location?.isActive === false;
        const who = p.user.name || p.user.email;
        const baseLabel = p.location?.boardName
          ? t`${who} · in ${ph({ boardName: p.location.boardName })}`
          : `${who}`;
        const where = inactive ? t`${baseLabel} · (away)` : baseLabel;
        return (
          <button key={p.key}
                  className={`ws-presence-avatar${inactive ? ' is-inactive' : ''}`}
                  data-peer-key={p.key}
                  style={{ background: p.user.color || '#4f8df8' }}
                  onClick={() => onJumpTo?.(p.location)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAuditPeer({ peer: p, anchorRect: rect });
                  }}
                  title={touch
                    ? t`${where} · tap to jump · hold for recent comments`
                    : t`${where} · click to jump · right-click for recent comments`}>
            {initial}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="ws-presence-avatar ws-presence-overflow" title={t`+${overflow} more`}>
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
  // On touch, the phone's Back closes the popover before anything navigates.
  useBackLayer(true, onClose);

  useEffect(() => {
    if (!workspaceId || !peer?.user?.id) return;
    let cancelled = false;
    listCommentsByAuthor({ workspaceId, authorId: peer.user.id, limit: 30 })
      .then(data => { if (!cancelled) setRows(data); })
      .catch(err => { if (!cancelled) setError(shownError(err)); });
    return () => { cancelled = true; };
  }, [workspaceId, peer?.user?.id]);

  // Close on outside click + Escape.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') onClose?.(); };
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
        <span className="ws-presence-audit-sub"><Trans>recent comments</Trans></span>
        {openDm && peer?.user?.id && (
          <button
            className="ws-presence-audit-dm"
            onClick={() => { openDm(peer.user.id); onClose?.(); }}
            title={t`Send a direct message`}
          >
            <Trans context="verb">Message</Trans>
          </button>
        )}
      </div>
      <div className="ws-presence-audit-body">
        {error && <div className="ws-presence-audit-empty"><Trans>Couldn't load comments.</Trans></div>}
        {!error && rows == null && <div className="ws-presence-audit-empty"><Trans>Loading…</Trans></div>}
        {!error && rows && rows.length === 0 && (
          <div className="ws-presence-audit-empty"><Trans>No comments yet.</Trans></div>
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
              {r.resolved && <span className="ws-presence-audit-tag"><Trans>resolved</Trans></span>}
              {r.hidden && <span className="ws-presence-audit-tag is-muted"><Trans>hidden</Trans></span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
