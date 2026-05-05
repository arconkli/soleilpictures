// Image extension with corner-drag resize + left/center/right/full alignment.
//
// Stores `width` (string like "420px" or "100%") and `align` ('left' |
// 'center' | 'right' | 'full') on the image node. A custom DOM NodeView
// wraps the <img> in a positioned container so we can render handles and a
// floating alignment toolbar that appear when the image is the current
// node-selection.

import Image from '@tiptap/extension-image';

export const ImageResizable = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.style.width || el.getAttribute('width') || null,
        renderHTML: (attrs) => attrs.width ? { style: `width: ${attrs.width}` } : {},
      },
      align: {
        default: 'center',
        parseHTML: (el) => el.getAttribute('data-align') || 'center',
        renderHTML: (attrs) => attrs.align ? { 'data-align': attrs.align } : {},
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = `tt-img-wrap tt-img-align-${node.attrs.align || 'center'}`;
      dom.contentEditable = 'false';

      const img = document.createElement('img');
      img.className = 'tt-img';
      img.src = node.attrs.src || '';
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      if (node.attrs.width) img.style.width = node.attrs.width;
      img.draggable = false;
      dom.appendChild(img);

      // Resize handle (bottom-right). Only visible when the image is selected.
      const handle = document.createElement('div');
      handle.className = 'tt-img-resize';
      handle.title = 'Drag to resize';
      dom.appendChild(handle);

      // Alignment toolbar (top, floating). Only visible when selected.
      const tb = document.createElement('div');
      tb.className = 'tt-img-tb';
      tb.contentEditable = 'false';
      const mkBtn = (label, val, title) => {
        const b = document.createElement('button');
        b.type = 'button'; b.title = title; b.textContent = label;
        b.className = 'tt-img-tb-btn';
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { align: val }).run();
        });
        return b;
      };
      tb.appendChild(mkBtn('⇤', 'left', 'Align left'));
      tb.appendChild(mkBtn('≡', 'center', 'Align center'));
      tb.appendChild(mkBtn('⇥', 'right', 'Align right'));
      tb.appendChild(mkBtn('▭', 'full', 'Full width'));
      const sep = document.createElement('span'); sep.className = 'tt-img-tb-sep'; tb.appendChild(sep);
      const remove = mkBtn('×', null, 'Delete image');
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
      });
      tb.appendChild(remove);
      dom.appendChild(tb);

      // ── Resize logic ────────────────────────────────────────────────────
      let dragState = null; // { startX, startW, parentW }
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const parentW = (img.parentElement?.parentElement?.clientWidth) || 760;
        dragState = { startX: e.clientX, startW: img.offsetWidth, parentW };
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const next = Math.max(60, Math.min(dragState.parentW, dragState.startW + dx));
        img.style.width = next + 'px';
      });
      handle.addEventListener('pointerup', (e) => {
        if (!dragState) return;
        const finalW = img.style.width;
        dragState = null;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null && finalW) {
          editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { width: finalW }).run();
        }
      });

      // Click image → select the node so handles + toolbar reveal.
      img.addEventListener('click', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null) editor.chain().focus().setNodeSelection(pos).run();
      });

      return {
        dom,
        // Update on attribute changes (alignment, width via toolbar, etc.).
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') return false;
          if (updatedNode.attrs.src !== node.attrs.src) img.src = updatedNode.attrs.src || '';
          if (updatedNode.attrs.width !== img.style.width) img.style.width = updatedNode.attrs.width || '';
          dom.className = `tt-img-wrap tt-img-align-${updatedNode.attrs.align || 'center'}`;
          return true;
        },
        selectNode() { dom.classList.add('is-selected'); },
        deselectNode() { dom.classList.remove('is-selected'); },
        stopEvent(e) { return handle.contains(e.target) || tb.contains(e.target); },
      };
    };
  },
});
