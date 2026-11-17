// Workspace switcher popover. Replaces the old 40px rail of icon
// buttons with a richer dropdown that shows full names + ownership
// subtitles + member dots, grouped into "Mine" and "Shared with you".
//
// Positioned absolutely below its trigger; consumer is expected to
// render it inside a `position: relative` container. Click-outside +
// Escape close it.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, MoreHorizontal, Check, Lock, Users, ChevronRight } from '../lib/icons.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { Icon } from './Icon.jsx';
import { R2Image } from './R2Image.jsx';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { ownPersonalCount, workspaceCountLine } from '../lib/workspaceLimit.js';
import { teamsAllowed } from '../lib/appHost.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { initialOf } from '../lib/graphemes.js';
import { matchesFind, findHitKind, readOpenedWorkspaces, orderSharedWorkspaces, shortSharedList } from '../lib/sharedPeople.js';
import { isOwnWorkspace, workspaceTitle, workspaceTileName, workspaceOwnerLine, titleNamesOwner } from '../lib/sharedPeopleWords.js';
import { useWorkspaceOwners } from '../hooks/useWorkspaceOwners.js';
import { trackFindUsed } from '../lib/findUsed.js';
import { coarsePointer } from '../lib/noteTouchTyping.js';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './workspaceMenuFind.css';

// Show the find field once the menu lists this many workspaces — on
// tiny lists it's just visual clutter.
const FILTER_MIN = 5;
// The id of the "Show all" row in the arrow-key list.
const SHOW_ALL = '__show_all__';

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
  // The keyboard / hover highlight: a workspace id, or null. While the field
  // has text the first match stands in for null (see `hlId`).
  const [hl, setHl] = useState(null);
  // The short list of shared workspaces shows all of them once opened out; each open starts shut.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const rowDomId = (id) => `${listId}-ws-${id}`;
  const scrollHl = useRef(false);
  const findRef = useRef(null);
  // Which shared workspaces you opened last on this device: read once per open.
  const opened = useMemo(() => readOpenedWorkspaces(), []);
  // The per-row menu (the shared right-click menu), one at a time:
  // { id, x, y, byKey?, returnEl? } for the workspace whose ⋯ or right-click opened it.
  const [rowMenu, setRowMenu] = useState(null);
  const openMenuId = rowMenu?.id ?? null;
  // When the row menu last closed, and which row's: a ⋯ press that closed it
  // (as an outside press) must not reopen it with its own click, and the
  // Escape that closed it must not also close this switcher.
  const rowMenuClosedRef = useRef({ id: null, at: 0 });
  const closeRowMenu = () => {
    rowMenuClosedRef.current = { id: rowMenu?.id ?? null, at: Date.now() };
    setRowMenu(null);
  };
  // Close on outside click + Escape. Capture-phase mousedown so we beat
  // any handlers that might re-focus or repaint inside the menu.
  // Important: ignore clicks on the trigger button itself — its own
  // onClick toggles the open state, and if we close here first the
  // trigger immediately re-opens.
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      // The row menu is portaled out of this popover: a press in it is inside.
      if (e.target.closest?.('.ctx-menu')) return;
      if (triggerSelector && e.target.closest?.(triggerSelector)) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      if (e.key !== 'Escape') return;
      // The row menu takes this Escape (it closed in the capture phase, just now).
      if (rowMenuOpenRef.current || Date.now() - rowMenuClosedRef.current.at < 100) return;
      onClose?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, triggerSelector]);

  const rowMenuOpenRef = useRef(false);
  rowMenuOpenRef.current = !!rowMenu;

  const list = workspaces || [];
  const owners = useWorkspaceOwners(list, selfUserId);
  const showFilter = list.length >= FILTER_MIN;
  const q = filter.trim();
  // What a row calls itself, and who owns it (null: yours, or unknown).
  const titleOf = (w) => (isOwnWorkspace(w, selfUserId) || w.created_by === selfUserId
    ? w.name : workspaceTitle(w, { ownerName: owners.get(w.id)?.name ?? null, isOwn: false }));
  const matches = (w) => !q || matchesFind(q, [titleOf(w), w.name, owners.get(w.id)?.name ?? null]);
  // A real team's workspaces show once, in the team section, while not filtering.
  const teamIds = !q && team?.ids ? new Set(team.ids) : null;
  const inTeam = (w) => !!teamIds && teamIds.has(w.id);
  const mine = useMemo(() => list
    .filter(w => w.created_by === selfUserId && matches(w) && !inTeam(w))
    .sort((a, b) => {
      if (a.id === personalWorkspaceId) return -1;
      if (b.id === personalWorkspaceId) return 1;
      return (a.created_at || '').localeCompare(b.created_at || '');
    }), [list, selfUserId, personalWorkspaceId, q, team?.ids, owners]);
  const sharedAll = useMemo(() => orderSharedWorkspaces(
    list.filter(w => w.created_by !== selfUserId && matches(w) && !inTeam(w)),
    opened,
    (w) => Date.parse(w._joinedAt),
  ), [list, selfUserId, q, team?.ids, owners, opened]);
  // The rows on screen, top to bottom: what the arrows walk. A team's rows
  // come first while nothing is typed, and switch through the team's own path.
  const teamRows = team && !q ? (team.workspaces || []) : [];
  const teamRowIds = new Set(teamRows.map(w => w.id));
  const sharedLive = sharedAll.filter(w => !teamRowIds.has(w.id));
  const { rows: shared, hidden: sharedHidden } = shortSharedList(sharedLive, { activeId: activeWorkspaceId, expanded, searching: !!q });
  const showAllRow = sharedHidden > 0 ? [{ id: SHOW_ALL }] : [];
  const visible = [...teamRows, ...mine.filter(w => !teamRowIds.has(w.id)), ...shared, ...showAllRow];
  const expandAll = () => {
    // The highlight moves to the first row the list just gained.
    const first = sharedLive.find(w => !shared.some(x => x.id === w.id));
    setExpanded(true);
    // The button unmounts as the list grows; keep focus where the arrows work.
    findRef.current?.focus();
    if (first) { scrollHl.current = true; setHl(first.id); }
  };
  const hlId = q ? (visible.some(w => w.id === hl) ? hl : visible[0]?.id ?? null)
                 : (visible.some(w => w.id === hl) ? hl : null);
  useEffect(() => {
    if (!scrollHl.current || !hlId) return;
    scrollHl.current = false;
    document.getElementById(rowDomId(hlId))?.scrollIntoView?.({ block: 'nearest' });
  }, [hlId]);
  const pick = (w) => {
    if (w.id === SHOW_ALL) { expandAll(); return; }
    if (teamRowIds.has(w.id)) { team.onPickWorkspace?.(w); onClose?.(); return; }
    if (q) {
      trackFindUsed({
        surface: 'ws_menu',
        nItems: visible.length,
        by: findHitKind(q, [titleOf(w), w.name], [owners.get(w.id)?.name ?? null]) || 'name',
      });
    }
    onSelect?.(w.id);
    onClose?.();
  };
  const onFindKey = (e) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (filter) { e.stopPropagation(); setFilter(''); setHl(null); } else onClose?.();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!visible.length) return;
      const down = e.key === 'ArrowDown';
      let i = visible.findIndex(w => w.id === hlId);
      if (i < 0) i = visible.findIndex(w => w.id === activeWorkspaceId);
      const next = i < 0 ? (down ? 0 : visible.length - 1)
        : (i + (down ? 1 : -1) + visible.length) % visible.length;
      scrollHl.current = true;
      setHl(visible[next].id);
      return;
    }
    if (e.key === 'Enter') {
      const w = visible.find(x => x.id === hlId);
      if (w) { e.preventDefault(); pick(w); }
    }
  };
  // From 8 of your own (0856): "8 of 10 workspaces"; "of your own" when a team's are in the list too.
  const countLine = workspaceCountLine(ownPersonalCount(list, selfUserId), { teams: teamsAllowed(), mixed: list.some(w => w.org_id) });
  const noResults = q && mine.length === 0 && sharedAll.length === 0;

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
    const owner = owners.get(w.id) || null;
    const title = titleOf(w);
    const ownerFirst = !isOwner && !isOwnWorkspace(w, selfUserId) && owner?.name
      && !titleNamesOwner(w, { ownerName: owner.name, isOwn: false })
      ? owner.name.trim().split(/\s+/)[0] : '';
    const ownerLine = isOwner ? null
      : workspaceOwnerLine(w, { ownerName: owner?.name ?? null, isOwn: isOwnWorkspace(w, selfUserId), role: w._myRole });
    const subtitle = isPersonal ? t`Personal`
                  : isOwner    ? t`You own this`
                  : ownerLine ? ownerLine
                  : isCoowner  ? t`You co-own this`
                  :              t`Shared with you`;
    const initial = initialOf(workspaceTileName(w, { ownerName: owner?.name ?? null, isOwn: isOwner || isOwnWorkspace(w, selfUserId) }));
    // Someone else's workspace takes its owner's colour, so a person's
    // workspaces read as theirs; your own keep the id-derived one.
    const tint = (!isOwner && owner?.color) || pickPresenceColor(w.id);
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
           // Move, not enter: a row sliding under a still pointer as the
           // arrows scroll the list mustn't take the highlight.
           onMouseMove={() => setHl(w.id)}
           // Right-click a workspace → the same menu its ⋯ opens, instead of
           // the browser's.
           onContextMenu={hasRowMenu ? (e) => { e.preventDefault(); setRowMenu({ id: w.id, x: e.clientX, y: e.clientY }); } : undefined}>
        <button id={rowDomId(w.id)}
                title={subtitle}
                className={`ws-menu-row is-short ${isActive ? 'is-active' : ''} ${hlId === w.id ? 'is-kb' : ''}`}
                onClick={() => pick(w)}>
          {iconSrc
            ? <span className="ws-menu-avatar ws-menu-avatar-img"><R2Image src={iconSrc} alt="" /></span>
            : <span className="ws-menu-avatar" style={{ background: tint }}>{initial}</span>}
          <span className="ws-menu-text">
            <span className="ws-menu-name">{title}</span>
          </span>
          {ownerFirst && <span className="ws-menu-owner">{ownerFirst}</span>}
          {q && hlId === w.id && <span className="ws-menu-enter" aria-hidden="true">↵</span>}
          {isActive && (
            <span className="ws-menu-check"><Icon as={Check} size={14} /></span>
          )}
        </button>
        {hasRowMenu && (
          <>
            <button className={`ws-menu-row-more ${isMenuOpen ? 'is-open' : ''}`}
                    title={t`More actions`}
                    aria-label={t`More actions`}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      // The press that closed the menu is this toggle's own.
                      const was = rowMenuClosedRef.current;
                      if (isMenuOpen || (was.id === w.id && Date.now() - was.at < 400)) { rowMenuClosedRef.current = { id: null, at: 0 }; setRowMenu(null); return; }
                      const r = e.currentTarget.getBoundingClientRect();
                      setRowMenu({ id: w.id, x: r.left, y: r.bottom + 2, byKey: e.detail === 0, returnEl: e.currentTarget });
                    }}>
              <Icon as={MoreHorizontal} size={14} />
            </button>
          </>
        )}
      </div>
    );
  };

  // One workspace's menu: the same gates the old ⋯ pop had. Share and Rename
  // are for an owner or co-owner; the red row is Delete (owner) or Leave
  // (shared member), never on the personal workspace.
  const rowMenuItems = (w) => {
    if (!w) return [];
    const isPersonal = w.id === personalWorkspaceId;
    const isOwner = w.created_by === selfUserId;
    const canManage = isOwner || (!isOwner && w._myRole === 'coowner');
    const removeAction = isOwner ? 'delete' : 'leave';
    const out = [];
    if (onShare && canManage) out.push({ id: 'share', label: t`Share workspace…`, icon: 'ShareNetwork', run: () => { onShare(w); onClose?.(); } });
    if (onOpenSettings && canManage) out.push({ id: 'rename', label: t`Rename & icon…`, icon: 'PencilSimple', run: () => onOpenSettings(w) });
    if (onRemove && !isPersonal) {
      if (out.length) out.push({ divider: true });
      out.push(removeAction === 'delete'
        ? { id: 'delete', label: t`Delete workspace`, icon: 'Trash', danger: true, run: () => onRemove(w, removeAction) }
        : { id: 'leave', label: t`Leave workspace`, icon: 'SignOut', danger: true, run: () => onRemove(w, removeAction) });
    }
    return out;
  };

  return (
    <div ref={ref} className="ws-menu" role="menu" aria-label={t`Switch workspace`}>
      {showFilter && (
        <div className="ws-menu-filter">
          <Icon as={Search} size={12} />
          <input ref={findRef} autoFocus={!coarsePointer()}
                 type="text"
                 placeholder={t`Find a workspace or person…`}
                 aria-label={t`Find a workspace or person…`}
                 aria-controls={listId}
                 aria-activedescendant={hlId ? rowDomId(hlId) : undefined}
                 value={filter}
                 onChange={(e) => { setFilter(e.target.value); setHl(null); scrollHl.current = true; }}
                 onKeyDown={onFindKey} />
        </div>
      )}
      <div className="ws-menu-scroll" id={listId}>
        {team && !q && (
          <>
            <div className="ws-menu-section">{team.name.toUpperCase()}<span className="ws-menu-tag"><Trans>TEAM</Trans></span></div>
            {team.workspaces.map((w) => (
              <button key={w.id} type="button" id={rowDomId(w.id)}
                      className={`ws-menu-row ${team.activeId && w.id === team.activeId ? 'is-active' : ''} ${hlId === w.id ? 'is-kb' : ''}`}
                      onMouseMove={() => setHl(w.id)}
                      onClick={() => pick(w)}>
                <span className="ws-menu-avatar" style={{ background: w.color }}>{w.letter}</span>
                <span className="ws-menu-text">
                  <span className="ws-menu-name">{w.name}</span>
                  <span className="ws-menu-sub">
                    {team.viewOnly ? t`Team · view-only` : w.private ? t`Team · private` : t`Team`}
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
                <span className="ws-menu-name"><Trans>Team page</Trans></span>
                <span className="ws-menu-sub">{team.manage ? t`People, seats and billing` : t`Who’s on the team`}</span>
              </span>
              <span className="ws-menu-tail"><Icon as={ChevronRight} size={12} weight="regular" /></span>
            </button>
          </>
        )}
        {mine.length > 0 && (
          <>
            <div className="ws-menu-section"><Trans>YOURS</Trans></div>
            {mine.map(renderRow)}
          </>
        )}
        {shared.length > 0 && (
          <>
            <div className="ws-menu-section">
              {sharedHidden > 0 ? t`SHARED WITH YOU · ${ph({ n: sharedLive.length })}` : <Trans>SHARED WITH YOU</Trans>}
            </div>
            {shared.map(renderRow)}
            {sharedHidden > 0 && (
              <button type="button" id={rowDomId(SHOW_ALL)}
                      className={`ws-menu-row is-short ws-menu-showall ${hlId === SHOW_ALL ? 'is-kb' : ''}`}
                      onMouseMove={() => setHl(SHOW_ALL)}
                      onClick={expandAll}>
                <span className="ws-menu-text">
                  <span className="ws-menu-name">
                    {plural(sharedLive.length, { one: 'Show all #', other: 'Show all #' })}
                  </span>
                </span>
              </button>
            )}
          </>
        )}
        {noResults && (
          <div className="ws-menu-empty">{t`No workspace or person matches “${ph({ q })}”.`}</div>
        )}
      </div>
      <div className="ws-menu-divider" />
      <button className="ws-menu-row ws-menu-add"
              onClick={() => { onAddNew?.(); onClose?.(); }}>
        <span className="ws-menu-avatar ws-menu-avatar-add">
          <Icon as={Plus} size={12} />
        </span>
        <span className="ws-menu-text">
          <span className="ws-menu-name"><Trans>New workspace</Trans></span>
        </span>
      </button>
      {countLine && <div className="ws-menu-count">{countLine}</div>}
      {/* Portaled: this popover is not a place for a fixed menu to live, and
          the outside-press check above counts .ctx-menu as inside. */}
      {createPortal((
        <CardContextMenu
          open={!!rowMenu}
          x={rowMenu?.x ?? 0}
          y={rowMenu?.y ?? 0}
          items={rowMenu ? rowMenuItems(list.find(w => w.id === rowMenu.id)) : []}
          label={t`More actions`}
          root="menu"
          byKey={!!rowMenu?.byKey}
          returnFocus={rowMenu?.returnEl}
          onClose={closeRowMenu}
        />
      ), document.body)}
    </div>
  );
}
