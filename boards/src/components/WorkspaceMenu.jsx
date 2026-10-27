// Workspace switcher popover. Replaces the old 40px rail of icon
// buttons with a richer dropdown that shows full names + ownership
// subtitles + member dots, grouped into "Mine" and "Shared with you".
//
// Positioned absolutely below its trigger; consumer is expected to
// render it inside a `position: relative` container. Click-outside +
// Escape close it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, MoreHorizontal, LogOut, Trash2, Edit, Check, Share2, Lock, Users, ChevronRight } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { R2Image } from './R2Image.jsx';
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
  onSelect,
  onAddNew,
  onRemove,             // (ws, action: 'delete' | 'leave') => void
  onOpenSettings,       // (ws) => void   — owner / co-owner; opens Settings → General,
                        //                  where the name sits beside the icon
  onShare,              // (ws) => void   — owner / co-owner; opens the Share panel
                        //                  set to invite people to the WHOLE workspace
  onClose,
  // The button that opens THIS menu. A click on it is the trigger's own toggle,
  // not an outside click — closing here first would let the toggle reopen it.
  // The sidebar's is the default; Home passes its own.
  triggerSelector = '.sb-ws-trigger',
  // The admin preview's test team (Settings › Preview): null, or { name,
  // workspaces: [{ id, name, letter, color, private }], manage, viewOnly,
  // onOpenPage, onPickWorkspace } (a real team also gives ids: left out of
  // YOURS / SHARED, and activeId: the current workspace). Its section sits above YOURS, is not part
  // of the filter, and is hidden while the filter has text.
  team = null,
}) {
  const ref = useRef(null);
  const [filter, setFilter] = useState('');
  // Per-row mini-menu state — only one open at a time. Stores the
  // workspace id whose ⋯ button was clicked.
  const [openMenuId, setOpenMenuId] = useState(null);
  // Close on outside click + Escape. Capture-phase mousedown so we beat
  // any handlers that might re-focus or repaint inside the menu.
  // Important: ignore clicks on the trigger button itself — its own
  // onClick toggles the open state, and if we close here first the
  // trigger immediately re-opens.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      if (triggerSelector && e.target.closest?.(triggerSelector)) return;
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
  }, [onClose, triggerSelector]);

  const list = workspaces || [];
  const showFilter = list.length > FILTER_THRESHOLD;
  const q = filter.trim().toLowerCase();
  const matches = (w) => !q || (w.name || '').toLowerCase().includes(q);
  // A real team's workspaces show once, in the team section, while not filtering.
  const teamIds = !q && team?.ids ? new Set(team.ids) : null;
  const inTeam = (w) => !!teamIds && teamIds.has(w.id);
  const mine = useMemo(() => list
    .filter(w => w.created_by === selfUserId && matches(w) && !inTeam(w))
    .sort((a, b) => {
      if (a.id === personalWorkspaceId) return -1;
      if (b.id === personalWorkspaceId) return 1;
      return (a.created_at || '').localeCompare(b.created_at || '');
    }), [list, selfUserId, personalWorkspaceId, q, team?.ids]);
  const shared = useMemo(() => list
    .filter(w => w.created_by !== selfUserId && matches(w) && !inTeam(w))
    .sort((a, b) => (a._joinedAt || '').localeCompare(b._joinedAt || '')), [list, selfUserId, q, team?.ids]);
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
    // 0391: a co-owner runs the workspace (people, sharing, name, icon) but
    // can't delete it, so their remove action stays "Leave".
    const isCoowner = !isOwner && w._myRole === 'coowner';
    const canManage = isOwner || isCoowner;
    const subtitle = isPersonal ? 'Personal'
                  : isOwner    ? 'You own this'
                  : isCoowner  ? 'You co-own this'
                  :              'Shared with you';
    const initial = (w.name || '?').trim().charAt(0).toUpperCase() || '?';
    const tint = pickPresenceColor(w.id);
    const iconSrc = w.settings?.icon_url || '';
    // Personal workspace is the user's home — not removable. Owners
    // see "Delete workspace" (destroys it for everyone); shared
    // members see "Leave workspace" (removes their own membership).
    const canRemove = !!onRemove && !isPersonal;
    const canRename = !!onOpenSettings && canManage;
    const canShare = !!onShare && canManage;
    const removeAction = isOwner ? 'delete' : 'leave';
    const isMenuOpen = openMenuId === w.id;
    const hasRowMenu = canRemove || canRename || canShare;
    return (
      <div key={w.id} className={`ws-menu-row-wrap ${hasRowMenu ? 'has-menu' : ''}`}
           // Right-click a workspace → the same menu its ⋯ opens, instead of
           // the browser's.
           onContextMenu={hasRowMenu ? (e) => { e.preventDefault(); setOpenMenuId(w.id); } : undefined}>
        <button className={`ws-menu-row ${isActive ? 'is-active' : ''}`}
                onClick={() => { onSelect?.(w.id); onClose?.(); }}>
          {iconSrc
            ? <span className="ws-menu-avatar ws-menu-avatar-img"><R2Image src={iconSrc} alt="" /></span>
            : <span className="ws-menu-avatar" style={{ background: tint }}>{initial}</span>}
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
                {canShare && (
                  <button className="ws-menu-row-pop-item"
                          onClick={() => {
                            setOpenMenuId(null);
                            onShare?.(w);
                            onClose?.();
                          }}>
                    <Icon as={Share2} size={12} />
                    <span>Share workspace…</span>
                  </button>
                )}
                {canRename && (
                  <button className="ws-menu-row-pop-item"
                          onClick={() => {
                            setOpenMenuId(null);
                            onOpenSettings?.(w);
                          }}>
                    <Icon as={Edit} size={12} />
                    <span>Rename &amp; icon…</span>
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
        {team && !q && (
          <>
            <div className="ws-menu-section">{team.name.toUpperCase()}<span className="ws-menu-tag">TEAM</span></div>
            {team.workspaces.map((w) => (
              <button key={w.id} type="button"
                      className={`ws-menu-row ${team.activeId && w.id === team.activeId ? 'is-active' : ''}`}
                      onClick={() => { team.onPickWorkspace?.(w); onClose?.(); }}>
                <span className="ws-menu-avatar" style={{ background: w.color }}>{w.letter}</span>
                <span className="ws-menu-text">
                  <span className="ws-menu-name">{w.name}</span>
                  <span className="ws-menu-sub">
                    {team.viewOnly ? 'Team · view-only' : w.private ? 'Team · private' : 'Team'}
                  </span>
                </span>
                {w.private && (
                  <span className="ws-menu-tail"><Icon as={Lock} size={13} weight="regular" /></span>
                )}
                {team.activeId && w.id === team.activeId && (
                  <span className="ws-menu-check"><Icon as={Check} size={14} /></span>
                )}
              </button>
            ))}
            <button type="button" className="ws-menu-row"
                    onClick={() => { team.onOpenPage?.(); onClose?.(); }}>
              <span className="ws-menu-avatar is-icon"><Icon as={Users} size={14} weight="regular" /></span>
              <span className="ws-menu-text">
                <span className="ws-menu-name">Team page</span>
                <span className="ws-menu-sub">{team.manage ? 'People, seats and billing' : 'Who’s on the team'}</span>
              </span>
              <span className="ws-menu-tail"><Icon as={ChevronRight} size={12} weight="regular" /></span>
            </button>
          </>
        )}
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
