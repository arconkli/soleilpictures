// Sidebar board tree — lazy expansion mirroring DocPageTree's pattern,
// but for boards instead of doc pages. Active row gets the existing
// .sb-row.active treatment so it visually matches Home / Messages.
//
// Per-row peer dots reuse the .bc-toc-peer styling from list-board
// preview rows, so the breadcrumb visual language is consistent
// across canvas → list rows → sidebar tree.

import { useEffect, useRef, useState } from 'react';
import { COVER_TINTS } from './primitives.jsx';
import { prefetchBoard } from '../lib/prefetchKinds.js';

const HOVER_PREFETCH_MS = 80;

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
  onRenameBoard,           // (boardId, newName) => Promise — called on commit
  peersHereByBoard,
  peersBelowByBoard,
  onJumpToPeer,
}) {
  const [expanded, setExpanded] = useState(() => loadExpanded(workspaceId));
  // Inline rename: { boardId, draft }. Double-click a row to enter,
  // Enter/blur to commit, Escape to cancel.
  const [renaming, setRenaming] = useState(null);
  const renameInputRef = useRef(null);
  // Single shared hover timer — only one row can be hovered at a
  // time, so we don't need per-row state.
  const hoverTimer = useRef(null);
  // Suppress the stray click that some browsers fire after an HTML5 drag
  // (and after a touch-drag gesture). Mouse path: set in onDragStart,
  // cleared in onDragEnd on the next tick so the trailing click sees it.
  // Touch path: set when drag goes active in the document-level pointer
  // listener (further below), cleared on pointerup the same way.
  const dragGestureRef = useRef({ dragged: false });
  const hoverEnter = (boardId) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      prefetchBoard(boardId);
    }, HOVER_PREFETCH_MS);
  };
  const hoverLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };
  useEffect(() => () => hoverLeave(), []);
  const beginRename = (board) => {
    setRenaming({ boardId: board.id, draft: board.name || '' });
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (el) { el.focus(); el.select(); }
    });
  };
  const commitRename = async () => {
    if (!renaming) return;
    const { boardId, draft } = renaming;
    const trimmed = (draft || '').trim();
    setRenaming(null);
    const orig = boards?.[boardId]?.name || '';
    if (!trimmed || trimmed === orig) return;
    try { await onRenameBoard?.(boardId, trimmed); } catch {}
  };
  const cancelRename = () => setRenaming(null);

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

    const isRenaming = renaming?.boardId === board.id;
    return (
      <div key={board.id} className="sb-tree-node">
        <div className={`sb-row sb-tree-row ${isActive ? 'active' : ''} ${isRenaming ? 'is-renaming' : ''}`}
             style={{ paddingLeft: 6 + depth * 14 }}
             data-board-id={board.id}
             draggable={!isRenaming}
             onDragStart={(e) => {
               dragGestureRef.current.dragged = true;
               try {
                 e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: board.id, name: board.name }));
                 e.dataTransfer.effectAllowed = 'copy';
               } catch (_) {}
             }}
             onDragEnd={() => {
               // The stray click fires AFTER dragend in some browsers — clear
               // on the next macrotask so the click handler still sees the flag.
               setTimeout(() => { dragGestureRef.current.dragged = false; }, 0);
             }}
             onMouseEnter={() => hoverEnter(board.id)}
             onMouseLeave={hoverLeave}
             onClick={() => {
               if (dragGestureRef.current.dragged) {
                 dragGestureRef.current.dragged = false;
                 return;
               }
               if (!isRenaming) onOpenBoard?.(board.id);
             }}
             onDoubleClick={(e) => {
               // Double-click anywhere on the row enters rename mode.
               // Skip if the chevron caught it (let toggle do its thing).
               if (e.target.closest?.('.sb-tree-chev')) return;
               e.stopPropagation();
               beginRename(board);
             }}
             title={isRenaming ? '' : 'Click to open · double-click to rename · drag onto a canvas to embed'}>
          <button className="sb-tree-chev"
                  onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(board.id); }}
                  style={{ visibility: hasKids ? 'visible' : 'hidden' }}
                  tabIndex={hasKids ? 0 : -1}>
            {isOpen ? '▾' : '▸'}
          </button>
          <span className="sb-dot" style={{ background: isActive ? 'var(--soleil)' : tint }} />
          {isRenaming ? (
            <input ref={renameInputRef}
                   className="sb-tree-rename-input"
                   value={renaming.draft}
                   onChange={(e) => setRenaming(r => r ? { ...r, draft: e.target.value } : r)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                     if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                   }}
                   onBlur={commitRename}
                   onClick={(e) => e.stopPropagation()}
                   onDoubleClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="sb-row-label">{board.name || 'Untitled'}</span>
          )}
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

  // Touch DnD bridge: the HTML5 onDragStart on each row above is mouse-only.
  // For touch, we install a single capture-phase pointer listener at the
  // tree root that detects a hold-and-drag on a board row, follows the
  // pointer with a small ghost element, and on release dispatches a
  // 'soleil-touch-board-drop' CustomEvent that CanvasSurface listens for.
  const treeRef = useRef(null);
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    let drag = null;
    const THRESHOLD = 10;

    const startGhost = (name) => {
      const g = document.createElement('div');
      g.className = 'sb-tree-touch-ghost';
      g.textContent = name || 'Board';
      g.style.position = 'fixed';
      g.style.zIndex = '2000';
      g.style.pointerEvents = 'none';
      g.style.padding = '6px 10px';
      g.style.background = 'var(--bg-2, #1c1c20)';
      g.style.color = 'var(--ink-0, #f5f5f7)';
      g.style.border = '1px solid var(--line-2, #2c2c32)';
      g.style.borderRadius = '6px';
      g.style.font = '500 12px/1 var(--font-sans, sans-serif)';
      g.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
      document.body.appendChild(g);
      return g;
    };

    const onDown = (e) => {
      if (e.pointerType !== 'touch') return;
      const row = e.target.closest?.('.sb-tree-row');
      if (!row) return;
      // Ignore taps on the chevron toggle — that's expand/collapse, not drag.
      if (e.target.closest?.('.sb-tree-chev')) return;
      const boardId = row.dataset.boardId;
      if (!boardId) return;
      const name = row.querySelector('.sb-row-label')?.textContent || boardId;
      drag = { boardId, name, startX: e.clientX, startY: e.clientY, active: false, ghost: null };
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.active && (dx * dx + dy * dy) > THRESHOLD * THRESHOLD) {
        drag.active = true;
        dragGestureRef.current.dragged = true;
        drag.ghost = startGhost(drag.name);
      }
      if (drag.active) {
        drag.ghost.style.left = (e.clientX + 10) + 'px';
        drag.ghost.style.top  = (e.clientY + 10) + 'px';
      }
    };
    const onUp = (e) => {
      if (!drag) return;
      if (drag.active) {
        document.dispatchEvent(new CustomEvent('soleil-touch-board-drop', {
          detail: { boardId: drag.boardId, name: drag.name, clientX: e.clientX, clientY: e.clientY },
        }));
        drag.ghost?.remove();
        setTimeout(() => { dragGestureRef.current.dragged = false; }, 0);
      }
      drag = null;
    };

    el.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (drag?.ghost) drag.ghost.remove();
    };
  }, []);

  if (roots.length === 0) {
    return <div className="sb-tree-empty">No boards yet</div>;
  }

  return (
    <div className="sb-tree" ref={treeRef}>
      {roots.map(b => renderRow(b, 0))}
    </div>
  );
}
