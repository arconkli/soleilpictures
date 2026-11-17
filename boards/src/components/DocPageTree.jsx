// Hierarchical page list shown on the left of the doc editor.
//
// Features:
//   - Click row → switch active page
//   - ▸ / ▾ chevron → expand/collapse, on this device only
//     (hooks/useDocTreeExpansion)
//   - Dbl-click name → inline rename
//   - Right-click row (or ⇧F10 / the Menu key on a focused row) → context menu
//     (rename / new sub-page / delete);
//     under a finger, a hold on the row opens the same menu
//   - HTML5 drag-drop → reorder (drop on row top/bottom) or nest
//                       (drop on row middle)
//   - "+" button on a row → insert new child
//   - "+ New page" at the bottom → root-level page

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildPageTree, addPage, deletePage, renamePage, movePage,
  getDocUndoManager, readPages, DOC_ORIGIN,
} from '../lib/docState.js';
import { byPageOrder } from '../lib/docPageEntries.js';
import { useDocTreeExpansion } from '../hooks/useDocTreeExpansion.js';
import { useLongPress } from '../hooks/useLongPress.js';
import { swallowNextClick } from '../lib/swallowClick.js';
import { CardContextMenu } from './CardContextMenu.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { Icon } from './Icon.jsx';
import { ChevronDown, ChevronRight, FileText, Plus } from '../lib/icons.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { shownAuthor } from '../lib/commentAuthor.js';

// Read at render, so the fallback follows the person's language.
const peerName = (peer) => shownAuthor(peer.user?.name) || t`Someone`;

export function DocPageTree({ ydoc, scope, boardId, pages, activePageId, onSelectPage, peers = [], onJumpToPeer,
                              // false → a view-only member or the public viewer. Their Y.Doc
                              // writes never leave the tab (the board room drops them), so
                              // add / rename / delete / reorder are not offered at all.
                              canEdit = true,
                              // Name for the page that replaces a deleted last page: the
                              // same card-title name DocSurface's empty-doc seed uses.
                              defaultName = t({ message: 'Untitled', context: 'default name' }) }) {
  const tree = buildPageTree(pages);
  const [renaming, setRenaming] = useState(null);  // page id
  const [draftName, setDraftName] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, side: 'before'|'after'|'inside' }
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0, pageId: null });
  const feedback = useFeedback();
  const fold = useDocTreeExpansion(boardId, scope?.cardId);

  // iOS Safari never fires contextmenu for a touch hold, so on a phone the
  // row menu (rename, new sub-page, delete) had no way in. A hold on a row
  // opens it at the finger, as the sidebar's clusters do, and the click the
  // lift leaves behind is swallowed so it doesn't also open the page (and
  // close the phone's drawer under the menu).
  const bodyRef = useRef(null);
  useLongPress(bodyRef, (x, y, e) => {
    if (!canEdit) return false;
    const row = e.target?.closest?.('.doc-tree-row');
    const pageId = row?.dataset?.pageId;
    // Not a row, or the row being named: the hold belongs to the text field.
    if (!pageId || e.target.closest?.('input')) return false;
    swallowNextClick({ held: true });
    setCtx({ open: true, x, y, pageId });
    return true;
  }, { ms: 480, tolerance: 8, pointerType: 'touch' });

  // The name a rename started from: finishing without changing it writes
  // nothing, so it can't put back a name someone else gave the page meanwhile.
  const renameFromRef = useRef('');
  const startRename = (p) => {
    if (!canEdit) return;
    renameFromRef.current = p.name || '';
    setRenaming(p.id);
    setDraftName(p.name || '');
  };
  // A page just made with "+" is selected with { keepOpen, naming }: the phone
  // drawer stays up while it is named (selecting normally closes it, which
  // hid the auto-focused name field and left the page "Untitled"), and its
  // editor doesn't take the caret from the name field. Finishing the name —
  // or cancelling it — selects it again the normal way.
  const justAddedRef = useRef(null);
  const finishAdded = (id) => {
    if (justAddedRef.current !== id) return;
    justAddedRef.current = null;
    onSelectPage(id);
  };
  const commitRename = () => {
    const id = renaming;
    const name = draftName.trim() || t({ message: 'Untitled', context: 'default name' });
    if (id && name !== renameFromRef.current) renamePage(ydoc, id, name, scope);
    setRenaming(null);
    if (id) finishAdded(id);
  };
  const cancelRename = () => {
    const id = renaming;
    setRenaming(null);
    if (id) finishAdded(id);
  };

  const onAddRoot = () => {
    const untitled = t({ message: 'Untitled', context: 'default name' });
    const id = addPage(ydoc, { name: untitled, scope });
    justAddedRef.current = id;
    onSelectPage(id, { keepOpen: true, naming: true });
    setTimeout(() => { renameFromRef.current = untitled; setRenaming(id); setDraftName(''); }, 0);
  };
  const onAddChild = (parentId) => {
    const untitled = t({ message: 'Untitled', context: 'default name' });
    const id = addPage(ydoc, { parent_id: parentId, name: untitled, scope });
    fold.setOpen(parentId, true);
    justAddedRef.current = id;
    onSelectPage(id, { keepOpen: true, naming: true });
    setTimeout(() => { renameFromRef.current = untitled; setRenaming(id); setDraftName(''); }, 0);
  };

  const buildContextMenuItems = (pageId) => {
    const p = pages.find(x => x.id === pageId);
    if (!p) return [];
    return [
      { id: 'rename', label: t`Rename…`, icon: 'PencilSimple', run: () => startRename(p) },
      { id: 'addchild', label: t`New sub-page`, icon: 'FilePlus', run: () => onAddChild(pageId) },
      { divider: true },
      { id: 'delete', label: t`Delete`, icon: 'Trash', danger: true, run: async () => {
        // Leaf pages match the canvas convention: no confirm, an Undo toast
        // instead. A page WITH sub-pages keeps the dialog (whole-subtree
        // cascade) — but is now just as undoable: deletePage runs in one
        // DOC_ORIGIN transaction, so the doc UndoManager reverses the pages,
        // their content fragments, sheets, bookmarks and comment threads in
        // a single step.
        const hasChildren = pages.some(x => x.parent_id === pageId);
        if (hasChildren) {
          const pageLabel = p.name || t`Untitled`;
          const ok = await feedback.confirm({
            title: t`Delete "${pageLabel}"?`,
            message: t`Any sub-pages will be deleted too.\n\nYou can undo this right after.`,
            danger: true,
            confirmLabel: t`Delete`,
          });
          if (!ok) return;
        }
        const um = getDocUndoManager(ydoc, scope);
        um?.stopCapturing();
        // Deleting the last page: its replacement is created in the SAME
        // DOC_ORIGIN transaction. Left to DocSurface's empty-doc seed, the
        // new page became its own undo step on top of the delete, so the
        // toast's Undo only said "the board changed since" and the doc looked
        // gone. One step now: Undo brings the page back and drops the blank.
        let replacement = null;
        ydoc.transact(() => {
          deletePage(ydoc, pageId, scope);
          if (!readPages(ydoc, scope).length) replacement = addPage(ydoc, { name: defaultName || t({ message: 'Untitled', context: 'default name' }), scope });
        }, DOC_ORIGIN);
        const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
        um?.stopCapturing();
        if (activePageId === pageId || replacement) {
          const next = replacement || pages.find(x => x.id !== pageId)?.id || null;
          onSelectPage(next);
        }
        undoToast(feedback, {
          message: hasChildren ? t`Page and its sub-pages deleted` : t`Page deleted`,
          undoManager: um,
          stackItem: item,
          onUndo: () => {
            try { um?.undo(); } catch (_) {}
            onSelectPage(pageId);
          },
        });
      }},
    ];
  };

  // Drag handlers compute drop side from the y-position within the row.
  // Also encode the page as a doc-page reference so dragging onto a canvas
  // drops a boardlink to this doc (and stashes the pageId for future deep-
  // linking).
  const onDragStart = (e, p) => {
    // The hold that opened the menu also starts a native drag on a phone: no
    // reorder under an open menu.
    if (ctx.open) { e.preventDefault(); return; }
    setDragId(p.id);
    try {
      e.dataTransfer.setData('text/plain', p.id);
      if (boardId) {
        e.dataTransfer.setData('application/x-soleil-doc-page', JSON.stringify({
          boardId, pageId: p.id, pageName: p.name || t({ message: 'Untitled', context: 'default name' }),
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
    // Each drop is its own undo step — two quick rearrangements must not
    // coalesce into one Cmd+Z (500ms captureTimeout).
    getDocUndoManager(ydoc, scope)?.stopCapturing();
    if (dropTarget.side === 'inside') {
      movePage(ydoc, dragId, target.id, 9999, scope);
      fold.setOpen(target.id, true);
    } else {
      const siblings = pages
        .filter(x => (x.parent_id ?? null) === (target.parent_id ?? null) && x.id !== dragId)
        .sort(byPageOrder);
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
    const isOpen = fold.isOpen(p);
    const hasKids = pages.some(x => x.parent_id === p.id);
    const drop = dropTarget && dropTarget.id === p.id ? dropTarget.side : null;
    const pagePeers = peersByPage.get(p.id) || [];
    return (
      <div key={p.id} className="doc-tree-node">
        <div className={`doc-tree-row ${isActive ? 'is-active' : ''} ${drop ? `drop-${drop}` : ''}`}
             data-page-id={p.id}
             draggable={canEdit && renaming !== p.id}
             style={{ paddingLeft: 6 + depth * 16 }}
             onDragStart={(e) => onDragStart(e, p)}
             onDragOver={(e) => onDragOver(e, p)}
             onDragLeave={onDragLeave}
             onDrop={(e) => onDrop(e, p)}
             onClick={() => onSelectPage(p.id)}
             onDoubleClick={() => startRename(p)}
             tabIndex={canEdit ? 0 : undefined}
             onKeyDown={(e) => {
               // ⇧F10 / the Menu key on the focused row (not a key typed in its name field).
               if (!canEdit || e.target !== e.currentTarget) return;
               if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
               e.preventDefault();
               const r = e.currentTarget.getBoundingClientRect();
               setCtx({ open: true, x: r.left + 24, y: r.bottom, pageId: p.id, byKey: true, returnEl: e.currentTarget });
             }}
             onContextMenu={(e) => {
               // View-only people get no menu, and the browser's own comes through.
               if (!canEdit) return;
               e.preventDefault();
               setCtx({ open: true, x: e.clientX, y: e.clientY, pageId: p.id });
             }}>
          <button className="doc-tree-chev"
                  aria-label={isOpen ? t`Collapse` : t`Expand`}
                  aria-expanded={isOpen}
                  onClick={(e) => { e.stopPropagation(); if (hasKids) fold.setOpen(p.id, !isOpen); }}
                  style={{ visibility: hasKids ? 'visible' : 'hidden' }}>
            <Icon as={isOpen ? ChevronDown : ChevronRight} size={11} />
          </button>
          <Icon as={FileText} size={16} className="doc-tree-ico" />
          {renaming === p.id ? (
            <input className="doc-tree-rename" dir="auto"
                   autoFocus
                   aria-label={t`Page name`}
                   value={draftName}
                   onChange={(e) => setDraftName(e.target.value)}
                   onFocus={(e) => e.target.select()}
                   onBlur={commitRename}
                   onKeyDown={(e) => {
                     // Mid-syllable, Enter commits the syllable, not the name.
                     if (isComposingKey(e)) return;
                     if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                     if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                   }}
                   onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className="doc-tree-name" dir="auto">{p.name || t`Untitled`}</span>
          )}
          {pagePeers.length > 0 && (
            <span className="doc-tree-peers">
              {pagePeers.slice(0, 3).map(peer => (
                // Real button (matches SidebarBoardTree's peer dots) — a span
                // with onClick was invisible to keyboard + screen readers.
                <button key={peer.tabId || peer.user?.id}
                        type="button"
                        className="doc-tree-peer"
                        title={t`${ph({ name: peerName(peer) })} — jump here`}
                        aria-label={t`${ph({ name: peerName(peer) })} is editing this page — jump to them`}
                        style={{ background: peer.user?.color || '#4f8df8' }}
                        onClick={(e) => { e.stopPropagation(); onJumpToPeer?.(peer.location); }} />
              ))}
              {pagePeers.length > 3 && (
                <span className="doc-tree-peers-overflow">+{pagePeers.length - 3}</span>
              )}
            </span>
          )}
          {canEdit && (
          <button className="doc-tree-add"
                  title={t`Add sub-page`}
                  aria-label={t`Add sub-page`}
                  onClick={(e) => { e.stopPropagation(); onAddChild(p.id); }}><Icon as={Plus} size={14} /></button>
          )}
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
        <span className="doc-tree-kicker"><Trans>Pages</Trans></span>
        {canEdit && <button className="doc-tree-add-root" title={t`New page`} aria-label={t`New page`} onClick={onAddRoot}><Icon as={Plus} size={16} /></button>}
      </div>
      <div className="doc-tree-body" ref={bodyRef}>
        {tree.length === 0 ? (canEdit ? (
          <button className="doc-tree-empty" onClick={onAddRoot}>
            <span className="doc-tree-empty-plus" aria-hidden="true">+</span>
            <span className="doc-tree-empty-title"><Trans>Add your first page</Trans></span>
            <span className="doc-tree-empty-sub"><Trans>Start writing — pages live here.</Trans></span>
          </button>
        ) : (
          <div className="doc-tree-empty is-readonly">
            <span className="doc-tree-empty-title"><Trans>No pages yet</Trans></span>
          </div>
        )) : tree.map(p => renderRow(p, 0))}
      </div>

      {/* To <body>: inside the tree's column the page drew over it. */}
      {createPortal(<CardContextMenu
        open={ctx.open}
        x={ctx.x}
        y={ctx.y}
        items={ctx.pageId ? buildContextMenuItems(ctx.pageId) : []}
        byKey={!!ctx.byKey}
        returnFocus={ctx.returnEl}
        root="menu"
        onClose={() => setCtx(c => ({ ...c, open: false }))}
      />, document.body)}
    </div>
  );
}
