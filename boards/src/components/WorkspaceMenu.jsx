// Workspace switcher popover. Replaces the old 40px rail of icon
// buttons with a richer dropdown that shows full names + ownership
// subtitles + member dots, grouped into "Mine" and "Shared with you".
//
// Positioned absolutely below its trigger; consumer is expected to
// render it inside a `position: relative` container. Click-outside +
// Escape close it.

import { useEffect, useRef } from 'react';
import { Plus } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { pickPresenceColor } from '../lib/presenceColor.js';

export function WorkspaceMenu({
  workspaces,
  activeWorkspaceId,
  personalWorkspaceId,
  selfUserId,
  wsPeers = [],
  onSelect,
  onAddNew,
  onClose,
}) {
  const ref = useRef(null);
  // Close on outside click + Escape. Capture-phase mousedown so we beat
  // any handlers that might re-focus or repaint inside the menu.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const list = workspaces || [];
  const mine = list
    .filter(w => w.created_by === selfUserId)
    .sort((a, b) => {
      if (a.id === personalWorkspaceId) return -1;
      if (b.id === personalWorkspaceId) return 1;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
  const shared = list
    .filter(w => w.created_by !== selfUserId)
    .sort((a, b) => (a._joinedAt || '').localeCompare(b._joinedAt || ''));

  // Map online users by id so each workspace row can render a small
  // green-ringed dot for any member who's currently in the workspace.
  // wsPeers is scoped to the active workspace, so this only "lights up"
  // the active row's online members — good enough as a "live" hint.
  const peerById = new Map((wsPeers || []).map(p => [p?.user?.id, p]));

  const renderRow = (w) => {
    const isActive = w.id === activeWorkspaceId;
    const isPersonal = w.id === personalWorkspaceId;
    const isOwner = w.created_by === selfUserId;
    const subtitle = isPersonal ? 'Personal'
                  : isOwner    ? 'You own this'
                  :              'Shared with you';
    const initial = (w.name || '?').trim().charAt(0).toUpperCase() || '?';
    const tint = pickPresenceColor(w.id);
    return (
      <button key={w.id}
              className={`ws-menu-row ${isActive ? 'is-active' : ''}`}
              onClick={() => { onSelect?.(w.id); onClose?.(); }}>
        <span className="ws-menu-avatar" style={{ background: tint }}>{initial}</span>
        <span className="ws-menu-text">
          <span className="ws-menu-name">{w.name}</span>
          <span className="ws-menu-sub">{subtitle}</span>
        </span>
        {isActive && (
          <svg className="ws-menu-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7 L6 10 L11 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div ref={ref} className="ws-menu" role="menu" aria-label="Switch workspace">
      {mine.length > 0 && (
        <>
          <div className="ws-menu-section">YOURS</div>
          {mine.map(renderRow)}
        </>
      )}
      {shared.length > 0 && (
        <>
          <div className="ws-menu-section">SHARED WITH YOU</div>
          {shared.map(renderRow)}
        </>
      )}
      <div className="ws-menu-divider" />
      <button className="ws-menu-row ws-menu-add"
              onClick={() => { onAddNew?.(); onClose?.(); }}>
        <span className="ws-menu-avatar ws-menu-avatar-add">
          <Icon as={Plus} size={12} />
        </span>
        <span className="ws-menu-text">
          <span className="ws-menu-name">New workspace</span>
        </span>
      </button>
    </div>
  );
}
