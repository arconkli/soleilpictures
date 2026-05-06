// Hierarchical page list shown on the left of the doc editor.
//
// Features:
//   - Click row → switch active page
//   - ▸ / ▾ chevron → expand/collapse
//   - Dbl-click name → inline rename
//   - Right-click row → context menu (rename / duplicate-as-child / delete)
//   - HTML5 drag-drop → reorder (drop on row top/bottom) or nest
//                       (drop on row middle)
//   - "+" button on a row → insert new child
//   - "+ New page" at the bottom → root-level page

import { useState } from 'react';
import {
  buildPageTree, addPage, deletePage, renamePage, movePage, setPageExpanded,
} from '../lib/docState.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { useFeedback } from './AppFeedback.jsx';

export function DocPageTree({ ydoc, scope, boardId, pages, activePageId, onSelectPage, peers = [], onJumpToPeer }) {
  const tree = buildPageTree(pages);
  const [renaming, setRenaming] = useState(null);  // page id
  const [draftName, setDraftName] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, side: 'before'|'after'|'inside' }
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0, pageId: null });
  const feedback = useFeedback();

  const startRename = (p) => { setRenaming(p.id); setDraftName(p.name || ''); };
  const commitRename = () => {
    if (renaming) renamePage(ydoc, renaming, draftName.trim() || 'Untitled', scope);
    setRenaming(null);
  };

  const onAddRoot = () => {
    const id = addPage(ydoc, { scope });
    onSelectPage(id);
    setTimeout(() => { setRenaming(id); setDraftName(''); }, 0);
  };
  const onAddChild = (parentId) => {
    const id = addPage(ydoc, { parent_id: parentId, scope });
    setPageExpanded(ydoc, parentId, true, scope);
    onSelectPage(id);
    setTimeout(() => { setRenaming(id); setDraftName(''); }, 0);
  };

  const buildContextMenuItems = (pageId) => {
    const p = pages.find(x => x.id === pageId);
    if (!p) return [];
    return [
      { id: 'rename', label: 'Rename', run: () => startRename(p) },
      { id: 'addchild', label: 'New sub-page', run: () => onAddChild(pageId) },
      { divider: true },
      { id: 'delete', label: 'Delete', danger: true, run: async () => {
        const ok = await feedback.confirm({
          title: `Delete "${p.name || 'Untitled'}"?`,
          message: 'Any sub-pages will be deleted too.',
          danger: true,
          confirmLabel: 'Delete',
        });
        if (ok) {
          deletePage(ydoc, pageId, scope);
          if (activePageId === pageId) {
            const next = pages.find(x => x.id !== pageId);
            onSelectPage(next ? next.id : null);
          }
        }
      }},
    ];
  };

  // Drag handlers compute drop side from the y-position within the row.
  // Also encode the page as a doc-page reference so dragging onto a canvas
  // drops a boardlink to this doc (and stashes the pageId for future deep-
  // linking).
  const onDragStart = (e, p) => {
    setDragId(p.id);
    try {
      e.dataTransfer.setData('text/plain', p.id);
      if (boardId) {
        e.dataTransfer.setData('application/x-soleil-doc-page', JSON.stringify({
          boardId, pageId: p.id, pageName: p.name || 'Untitled',
        }));
      }
    } catch (_) {}
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const onDragOver = (e, p) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragId || dragId === p.id) { setDropTarget(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - r.top) / r.height;
    const side = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    if (!dropTarget || dropTarget.id !== p.id || dropTarget.side !== side) {
      setDropTarget({ id: p.id, side });
    }
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropTarget(null);
  };
  const onDrop = (e, p) => {
    e.preventDefault();
    if (!dragId || !dropTarget) { resetDrag(); return; }
    const target = pages.find(x => x.id === p.id);
    if (!target) { resetDrag(); return; }
    if (dropTarget.side === 'inside') {
      movePage(ydoc, dragId, target.id, 9999, scope);
      setPageExpanded(ydoc, target.id, true, scope);
    } else {
      const siblings = pages
        .filter(x => x.parent_id === target.parent_id && x.id !== dragId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = siblings.findIndex(x => x.id === target.id);
      const insertAt = dropTarget.side === 'before' ? idx : idx + 1;
      movePage(ydoc, dragId, target.parent_id, insertAt, scope);
    }
    resetDrag();
  };
  const resetDrag = () => { setDragId(null); setDropTarget(null); };

  // Group peers by the pageId they're currently on. Map of pageId →
  // [peer, ...] so renderRow can pluck the relevant ones in O(1).
  const peersByPage = new Map();
  for (const peer of peers) {
    const pid = peer?.location?.pageId;
    if (!pid) continue;
    if (!peersByPage.has(pid)) peersByPage.set(pid, []);
    peersByPage.get(pid).push(peer);
  }

  const renderRow = (p, depth) => {
    const isActive = p.id === activePageId;
    const isOpen = p.expanded !== false;
    const hasKids = pages.some(x => x.parent_id === p.id);
    const drop = dropTarget && dropTarget.id === p.id ? dropTarget.side : null;
    const pagePeers = peersByPage.get(p.id) || [];
    return (
      <div key={p.id} className="doc-tree-node">
        <div className={`doc-tree-row ${isActive ? 'is-active' : ''} ${drop ? `drop-${drop}` : ''}`}
             draggable={renaming !== p.id}
             style={{ paddingLeft: 6 + depth * 14 }}
             onDragStart={(e) => onDragStart(e, p)}
             onDragOver={(e) => onDragOver(e, p)}
             onDragLeave={onDragLeave}
             onDrop={(e) => onDrop(e, p)}
             onClick={() => onSelectPage(p.id)}
             onDoubleClick={() => startRename(p)}
             onContextMenu={(e) => {
               e.preventDefault();
               setCtx({ open: true, x: e.clientX, y: e.clientY, pageId: p.id });
             }}>
          <button className="doc-tree-chev"
                  onClick={(e) => { e.stopPropagation(); if (hasKids) setPageExpanded(ydoc, p.id, !isOpen, scope); }}
                  style={{ visibility: hasKids ? 'visible' : 'hidden' }}>
            {isOpen ? '▾' : '▸'}
          </button>
          {renaming === p.id ? (
            <input className="doc-tree-rename"
                   autoFocus
                   value={draftName}
                   onChange={(e) => setDraftName(e.target.value)}
                   onBlur={commitRename}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                     if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                   }}
                   onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="doc-tree-name">{p.name || 'Untitled'}</span>
          )}
          {pagePeers.length > 0 && (
            <span className="doc-tree-peers">
              {pagePeers.slice(0, 3).map(peer => (
                <span key={peer.tabId || peer.user?.id}
                      className="doc-tree-peer"
                      title={`${peer.user?.name || 'Someone'} — jump here`}
                      style={{ background: peer.user?.color || '#4f8df8' }}
                      onClick={(e) => { e.stopPropagation(); onJumpToPeer?.(peer.location); }} />
              ))}
              {pagePeers.length > 3 && (
                <span className="doc-tree-peers-overflow">+{pagePeers.length - 3}</span>
              )}
            </span>
          )}
          <button className="doc-tree-add"
                  title="Add sub-page"
                  onClick={(e) => { e.stopPropagation(); onAddChild(p.id); }}>+</button>
        </div>
        {isOpen && p.children?.length > 0 && (
          <div className="doc-tree-children">
            {p.children.map(c => renderRow(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="doc-tree">
      <div className="doc-tree-head">
        <span className="doc-tree-kicker">Pages</span>
        <button className="doc-tree-add-root" title="New page" onClick={onAddRoot}>+</button>
      </div>
      <div className="doc-tree-body">
        {tree.length === 0 ? (
          <button className="doc-tree-empty" onClick={onAddRoot}>+ Add the first page</button>
        ) : tree.map(p => renderRow(p, 0))}
      </div>

      <CardContextMenu
        open={ctx.open}
        x={ctx.x}
        y={ctx.y}
        items={ctx.pageId ? buildContextMenuItems(ctx.pageId) : []}
        onClose={() => setCtx(c => ({ ...c, open: false }))}
      />
    </div>
  );
}
