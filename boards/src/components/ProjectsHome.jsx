// ProjectsHome — Home shows a person their projects, with their universe behind.
//
// Home and the logo used to open the 3D graph and nothing else. People landed
// there by accident, looked for a few seconds and left, and there was no screen
// anywhere that showed someone their projects: the sidebar tree was collapsed
// and oldest-first, recents lived inside cmd-K, and the one gallery of a
// person's own clusters was on the upgrade modal. So Home is now a glass panel —
// the boards they were last in, their projects, and a way to start the next
// one — floating over the same living graph, which stays visible and usable
// around it. "Explore universe" slides the panel aside; "Projects" brings it
// back. The owner asked to see and use both.
//
// Presentational. The board map, the opener and the creator come in as props;
// what goes on the panel is decided by lib/projectsHome.js (pure, tested). The
// graph is passed in as a node so this file never pulls three.js into its own
// chunk — the 3D bundle stays lazy, and phones (which get the panel only) never
// load it at all.
//
// The panel opens on the WORKSPACE those projects belong to — the one thing
// above a project — with the same switcher the sidebar has and a plain New
// workspace beside it. Switching from here stays on Home and shows the other
// workspace's projects (lib/homeAfterSwitch says how that survives the remount).

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { R2Image } from './R2Image.jsx';
import { Icon } from './Icon.jsx';
import { Plus } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';
import { WorkspaceMenu } from './WorkspaceMenu.jsx';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { boardRecency, jumpBackIn, projectList, workspaceMenuPlacement } from '../lib/projectsHome.js';

const UNTITLED_RE = /^Untitled (cluster|list)$/i;
const displayName = (b) => (b?.name && b.name.trim()) || 'Untitled cluster';

function Thumb({ board, label }) {
  if (board?.thumb_key) {
    return (
      <span className="ph-thumb">
        <R2Image src={board.thumb_key} bust={board.thumb_updated_at || board.thumb_version || undefined}
                 eager alt="" />
      </span>
    );
  }
  // No render yet (a new or empty cluster): the cover tint and an initial, so
  // the tile is still recognisably THIS project rather than a grey box.
  const tint = COVER_TINTS[board?.cover] || COVER_TINTS.neutral;
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="ph-thumb ph-thumb-empty" style={{ '--ph-tint': tint }} aria-hidden="true">
      <span className="ph-thumb-initial">{initial}</span>
    </span>
  );
}

function Tile({ board, label, sub, onOpen }) {
  const when = relativeTimeShort(boardRecency(board));
  const cards = Number(board?.card_count) || 0;
  return (
    <button type="button" className="ph-tile" onClick={onOpen} title={label}>
      <Thumb board={board} label={label} />
      <span className="ph-tile-meta">
        <span className="ph-tile-name">{label}</span>
        <span className="ph-tile-sub">
          {sub || [cards > 0 ? `${cards} card${cards === 1 ? '' : 's'}` : null, when || null].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
}

function NewProjectTile({ onCreate, disabled }) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (naming) inputRef.current?.focus(); }, [naming]);
  const submit = () => {
    const name = draft.trim();
    setNaming(false);
    setDraft('');
    onCreate?.(name || null);
  };
  if (disabled) return null;
  if (!naming) {
    return (
      <button type="button" className="ph-tile ph-tile-new" onClick={() => setNaming(true)}>
        <span className="ph-thumb ph-thumb-new" aria-hidden="true"><Icon as={Plus} size={22} /></span>
        <span className="ph-tile-meta">
          <span className="ph-tile-name">New cluster</span>
          <span className="ph-tile-sub">At the top of your workspace</span>
        </span>
      </button>
    );
  }
  // Naming happens HERE, where the person asked, and never as a focused field
  // on the canvas — the empty project's whole ask is "paste images in", and a
  // focused text input would swallow that paste.
  return (
    <form className="ph-tile ph-tile-new is-naming" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="ph-thumb ph-thumb-new" aria-hidden="true"><Icon as={Plus} size={22} /></span>
      <span className="ph-tile-meta">
        <input ref={inputRef} className="ph-new-input" value={draft} maxLength={120}
               placeholder="Name it (optional)" aria-label="New cluster name"
               onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(false); setDraft(''); } }} />
        <span className="ph-tile-sub">Enter to create</span>
      </span>
    </form>
  );
}

function WorkspaceHeader({
  workspace, workspaces, personalWorkspaceId, selfUserId, wsPeers,
  onSwitch, onNew, onRemove, onOpenSettings,
}) {
  const [place, setPlace] = useState(null);   // the open menu's position, or null
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const open = !!place;

  // The menu follows its trigger. The panel is centred, so the trigger moves
  // whenever the panel's height changes (the projects arriving just after a
  // switch) or the main area's width does (⌘B); and in the native app the soft
  // keyboard RESIZES the WebView the moment the filter takes focus, so closing
  // on resize would shut the menu as it is used. Re-placed on all of those —
  // with a functional update, so a late callback can never reopen a closed
  // menu. Only a scroll of the panel, which carries the trigger away under the
  // person's own hand, closes it.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setPlace(null);
    const follow = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPlace((p) => (p ? workspaceMenuPlacement(rect, { width: window.innerWidth }) : p));
    };
    const scroller = triggerRef.current?.closest('.ph-panel');
    const root = triggerRef.current?.closest('.ph-root');
    window.addEventListener('resize', follow);
    scroller?.addEventListener('scroll', close, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(follow) : null;
    if (ro) { if (scroller) ro.observe(scroller); if (root) ro.observe(root); }
    return () => {
      window.removeEventListener('resize', follow);
      scroller?.removeEventListener('scroll', close);
      ro?.disconnect();
    };
  }, [open]);

  // Into the menu when it opens: it is portalled to the end of <body>, so Tab
  // from the trigger would otherwise walk the whole panel before reaching it.
  // (With enough workspaces for a filter, the filter's autoFocus already has it.)
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop || pop.contains(document.activeElement)) return;
    (pop.querySelector('.ws-menu-row.is-active') || pop.querySelector('.ws-menu-row'))?.focus({ preventScroll: true });
  }, [open]);
  // And back to the trigger when it closes from inside (Escape, a pick), so
  // focus is never left on a node that no longer exists.
  const closeMenu = () => {
    const inside = !!popRef.current?.contains(document.activeElement);
    setPlace(null);
    if (inside) triggerRef.current?.focus({ preventScroll: true });
  };

  if (!workspace) return null;
  const isPersonal = workspace.id === personalWorkspaceId;
  const isOwner = workspace.created_by === selfUserId;
  const sub = isPersonal ? 'Your personal workspace' : isOwner ? 'Your workspace' : 'Shared with you';
  const iconSrc = workspace.settings?.icon_url || '';
  const name = (workspace.name || '').trim() || 'Workspace';

  const toggle = () => {
    if (open) { setPlace(null); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    setPlace(workspaceMenuPlacement(rect, { width: window.innerWidth }));
  };

  return (
    <div className="ph-ws">
      <button ref={triggerRef} type="button" className="ph-ws-trigger" onClick={toggle}
              title="Switch workspace" aria-haspopup="menu" aria-expanded={open}>
        {iconSrc ? (
          <span className="ph-ws-avatar ph-ws-avatar-img"><R2Image src={iconSrc} alt="" /></span>
        ) : (
          <span className="ph-ws-avatar" style={{ background: pickPresenceColor(workspace.id) }} aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="ph-ws-text">
          <span className="ph-ws-name">{name}</span>
          <span className="ph-ws-sub">{sub}</span>
        </span>
        <svg className="ph-ws-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Labelled outright: on a phone the words collapse and only the + shows. */}
      <button type="button" className="ph-ws-new" aria-label="New workspace" title="New workspace"
              onClick={() => { setPlace(null); onNew?.(); }}>
        <Icon as={Plus} size={14} />
        <span>New workspace</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} className="ph-ws-pop" style={{ top: place.top, left: place.left, width: place.width }}>
          <WorkspaceMenu
            workspaces={workspaces || []}
            activeWorkspaceId={workspace.id}
            personalWorkspaceId={personalWorkspaceId}
            selfUserId={selfUserId}
            wsPeers={wsPeers}
            triggerSelector=".ph-ws-trigger"
            onSelect={(id) => { if (id !== workspace.id) onSwitch?.(id); }}
            onAddNew={() => onNew?.()}
            onRemove={onRemove}
            onOpenSettings={onOpenSettings}
            onClose={closeMenu}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ProjectsHome({
  boards,
  rootId,
  workspaceId,
  recents = [],
  canCreate = false,
  exploring = false,
  graph = null,            // the universe, as a node — null on phones
  onOpenBoard,             // (boardId, via) => void
  onNewProject,            // (name|null) => void
  onExplore,               // (bool) => void
  // The workspace these projects belong to, and the switcher over it. Absent
  // (a harness, an old caller) → no header, the panel as it was.
  workspace = null,
  workspaces = [],
  personalWorkspaceId = null,
  selfUserId = null,
  wsPeers = [],
  onSwitchWorkspace,       // (workspaceId) => void
  onNewWorkspace,          // () => void
  onRemoveWorkspace,       // (ws, 'delete'|'leave') => void
  onOpenWorkspaceSettings, // (ws) => void
}) {
  const root = boards?.[rootId] || null;
  const projects = useMemo(() => projectList(boards, rootId, { workspaceId }), [boards, rootId, workspaceId]);
  const jump = useMemo(() => jumpBackIn(boards, recents, rootId, { workspaceId }), [boards, recents, rootId, workspaceId]);

  return (
    <div className={`ph-root${exploring ? ' is-exploring' : ''}${graph ? '' : ' no-graph'}`}>
      {graph && <div className="ph-graph">{graph}</div>}

      {exploring ? (
        <button type="button" className="ph-projects-pill" onClick={() => onExplore?.(false)}>
          Clusters
        </button>
      ) : (
        <section className="ph-panel surface-frosted" aria-label="Your clusters">
          <WorkspaceHeader
            workspace={workspace}
            workspaces={workspaces}
            personalWorkspaceId={personalWorkspaceId}
            selfUserId={selfUserId}
            wsPeers={wsPeers}
            onSwitch={onSwitchWorkspace}
            onNew={onNewWorkspace}
            onRemove={onRemoveWorkspace}
            onOpenSettings={onOpenWorkspaceSettings}
          />
          {jump.length > 0 && (
            <div className="ph-section">
              <div className="ph-eyebrow">Jump back in</div>
              <div className="ph-jump">
                {jump.map((b) => (
                  <button key={b.id} type="button" className="ph-jump-item"
                          onClick={() => onOpenBoard?.(b.id, 'jump')} title={displayName(b)}>
                    <Thumb board={b} label={b.id === rootId ? 'Studio' : displayName(b)} />
                    <span className="ph-jump-name">{b.id === rootId ? (root?.name || 'Studio') : displayName(b)}</span>
                    <span className="ph-jump-when">{relativeTimeShort(boardRecency(b))}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ph-section">
            <div className="ph-eyebrow">Your clusters</div>
            <div className="ph-grid">
              {root && (
                <Tile board={root} label={root.name || 'Studio'}
                      onOpen={() => onOpenBoard?.(root.id, 'studio')} />
              )}
              {projects.map((b) => (
                <Tile key={b.id} board={b}
                      label={UNTITLED_RE.test(b.name || '') ? 'Untitled cluster' : displayName(b)}
                      onOpen={() => onOpenBoard?.(b.id, 'tile')} />
              ))}
              <NewProjectTile disabled={!canCreate} onCreate={onNewProject} />
            </div>
          </div>

          {graph && (
            <button type="button" className="ph-explore" onClick={() => onExplore?.(true)}>
              Explore universe →
            </button>
          )}
        </section>
      )}
    </div>
  );
}
