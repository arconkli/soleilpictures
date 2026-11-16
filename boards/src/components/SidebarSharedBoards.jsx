// "Shared with you" sidebar section: the clusters other people shared with
// you, as the tree draws your own (the sharer's face where the server says who,
// a ⋯ menu, sub-clusters under a caret). It lists the newest few
// (sidebarSharedRoots); finding the rest, files shared with you and what you
// shared are the Shared page's ("All shared", the row under the list).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COVER_TINTS } from './primitives.jsx';
import { Icon } from './Icon.jsx';
import { PersonFace } from './PersonFace.jsx';
import { ChevronRight, MoreHorizontal, Search, Link, X, ArrowSquareOut, Users } from '../lib/icons.js';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { sidebarSharedRoots, isNewShare, SIDEBAR_SHARED_CAP } from '../lib/sharedList.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { INDENT } from '../lib/sidebarRows.js';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import './sidebar/sharedWithYou.css';

const OPEN_KEY = 'soleil.boards.sb.sharedWithYou.open';   // '0' = folded; open by default

function loadOpen() {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch (_) { return true; }
}
function saveOpen(open) {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) { /* nothing kept */ }
}

// The ids from `rootId` down to `target` (both included), or null.
function pathTo(childrenOf, rootId, target) {
  const seen = new Set();
  const walk = (id, trail) => {
    if (seen.has(id)) return null;
    seen.add(id);
    const next = [...trail, id];
    if (id === target) return next;
    for (const c of childrenOf.get(id) || []) {
      const hit = walk(c.board_id, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(rootId, []);
}

const tintOf = (row) => COVER_TINTS[row.board_cover || 'neutral'] || COVER_TINTS.neutral;
const roleTitle = (row) => (row.role === 'viewer'
  ? t`${ph({ name: row.board_name })} · view only`
  : t`${ph({ name: row.board_name })} · editor`);

// The ⋯ menu: portaled (the sidebar clips overflow), placed from the button.
function RowMenu({ row, onOpen, onCopyLink, onRemove }) {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  const refs = useMemo(() => [btnRef, menuRef], []);
  const close = (refocus) => { setPos(null); if (refocus) btnRef.current?.focus(); };
  useDismissOnOutside(refs, !!pos, () => close(true));
  useLayoutEffect(() => {
    if (pos) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [pos]);
  useEffect(() => {
    if (!pos) return undefined;
    const shut = () => setPos(null);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => { window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); };
  }, [pos]);
  const toggle = (e) => {
    e.stopPropagation();
    if (pos) { close(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 200;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width });
  };
  // Open navigates away. Copy link keeps the row, so focus returns to the ⋯
  // button. Remove drops the row (and its button): focus moves to the section.
  const pick = (fn, how) => (e) => {
    e.stopPropagation();
    const host = btnRef.current?.closest('.swy');
    close(how === 'copy');
    fn?.(row.board_id);
    if (how === 'remove') {
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body) return;
        (host?.querySelector('.swy-head-toggle') || host?.querySelector('.swy-all'))?.focus();
      });
    }
  };
  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    items[(e.key === 'ArrowDown' ? i + 1 : i - 1 + items.length) % items.length]?.focus();
    e.preventDefault();
  };
  return (
    <>
      <button type="button" ref={btnRef} className={`swy-more${pos ? ' is-open' : ''}`}
              aria-haspopup="menu" aria-expanded={!!pos}
              aria-label={t`More for ${ph({ name: row.board_name })}`} title={t`More`}
              onClick={toggle} onKeyDown={(e) => e.stopPropagation()}>
        <Icon as={MoreHorizontal} size={14} weight="regular" />
      </button>
      {pos && createPortal(
        <div className="sbf-upmenu swy-menu" role="menu" ref={menuRef} onKeyDown={onMenuKey}
             style={{ top: pos.top, left: pos.left, width: pos.width }}
             onClick={(e) => e.stopPropagation()}>
          <button type="button" className="sbf-upitem" role="menuitem" onClick={pick(onOpen)}>
            <Icon as={ArrowSquareOut} size={16} weight="regular" />
            <span className="sbf-upitem-l"><b><Trans>Open</Trans></b></span>
          </button>
          <button type="button" className="sbf-upitem" role="menuitem" onClick={pick(onCopyLink, 'copy')}>
            <Icon as={Link} size={16} weight="regular" />
            <span className="sbf-upitem-l"><b><Trans>Copy link</Trans></b></span>
          </button>
          <button type="button" className="sbf-upitem" role="menuitem" onClick={pick(onRemove, 'remove')}>
            <Icon as={X} size={16} weight="regular" />
            <span className="sbf-upitem-l"><b><Trans>Remove from my list</Trans></b></span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

export function SidebarSharedBoards({
  roots = [],            // list_shared_boards root rows, any order
  childrenOf = new Map(),
  meta = new Map(),
  activeBoardId = null,
  activeRootId = null,
  onOpenBoard,
  onCopyLink,
  onRemove,
  // The Shared page's entry: { count, active, onOpen, onSearch }, or null.
  allShared = null,
}) {
  const [open, setOpen] = useState(loadOpen);
  const [expanded, setExpanded] = useState(() => new Set());

  const { rows, total } = useMemo(
    () => sidebarSharedRoots(roots, meta, { activeRootId }),
    [roots, meta, activeRootId],
  );

  // Opening a cluster inside a shared root shows where it is.
  useEffect(() => {
    if (!activeBoardId || !activeRootId || activeBoardId === activeRootId) return;
    const path = pathTo(childrenOf, activeRootId, activeBoardId);
    if (!path) return;
    setExpanded((cur) => {
      const ancestors = path.slice(0, -1);
      if (ancestors.every((id) => cur.has(id))) return cur;
      const next = new Set(cur);
      ancestors.forEach((id) => next.add(id));
      return next;
    });
  }, [activeBoardId, activeRootId, childrenOf]);

  if (total === 0 && !allShared) return null;

  const setOpenSaved = (v) => { setOpen(v); saveOpen(v); };
  const toggleNode = (id) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const onHeadKey = (e) => {
    if (isComposingKey(e) || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenSaved(!open); }
  };

  const renderRow = (row, depth) => {
    const id = row.board_id;
    const kids = childrenOf.get(id) || [];
    const isOpen = expanded.has(id);
    const isActive = id === activeBoardId;
    const isRoot = depth === 0;
    const who = isRoot && typeof row.shared_by_name === 'string' && row.shared_by_name.trim() ? row.shared_by_name.trim() : null;
    const fresh = isRoot && isNewShare(meta?.get?.(id));
    const onKey = (e) => {
      if (isComposingKey(e) || e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenBoard?.(id); }
      else if (e.key === 'ArrowRight' && kids.length && !isOpen) { e.preventDefault(); toggleNode(id); }
      else if (e.key === 'ArrowLeft' && kids.length && isOpen) { e.preventDefault(); toggleNode(id); }
    };
    return (
      <div key={id} className="swy-node">
        <div className={`sb-row sb-tree-row is-files swy-row${isActive ? ' active' : ''}`}
             role="treeitem" tabIndex={0} aria-level={depth + 1}
             aria-expanded={kids.length ? isOpen : undefined} aria-selected={isActive}
             style={{ paddingLeft: 8 + depth * INDENT }}
             // Another workspace's cluster: the drag label says files
             // can't go there (lib/dropRules.js); nothing here takes them.
             data-drop-board={id}
             data-drop-ws={row.source_workspace_id || 'elsewhere'}
             data-drop-ws-name={row.source_workspace_name || ''}
             data-drop-name={row.board_name || ''}
             onMouseEnter={() => prefetchBoard(id)}
             onClick={() => onOpenBoard?.(id)}
             onKeyDown={onKey}
             title={who ? t`Shared by ${ph({ name: who })}` : roleTitle(row)}>
          <button type="button" className={`sb-tree-chev${isOpen ? ' is-open' : ''}`}
                  style={{ visibility: kids.length ? 'visible' : 'hidden' }}
                  tabIndex={-1} aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); if (kids.length) toggleNode(id); }}>
            <Icon as={ChevronRight} size={10} weight="regular" />
          </button>
          <span className="swy-lead">
            {who
              ? <PersonFace className="mini-face" name={who} color={row.shared_by_color} ariaHidden />
              : <span className="sb-dot" style={{ background: isActive ? 'var(--soleil)' : tintOf(row) }} />}
          </span>
          <span className="sb-row-label" dir="auto">{row.board_name}</span>
          {fresh && <span className="swy-new" aria-hidden="true" />}
          {fresh && <span className="sr-only"><Trans>New</Trans></span>}
          {row.role === 'viewer' && (
            <span className="sb-shared-ro" title={t`View only`}><Trans context="permission">View</Trans></span>
          )}
          {isRoot && (
            <RowMenu row={row} onOpen={onOpenBoard} onCopyLink={onCopyLink} onRemove={onRemove} />
          )}
        </div>
        {kids.length > 0 && isOpen && (
          <div role="group">{kids.map((c) => renderRow(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="sb-shared swy">
      {total > 0 && (
        <div className="sb-eyebrow sb-shared-head swy-head"
             onClick={() => setOpenSaved(!open)}>
          <span className="swy-head-toggle" role="button" tabIndex={0} aria-expanded={open} onKeyDown={onHeadKey}>
            <span className={`sb-shared-chev ${open ? 'is-open' : ''}`} aria-hidden="true">
              <Icon as={ChevronRight} size={11} />
            </span>
            <span className="swy-head-label"><Trans>Shared with you</Trans></span>
          </span>
          {total > SIDEBAR_SHARED_CAP && (
            <button type="button" className="swy-find" aria-label={t`Search shared`} title={t`Search shared`}
                    onClick={(e) => { e.stopPropagation(); allShared?.onSearch?.(); }}
                    onKeyDown={(e) => e.stopPropagation()}>
              <Icon as={Search} size={12} weight="regular" />
            </button>
          )}
        </div>
      )}
      {total > 0 && open && (
        <div className="swy-rows" role="tree" aria-label={t`Shared with you`}>
          {rows.map((r) => renderRow(r, 0))}
        </div>
      )}
      {allShared && (
        <div className={`sb-row sb-tree-row is-files swy-all${allShared.active ? ' active' : ''}`}
             role="button" tabIndex={0} style={{ paddingLeft: 8 }}
             aria-label={allShared.count > 0 ? plural(allShared.count, { one: 'All shared, # new', other: 'All shared, # new' }) : undefined}
             onClick={() => allShared.onOpen?.()}
             onKeyDown={(e) => {
               if (isComposingKey(e) || e.target !== e.currentTarget) return;
               if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); allShared.onOpen?.(); }
             }}>
          <span className="swy-all-icon" aria-hidden="true"><Icon as={Users} size={14} weight="regular" /></span>
          <span className="sb-row-label"><Trans>All shared</Trans></span>
          {allShared.count > 0 && <span className="swy-all-count" aria-hidden="true">{allShared.count}</span>}
        </div>
      )}
    </div>
  );
}
