// Workspace switcher popover. Replaces the old 40px rail of icon
// buttons with a richer dropdown that shows full names + ownership
// subtitles + member dots, grouped into "Mine" and "Shared with you".
//
// Positioned absolutely below its trigger; consumer is expected to
// render it inside a `position: relative` container. Click-outside +
// Escape close it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, MoreHorizontal, LogOut, Trash2, Edit, Check } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { pickPresenceColor } from '../lib/presenceColor.js';

// Show the filter input once we have more workspaces than this — on
// small lists it's just visual clutter.
const FILTER_THRESHOLD = 6;

export function WorkspaceMenu({
  workspaces,
  activeWorkspaceId,
  personalWorkspaceId,
  selfUserId,
  wsPeers = [],
  autoExpandMenuId = null, // pre-open the row-pop for this workspace id
  onSelect,
  onAddNew,
  onRemove,             // (ws, action: 'delete' | 'leave') => void
  onRename,             // (ws) => void   — owners only; opens a rename prompt
  onClose,
}) {
  const ref = useRef(null);
  const [filter, setFilter] = useState('');
  // Per-row mini-menu state — only one open at a time. Stores the
  // workspace id whose ⋯ button was clicked. Initialized from
  // autoExpandMenuId so right-click-on-trigger lands directly on
  // the active row's Rename / Delete actions.
  const [openMenuId, setOpenMenuId] = useState(autoExpandMenuId);
  // Close on outside click + Escape. Capture-phase mousedown so we beat
  // any handlers that might re-focus or repaint inside the menu.
  // Important: ignore clicks on the trigger button itself — its own
  // onClick toggles the open state, and if we close here first the
  // trigger immediately re-opens.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      if (e.target.closest?.('.sb-ws-trigger')) return;
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
  const showFilter = list.length > FILTER_THRESHOLD;
  const q = filter.trim().toLowerCase();
  const matches = (w) => !q || (w.name || '').toLowerCase().includes(q);
  const mine = useMemo(() => list
    .filter(w => w.created_by === selfUserId && matches(w))
    .sort((a, b) => {
      if (a.id === personalWorkspaceId) return -1;
      if (b.id === personalWorkspaceId) return 1;
      return (a.created_at || '').localeCompare(b.created_at || '');
    }), [list, selfUserId, personalWorkspaceId, q]);
  const shared = useMemo(() => list
    .filter(w => w.created_by !== selfUserId && matches(w))
    .sort((a, b) => (a._joinedAt || '').localeCompare(b._joinedAt || '')), [list, selfUserId, q]);
  const noResults = q && mine.length === 0 && shared.length === 0;

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
    // Personal workspace is the user's home — not removable. Owners
    // see "Delete workspace" (destroys it for everyone); shared
    // members see "Leave workspace" (removes their own membership).
    const canRemove = !!onRemove && !isPersonal;
    const canRename = !!onRename && isOwner;
    const removeAction = isOwner ? 'delete' : 'leave';
    const isMenuOpen = openMenuId === w.id;
    const hasRowMenu = canRemove || canRename;
    return (
      <div key={w.id} className={`ws-menu-row-wrap ${hasRowMenu ? 'has-menu' : ''}`}>
        <button className={`ws-menu-row ${isActive ? 'is-active' : ''}`}
                onClick={() => { onSelect?.(w.id); onClose?.(); }}>
          <span className="ws-menu-avatar" style={{ background: tint }}>{initial}</span>
          <span className="ws-menu-text">
            <span className="ws-menu-name">{w.name}</span>
            <span className="ws-menu-sub">{subtitle}</span>
          </span>
          {isActive && (
            <span className="ws-menu-check"><Icon as={Check} size={14} /></span>
          )}
        </button>
        {hasRowMenu && (
          <>
            <button className={`ws-menu-row-more ${isMenuOpen ? 'is-open' : ''}`}
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : w.id);
                    }}>
              <Icon as={MoreHorizontal} size={14} />
            </button>
            {isMenuOpen && (
              <div className="ws-menu-row-pop" role="menu"
                   onClick={(e) => e.stopPropagation()}>
                {canRename && (
                  <button className="ws-menu-row-pop-item"
                          onClick={() => {
                            setOpenMenuId(null);
                            onRename?.(w);
                          }}>
                    <Icon as={Edit} size={12} />
                    <span>Rename workspace</span>
                  </button>
                )}
                {canRemove && (
                  <button className="ws-menu-row-pop-item danger"
                          onClick={() => {
                            setOpenMenuId(null);
                            onRemove?.(w, removeAction);
                          }}>
                    <Icon as={removeAction === 'delete' ? Trash2 : LogOut} size={12} />
                    <span>{removeAction === 'delete' ? 'Delete workspace' : 'Leave workspace'}</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div ref={ref} className="ws-menu" role="menu" aria-label="Switch workspace">
      {showFilter && (
        <div className="ws-menu-filter">
          <Icon as={Search} size={12} />
          <input autoFocus
                 type="text"
                 placeholder="Filter workspaces…"
                 value={filter}
                 onChange={(e) => setFilter(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } }} />
        </div>
      )}
      <div className="ws-menu-scroll">
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
        {noResults && (
          <div className="ws-menu-empty">No workspaces match "{filter}"</div>
        )}
      </div>
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
