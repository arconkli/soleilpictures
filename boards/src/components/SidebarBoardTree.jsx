// Sidebar board tree — lazy expansion mirroring DocPageTree's pattern,
// but for boards instead of doc pages. Active row gets the existing
// .sb-row.active treatment so it visually matches Home / Messages.
//
// Per-row peer dots reuse the .bc-toc-peer styling from list-board
// preview rows, so the breadcrumb visual language is consistent
// across canvas → list rows → sidebar tree.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COVER_TINTS } from './primitives.jsx';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { BOARD_REF_MIME, BOARD_REF_LIST_MIME, readBoardRefIds } from '../lib/dragMimes.js';
import { wouldCreateCycle } from '../lib/boardTree.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { boardClipboardSize } from '../lib/boardClipboard.js';

const HOVER_PREFETCH_MS = 80;
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
  onCreateBoard = null,    // () => void — empty-state "create first board" CTA
  onCreateBoardInside,     // (parentBoardId) => void — context-menu "New board inside"
  onSetBoardCover,         // (boardId, coverKey|null) => void
  onSetBoardBgColor,       // (boardId, hex|null) => void
  onCopyBoard,             // (board) => void
  onPasteBoardInto,        // (targetBoardId) => void
  onDeleteBoard,           // (boardId) => void
  canEditBoard,            // (boardId) => boolean
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
  // Row currently highlighted as a reparent drop target.
  const [dropTargetId, setDropTargetId] = useState(null);
  // Right-click context menu: { open, x, y, board }.
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, board: null });
  const closeMenu = () => setMenu(m => ({ ...m, open: false }));
  // "Custom…" full color picker for bg_color: { boardId, value, x, y } | null.
  const [picker, setPicker] = useState(null);
  // Multi-select set for dragging several boards at once (cmd/shift-click).
  const [selectedTreeBoards, setSelectedTreeBoards] = useState(() => new Set());
  // Live boards map for the touch DnD listener (its effect deps are []).
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  // Ordered list of currently-visible board ids (for shift-range select),
  // populated during render.
  const visibleOrderRef = useRef([]);
  // Anchor row for shift-range selection.
  const lastClickedRef = useRef(null);
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

  // Expand a board's branch so a freshly-created/pasted child becomes visible.
  const expandBoard = (boardId) => {
    setExpanded(prev => {
      if (prev.has(boardId)) return prev;
      const next = new Set(prev);
      next.add(boardId);
      saveExpanded(workspaceId, next);
      return next;
    });
  };

  // Build the right-click context-menu items for a board row. Mutating items
  // are gated behind canEditBoard; Open + Copy are always available.
  const buildRowMenu = (board) => {
    const canEdit = canEditBoard ? canEditBoard(board.id) : false;
    const currentCover = board.cover || 'neutral';
    const items = [];

    items.push({ id: 'open', label: 'Open', run: () => onOpenBoard?.(board.id) });

    if (canEdit) {
      items.push({ id: 'rename', label: 'Rename', run: () => beginRename(board) });
      items.push({ divider: true });
      items.push({
        id: 'new-inside', label: 'New cluster inside',
        run: () => { expandBoard(board.id); onCreateBoardInside?.(board.id); },
      });
      items.push({
        id: 'color', label: 'Change color',
        submenu: [
          ...Object.keys(COVER_TINTS).map(k => ({
            id: `cover-${k}`,
            swatch: COVER_TINTS[k],
            label: k.charAt(0).toUpperCase() + k.slice(1),
            checked: currentCover === k,
            run: () => onSetBoardCover?.(board.id, k === 'neutral' ? null : k),
          })),
          { divider: true },
          {
            id: 'cover-custom', label: 'Custom…',
            run: () => setPicker({
              boardId: board.id,
              value: board.bg_color || '#1c1c1f',
              x: menu.x, y: menu.y,
            }),
          },
        ],
      });
      items.push({ divider: true });
    }

    items.push({ id: 'copy', label: 'Copy', run: () => onCopyBoard?.(board) });
    if (canEdit) {
      items.push({
        id: 'paste', label: 'Paste into this cluster',
        disabled: boardClipboardSize() === 0,
        run: () => onPasteBoardInto?.(board.id),
      });
      items.push({ divider: true });
      items.push({
        id: 'delete', label: 'Delete', danger: true,
        run: () => onDeleteBoard?.(board.id),
      });
    }

    return items;
  };

  // Reset expansion state when switching workspaces — we keep per-workspace
  // sets in localStorage so each workspace remembers its own open branches.
  useEffect(() => {
    setExpanded(loadExpanded(workspaceId));
    setSelectedTreeBoards(new Set());
    lastClickedRef.current = null;
  }, [workspaceId]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveExpanded(workspaceId, next);
      return next;
    });
  };

  // Ancestor chain of the active board: highlighted as the "you are here"
  // path, and auto-expanded so deep links / cross-board jumps never land
  // on a row hidden inside a collapsed branch.
  const activeAncestors = useMemo(() => {
    const set = new Set();
    let p = boards?.[activeBoardId]?.parent_board_id;
    let guard = 0;
    while (p && boards[p] && guard++ < 100) { set.add(p); p = boards[p].parent_board_id; }
    return set;
  }, [boards, activeBoardId]);
  useEffect(() => {
    if (activeAncestors.size === 0) return;
    setExpanded(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of activeAncestors) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      if (!changed) return prev;
      saveExpanded(workspaceId, next);
      return next;
    });
  }, [activeAncestors, workspaceId]);

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

  // Flattened visible board order (honoring expansion) for shift-range select.
  const visibleOrder = (() => {
    const out = [];
    const walk = (arr) => {
      for (const b of arr) {
        out.push(b.id);
        if (expanded.has(b.id)) walk(childrenByParent.get(b.id) || []);
      }
    };
    walk(roots);
    return out;
  })();
  visibleOrderRef.current = visibleOrder;

  // Click selection: plain = open + select-one; ⌘/Ctrl = toggle; Shift = range.
  const onRowClick = (e, board) => {
    if (dragGestureRef.current.dragged) { dragGestureRef.current.dragged = false; return; }
    if (renaming?.boardId === board.id) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedTreeBoards(prev => {
        const n = new Set(prev);
        if (n.has(board.id)) n.delete(board.id); else n.add(board.id);
        return n;
      });
      lastClickedRef.current = board.id;
      return;
    }
    if (e.shiftKey && lastClickedRef.current) {
      e.preventDefault();
      const order = visibleOrderRef.current;
      const a = order.indexOf(lastClickedRef.current);
      const b = order.indexOf(board.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelectedTreeBoards(new Set(order.slice(lo, hi + 1)));
        return;
      }
    }
    // Plain click — single-select + open.
    setSelectedTreeBoards(new Set([board.id]));
    lastClickedRef.current = board.id;
    onOpenBoard?.(board.id);
  };

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
    const isDropTarget = dropTargetId === board.id;
    const isSelected = selectedTreeBoards.has(board.id);
    return (
      <div key={board.id} className="sb-tree-node">
        <div className={`sb-row sb-tree-row ${isActive ? 'active' : ''} ${activeAncestors.has(board.id) ? 'is-ancestor' : ''} ${isRenaming ? 'is-renaming' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${isSelected ? 'is-selected' : ''}`}
             style={{ paddingLeft: 6 + depth * 14 }}
             data-board-id={board.id}
             draggable={!isRenaming}
             onDragStart={(e) => {
               dragGestureRef.current.dragged = true;
               // Drag the whole selection when this row is part of a multi-select.
               const ids = (selectedTreeBoards.size > 1 && selectedTreeBoards.has(board.id))
                 ? [...selectedTreeBoards]
                 : [board.id];
               try { window.__soleilBoardDrag = { boardIds: ids }; } catch (_) {}
               try {
                 e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: board.id, name: board.name }));
                 if (ids.length > 1) e.dataTransfer.setData(BOARD_REF_LIST_MIME, JSON.stringify(ids));
                 e.dataTransfer.effectAllowed = 'copyMove';
               } catch (_) {}
             }}
             onDragEnd={() => {
               try { window.__soleilBoardDrag = null; } catch (_) {}
               setDropTargetId(null);
               // The stray click fires AFTER dragend in some browsers — clear
               // on the next macrotask so the click handler still sees the flag.
               setTimeout(() => { dragGestureRef.current.dragged = false; }, 0);
             }}
             onDragOver={(e) => {
               const t = e.dataTransfer.types;
               if (!t.includes(BOARD_REF_MIME) && !t.includes(BOARD_REF_LIST_MIME)) return;
               // Read the dragged ids from the side-channel (dataTransfer.getData
               // isn't readable during dragover) to reject self / descendant /
               // already-a-child targets with a no-drop cursor (no highlight).
               const ids = (typeof window !== 'undefined' && window.__soleilBoardDrag?.boardIds) || [];
               const invalid = ids.length > 0 &&
                 (ids.includes(board.id) || ids.some(id => wouldCreateCycle(boardsRef.current, id, board.id)));
               if (invalid) { try { e.dataTransfer.dropEffect = 'none'; } catch (_) {} return; }
               e.preventDefault();
               try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
               if (dropTargetId !== board.id) setDropTargetId(board.id);
             }}
             onDragLeave={(e) => {
               if (e.currentTarget.contains?.(e.relatedTarget)) return;
               setDropTargetId(prev => (prev === board.id ? null : prev));
             }}
             onDrop={(e) => {
               setDropTargetId(null);
               const childIds = readBoardRefIds(e.dataTransfer);
               if (!childIds.length) return;
               e.preventDefault();
               e.stopPropagation();
               document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
                 detail: { childIds, targetId: board.id, sourceSurface: 'sidebar' },
               }));
             }}
             onMouseEnter={() => hoverEnter(board.id)}
             onMouseLeave={hoverLeave}
             onContextMenu={(e) => {
               // Right-click acts on THIS board only (not the multi-select set),
               // mirroring file-tree convention. preventDefault suppresses the
               // native menu; the contextmenu event is distinct from click so
               // it won't open the board or fight the drag/double-click paths.
               e.preventDefault();
               e.stopPropagation();
               setSelectedTreeBoards(new Set([board.id]));
               lastClickedRef.current = board.id;
               setMenu({ open: true, x: e.clientX, y: e.clientY, board });
             }}
             onClick={(e) => onRowClick(e, board)}
             onDoubleClick={(e) => {
               // Double-click anywhere on the row enters rename mode.
               // Skip if the chevron caught it (let toggle do its thing).
               if (e.target.closest?.('.sb-tree-chev')) return;
               e.stopPropagation();
               beginRename(board);
             }}
             title={isRenaming ? '' : 'Click to open · double-click to rename · drag onto another board to nest it'}>
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
        // If released over another board ROW, reparent (nest) into it. The
        // mouse path does this via HTML5 onDrop; mirror it for touch so the
        // two never diverge. Otherwise fall back to the canvas-embed event.
        const overRow = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('.sb-tree-row');
        const targetId = overRow?.dataset?.boardId || null;
        const valid = targetId && targetId !== drag.boardId &&
          !wouldCreateCycle(boardsRef.current, drag.boardId, targetId);
        if (valid) {
          document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
            detail: { childIds: [drag.boardId], targetId, sourceSurface: 'sidebar-touch' },
          }));
        } else {
          document.dispatchEvent(new CustomEvent('soleil-touch-board-drop', {
            detail: { boardId: drag.boardId, name: drag.name, clientX: e.clientX, clientY: e.clientY },
          }));
        }
        setDropTargetId(null);
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
    return (
      <div className="sb-tree-empty">
        <div>No boards yet</div>
        {onCreateBoard && (
          <button type="button" className="sb-tree-empty-cta" onClick={() => onCreateBoard()}>
            + Create your first board
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="sb-tree" ref={treeRef}>
      {roots.map(b => renderRow(b, 0))}
      {/* Portal to <body>: the sidebar list (.sb-list) has a scroll-edge
          mask-image + overflow-x:hidden that would otherwise CLIP this
          fixed-positioned menu to the sidebar's width — cutting off its right
          half and leaving the body-portaled submenu stranded far to the
          right. Rendering in <body> escapes the mask entirely. */}
      {createPortal(
        <CardContextMenu
          open={menu.open}
          x={menu.x}
          y={menu.y}
          items={menu.board ? buildRowMenu(menu.board) : []}
          onClose={closeMenu}
          workspaceId={workspaceId}
          boardId={menu.board?.id}
          card={null}
        />,
        document.body
      )}
      {picker && (
        <ColorPicker
          value={picker.value}
          onChange={(c) => onSetBoardBgColor?.(picker.boardId, c)}
          onClose={() => setPicker(null)}
          position={{ x: picker.x, y: picker.y }}
          allowTransparent
        />
      )}
    </div>
  );
}
