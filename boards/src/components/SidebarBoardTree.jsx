// Sidebar board tree — lazy expansion mirroring DocPageTree's pattern,
// but for boards instead of doc pages. Active row gets the existing
// .sb-row.active treatment so it visually matches Home / Messages.
//
// Per-row peer dots reuse the .bc-toc-peer styling from list-board
// preview rows, so the breadcrumb visual language is consistent
// across canvas → list rows → sidebar tree.

import { useEffect, useState } from 'react';
import { COVER_TINTS } from './primitives.jsx';

const BOARD_REF_MIME = 'application/x-soleil-board-ref';
const expandedKey = (workspaceId) => `soleil.boards.sb.expanded.${workspaceId}`;

function loadExpanded(workspaceId) {
  if (!workspaceId || typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(expandedKey(workspaceId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (_) { return new Set(); }
}
function saveExpanded(workspaceId, set) {
  if (!workspaceId || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(expandedKey(workspaceId), JSON.stringify([...set])); } catch (_) {}
}

export function SidebarBoardTree({
  boards,                  // map of boardId → board
  workspaceId,
  activeBoardId,
  onOpenBoard,
  peersHereByBoard,
  peersBelowByBoard,
  onJumpToPeer,
}) {
  const [expanded, setExpanded] = useState(() => loadExpanded(workspaceId));

  // Reset expansion state when switching workspaces — we keep per-workspace
  // sets in localStorage so each workspace remembers its own open branches.
  useEffect(() => {
    setExpanded(loadExpanded(workspaceId));
  }, [workspaceId]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveExpanded(workspaceId, next);
      return next;
    });
  };

  // Children index: parentId → ordered child boards. null parent = roots.
  const childrenByParent = (() => {
    const out = new Map();
    for (const b of Object.values(boards || {})) {
      if (!b || b.workspace_id !== workspaceId) continue;
      const key = b.parent_board_id ?? '__root__';
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(b);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    }
    return out;
  })();

  const roots = childrenByParent.get('__root__') || [];

  const renderRow = (board, depth) => {
    const kids = childrenByParent.get(board.id) || [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(board.id);
    const isActive = board.id === activeBoardId;
    const tint = COVER_TINTS[board.cover || 'neutral'] || COVER_TINTS.neutral;
    // Dedup peers by user.id with "exact" preferred over "nested" so the
    // dot tooltip reflects the closest match. Same logic the list-board
    // preview rows use (cards.jsx).
    const here  = peersHereByBoard?.get?.(board.id)  || [];
    const below = peersBelowByBoard?.get?.(board.id) || [];
    const presence = (() => {
      if (!here.length && !below.length) return [];
      const seen = new Set();
      const out = [];
      for (const p of [...here, ...below]) {
        const id = p?.user?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ ...p, exact: here.some(x => x.user?.id === id) });
      }
      return out;
    })();

    return (
      <div key={board.id} className="sb-tree-node">
        <div className={`sb-row sb-tree-row ${isActive ? 'active' : ''}`}
             style={{ paddingLeft: 6 + depth * 14 }}
             draggable
             onDragStart={(e) => {
               try {
                 e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: board.id, name: board.name }));
                 e.dataTransfer.effectAllowed = 'copy';
               } catch (_) {}
             }}
             onClick={() => onOpenBoard?.(board.id)}
             title="Click to open · drag onto a canvas to embed">
          <button className="sb-tree-chev"
                  onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(board.id); }}
                  style={{ visibility: hasKids ? 'visible' : 'hidden' }}
                  tabIndex={hasKids ? 0 : -1}>
            {isOpen ? '▾' : '▸'}
          </button>
          <span className="sb-dot" style={{ background: isActive ? 'var(--soleil)' : tint }} />
          <span className="sb-row-label">{board.name || 'Untitled'}</span>
          {presence.length > 0 && (
            <span className="bc-toc-peers">
              {presence.slice(0, 3).map(p => (
                <button key={p.user.id}
                        className={`bc-toc-peer ${p.exact ? 'is-exact' : 'is-nested'}`}
                        style={{ background: p.user.color || '#4f8df8' }}
                        title={p.exact
                          ? `${p.user.name || p.user.email} is here — click to jump`
                          : `${p.user.name || p.user.email} · in ${p.location?.boardName || 'a sub-board'} — click to jump`}
                        onClick={(e) => { e.stopPropagation(); onJumpToPeer?.(p.location); }} />
              ))}
              {presence.length > 3 && (
                <span className="bc-toc-peers-overflow"
                      title={`+${presence.length - 3} more`}>+{presence.length - 3}</span>
              )}
            </span>
          )}
        </div>
        {hasKids && isOpen && (
          <div className="sb-tree-children">
            {kids.map(c => renderRow(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (roots.length === 0) {
    return <div className="sb-tree-empty">No boards yet</div>;
  }

  return (
    <div className="sb-tree">
      {roots.map(b => renderRow(b, 0))}
    </div>
  );
}
