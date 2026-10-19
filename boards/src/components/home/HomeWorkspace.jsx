// HomeWorkspace — the workspace, at the top left of Home (the files sidebar's
// Home, preview only). The owner, picking Home's look on 2026-10-19: "with the
// workspace title at the top left. there next to the workspace title you
// should be able to change its name, invite new people, switch workspaces,
// and create a new one". So: its name; a caret beside it that opens the same
// switcher the sidebar has (WorkspaceMenu, portalled and placed as the old
// Home placed it); and three words — Rename (in place: the name becomes a
// field), Invite (the Share window, set to the whole workspace) and New
// workspace. Rename and Invite are for its owner and co-owners, as the
// switcher's own row menu has them.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { R2Image } from '../R2Image.jsx';
import { Icon } from '../Icon.jsx';
import { ChevronDown } from '../../lib/icons.js';
import { WorkspaceMenu } from '../WorkspaceMenu.jsx';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { workspaceMenuPlacement } from '../../lib/projectsHome.js';

export function HomeWorkspace({
  workspace, workspaces, personalWorkspaceId, selfUserId, wsPeers,
  line = '',               // lib/homeMap workspaceLine: whose it is, its people, when it changed
  canManage = false,       // its owner or a co-owner (lib/workspaceRoles canManageWorkspace)
  onSwitch,                // (workspaceId)
  onNew,                   // ()
  onRemove,                // (ws, 'delete' | 'leave')
  onOpenSettings,          // (ws)
  onInvite,                // (ws) — the Share window, for the whole workspace
  onRename,                // (name) → Promise
}) {
  const [place, setPlace] = useState(null);   // the open switcher's position, or null
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(null);   // the new name, while it is saved
  // Escape cancels for good (the field's blur as it goes must not save it),
  // and Enter saves once (not again on that blur).
  const settledRef = useRef(false);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  const open = !!place;

  // The switcher follows its caret when the window changes size.
  useEffect(() => {
    if (!open) return undefined;
    const follow = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPlace((p) => (p ? workspaceMenuPlacement(rect, { width: window.innerWidth }) : p));
    };
    window.addEventListener('resize', follow);
    return () => window.removeEventListener('resize', follow);
  }, [open]);
  // Into the switcher when it opens (it is portalled to the end of <body>),
  // back to the caret when it closes from inside.
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop || pop.contains(document.activeElement)) return;
    (pop.querySelector('.ws-menu-row.is-active') || pop.querySelector('.ws-menu-row'))?.focus({ preventScroll: true });
  }, [open]);
  const closeMenu = () => {
    const inside = !!popRef.current?.contains(document.activeElement);
    setPlace(null);
    if (inside) triggerRef.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    if (open) { setPlace(null); return; }
    setRenaming(false);
    setPlace(workspaceMenuPlacement(triggerRef.current?.getBoundingClientRect(), { width: window.innerWidth }));
  };

  useEffect(() => { if (renaming) { settledRef.current = false; inputRef.current?.select(); } }, [renaming]);
  // Another workspace, another name: never carry a half-typed one across.
  useEffect(() => { setRenaming(false); setPlace(null); }, [workspace?.id]);

  if (!workspace) return null;
  const saved = (workspace.name || '').trim() || 'Workspace';
  const name = saving || saved;
  const iconSrc = workspace.settings?.icon_url || '';

  const startRename = () => { setPlace(null); setDraft(name); setRenaming(true); };
  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === saved) return;
    setSaving(next);
    try { await onRename?.(next); } finally { setSaving(null); }
  };
  const cancel = () => { settledRef.current = true; setRenaming(false); };

  return (
    <div className="ch-ws">
      <div className="ch-ws-line">
        {iconSrc ? (
          <span className="ch-ws-avatar is-img" aria-hidden="true"><R2Image src={iconSrc} alt="" /></span>
        ) : (
          <span className="ch-ws-avatar" style={{ background: pickPresenceColor(workspace.id) }} aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        {renaming ? (
          <form className="ch-ws-rename" onSubmit={(e) => { e.preventDefault(); commit(); }}>
            <input ref={inputRef} value={draft} maxLength={120} aria-label="Workspace name"
                   onChange={(e) => setDraft(e.target.value)}
                   onBlur={commit}
                   onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } }} />
          </form>
        ) : (
          <h1 className="ch-ws-name" title={name}>{name}</h1>
        )}
        <button ref={triggerRef} type="button" className={`ch-ws-switch${open ? ' is-open' : ''}`} onClick={toggle}
                aria-label="Switch workspace" title="Switch workspace" aria-haspopup="menu" aria-expanded={open}>
          <Icon as={ChevronDown} size={14} weight="regular" />
        </button>
        {!renaming && (
          <span className="ch-ws-acts">
            {canManage && <button type="button" className="ch-quiet" onClick={startRename}>Rename</button>}
            {canManage && <button type="button" className="ch-quiet" onClick={() => onInvite?.(workspace)}>Invite</button>}
            <button type="button" className="ch-quiet" onClick={() => { setPlace(null); onNew?.(); }}>New workspace</button>
          </span>
        )}
      </div>
      <p className="ch-ws-meta">{renaming ? 'Enter to save · Esc to cancel' : line}</p>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} className="ph-ws-pop" style={{ top: place.top, left: place.left, width: place.width }}>
          <WorkspaceMenu
            workspaces={workspaces || []}
            activeWorkspaceId={workspace.id}
            personalWorkspaceId={personalWorkspaceId}
            selfUserId={selfUserId}
            wsPeers={wsPeers}
            triggerSelector=".ch-ws-switch"
            onSelect={(id) => { setPlace(null); if (id !== workspace.id) onSwitch?.(id); }}
            onAddNew={() => { setPlace(null); onNew?.(); }}
            onRemove={onRemove}
            onOpenSettings={onOpenSettings}
            onShare={onInvite}
            onClose={closeMenu}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
