// Image extension with corner-drag resize + left/center/right/full alignment.
//
// Stores `width` (string like "420px" or "100%") and `align` ('left' |
// 'center' | 'right' | 'full') on the image node. A custom DOM NodeView
// wraps the <img> in a positioned container so we can render handles and a
// floating alignment toolbar that appear when the image is the current
// node-selection.

import Image from '@tiptap/extension-image';
import { resolveSrc, getSignedUrl } from '../../lib/r2.js';

// Apply a (possibly r2:-sentinel) src to an <img>. For r2: srcs we
// resolve to a fresh signed URL via the cache and schedule a refresh
// before the URL expires. Returns a cleanup fn to cancel the refresh.
function applyR2Src(img, src) {
  let cancelled = false;
  let refreshTimer = null;
  const set = async () => {
    const resolved = await resolveSrc(src);
    if (cancelled) return;
    if (resolved) img.src = resolved;
    if (typeof src === 'string' && src.startsWith('r2:')) {
      refreshTimer = setTimeout(async () => {
        if (cancelled) return;
        const fresh = await getSignedUrl(src.slice(3));
        if (!cancelled && fresh) img.src = fresh;
      }, 4 * 60 * 1000 - 30 * 1000);
    }
  };
  set();
  return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); };
}

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
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      if (node.attrs.width) img.style.width = node.attrs.width;
      img.draggable = false;
      dom.appendChild(img);
      // Resolve r2: sentinels to signed URLs (auto-refreshes near TTL).
      let cancelR2 = applyR2Src(img, node.attrs.src || '');

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
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') return false;
          if (updatedNode.attrs.src !== node.attrs.src) {
            cancelR2?.();
            cancelR2 = applyR2Src(img, updatedNode.attrs.src || '');
          }
          if (updatedNode.attrs.width !== img.style.width) img.style.width = updatedNode.attrs.width || '';
          dom.className = `tt-img-wrap tt-img-align-${updatedNode.attrs.align || 'center'}`;
          return true;
        },
        selectNode() { dom.classList.add('is-selected'); },
        deselectNode() { dom.classList.remove('is-selected'); },
        stopEvent(e) { return handle.contains(e.target) || tb.contains(e.target); },
        destroy() { cancelR2?.(); },
      };
    };
  },
});
