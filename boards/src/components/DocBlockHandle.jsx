// Notion-style block handle — a small ⠿ affordance that fades in on the left
// of the hovered top-level block. Drag it to reorder, click to select.
//
// Implementation: a Tiptap extension that registers a single ProseMirror
// view plugin. The plugin owns one absolutely-positioned handle DIV inside
// the editor's parent. On mousemove inside the editor we figure out the
// nearest top-level block and move the handle to align with its top.
// Drag-and-drop uses HTML5 drag events; on drop we cut+paste the block via
// editor commands.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';

const HANDLE_KEY = new PluginKey('soleilDocBlockHandle');

function topLevelBlockAt(view, clientX, clientY) {
  const pos = view.posAtCoords({ left: clientX, top: clientY });
  if (!pos) return null;
  // Walk up to a block at depth 1 (top-level).
  const $pos = view.state.doc.resolve(pos.inside >= 0 ? pos.inside : pos.pos);
  let depth = $pos.depth;
  while (depth > 1 && $pos.node(depth).isInline) depth--;
  // Find the depth=1 ancestor.
  const targetDepth = 1;
  const start = $pos.before(Math.max(targetDepth, 1));
  const node = view.state.doc.nodeAt(start);
  if (!node) return null;
  return { pos: start, node, end: start + node.nodeSize };
}

export const BlockHandleExtension = Extension.create({
  name: 'soleilBlockHandle',
  addProseMirrorPlugins() {
    let handle = null;
    let currentBlock = null; // { pos, node, end }
    let dragging = null;     // { from, to }

    const positionHandle = (view, block) => {
      if (!handle) return;
      try {
        const dom = view.nodeDOM(block.pos);
        if (!dom) { handle.style.opacity = '0'; return; }
        const parent = view.dom.parentElement;
        const parentRect = parent.getBoundingClientRect();
        const blockRect = (dom.nodeType === 3 ? dom.parentElement : dom).getBoundingClientRect();
        handle.style.opacity = '1';
        handle.style.top = (blockRect.top - parentRect.top + 4) + 'px';
        handle.style.left = (blockRect.left - parentRect.left - 22) + 'px';
      } catch (_) {
        handle.style.opacity = '0';
      }
    };

    return [new Plugin({
      key: HANDLE_KEY,
      view(view) {
        const parent = view.dom.parentElement;
        if (!parent) return { destroy() {} };
        // Make the parent the positioning context for the handle.
        const prevPos = parent.style.position;
        if (!prevPos || prevPos === 'static') parent.style.position = 'relative';

        handle = document.createElement('div');
        handle.className = 'doc-block-handle';
        handle.contentEditable = 'false';
        handle.draggable = true;
        handle.title = 'Drag to move · click to select';
        handle.innerHTML = '<svg width="10" height="14" viewBox="0 0 10 14"><circle cx="3" cy="3" r="1.2" fill="currentColor"/><circle cx="7" cy="3" r="1.2" fill="currentColor"/><circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="3" cy="11" r="1.2" fill="currentColor"/><circle cx="7" cy="11" r="1.2" fill="currentColor"/></svg>';
        handle.style.position = 'absolute';
        handle.style.opacity = '0';
        handle.style.pointerEvents = 'auto';
        parent.appendChild(handle);

        const onMove = (e) => {
          const block = topLevelBlockAt(view, e.clientX, e.clientY);
          if (!block) { handle.style.opacity = '0'; currentBlock = null; return; }
          currentBlock = block;
          positionHandle(view, block);
        };
        const onLeave = (e) => {
          // Hide unless mouse is over the handle itself.
          if (!handle.contains(e.relatedTarget)) handle.style.opacity = '0';
        };
        view.dom.addEventListener('mousemove', onMove);
        view.dom.addEventListener('mouseleave', onLeave);

        handle.addEventListener('click', (e) => {
          if (!currentBlock) return;
          e.preventDefault();
          const sel = NodeSelection.create(view.state.doc, currentBlock.pos);
          view.dispatch(view.state.tr.setSelection(sel));
          view.focus();
        });

        handle.addEventListener('dragstart', (e) => {
          if (!currentBlock) return;
          dragging = { from: currentBlock.pos, to: currentBlock.end };
          // Suppress default DnD image (handle icon).
          try { e.dataTransfer.setDragImage(handle, 0, 0); } catch (_) {}
          e.dataTransfer.effectAllowed = 'move';
          // Encode an opaque marker so handleDrop knows it's a block move.
          try { e.dataTransfer.setData('application/x-soleil-block', '1'); } catch (_) {}
          // Also mirror as the node selection so PM's own DnD works as a fallback.
          const sel = NodeSelection.create(view.state.doc, currentBlock.pos);
          view.dispatch(view.state.tr.setSelection(sel));
        });

        handle.addEventListener('dragend', () => { dragging = null; });

        // Catch drops anywhere in the editor.
        const onDrop = (e) => {
          if (!dragging) return;
          const dropPos = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!dropPos) { dragging = null; return; }
          e.preventDefault();
          const { from, to } = dragging;
          const target = dropPos.pos;
          // Don't drop into the source range (no-op).
          if (target >= from && target <= to) { dragging = null; return; }
          const slice = view.state.doc.slice(from, to);
          const tr = view.state.tr;
          if (target > to) {
            tr.delete(from, to);
            tr.insert(target - (to - from), slice.content);
          } else {
            tr.insert(target, slice.content);
            tr.delete(from + slice.size, to + slice.size);
          }
          view.dispatch(tr);
          dragging = null;
        };
        view.dom.addEventListener('drop', onDrop);

        return {
          destroy() {
            view.dom.removeEventListener('mousemove', onMove);
            view.dom.removeEventListener('mouseleave', onLeave);
            view.dom.removeEventListener('drop', onDrop);
            if (handle && handle.parentElement) handle.parentElement.removeChild(handle);
            handle = null;
            currentBlock = null;
            dragging = null;
            if (parent && prevPos !== undefined) parent.style.position = prevPos;
          },
        };
      },
    })];
  },
});
