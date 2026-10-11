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

// Remembered natural sizes, keyed by src. An r2: image resolves its signed
// URL asynchronously and reserved no height until it decoded, so every image
// above the reader popped open late and shoved the page down mid-scroll.
// Once we've seen an image we know its shape: the next mount sets the
// <img> width/height attributes up front (browsers map those to an
// aspect-ratio), so the box is the right height before a byte arrives.
// localStorage so a reopened doc — the common case — is stable from the
// first frame; capped so it can't grow without bound.
const SIZE_KEY = 'soleil.boards.docImgSizes';
const SIZE_CAP = 400;
let sizeCache = null;
function sizes() {
  if (sizeCache) return sizeCache;
  sizeCache = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_KEY) || '[]');
    if (Array.isArray(raw)) for (const [k, w, h] of raw) if (k && w > 0 && h > 0) sizeCache.set(k, [w, h]);
  } catch (_) {}
  return sizeCache;
}
function rememberSize(src, w, h) {
  if (!src || !(w > 0) || !(h > 0)) return;
  const m = sizes();
  const prev = m.get(src);
  if (prev && prev[0] === w && prev[1] === h) return;
  m.delete(src);
  m.set(src, [w, h]);
  while (m.size > SIZE_CAP) m.delete(m.keys().next().value);
  try { localStorage.setItem(SIZE_KEY, JSON.stringify([...m].map(([k, [a, b]]) => [k, a, b]))); } catch (_) {}
}
function reserveSize(img, src) {
  const known = src ? sizes().get(src) : null;
  if (known) { img.width = known[0]; img.height = known[1]; }
  else { img.removeAttribute('width'); img.removeAttribute('height'); }
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
      let curSrc = node.attrs.src || '';
      reserveSize(img, curSrc);
      img.addEventListener('load', () => rememberSize(curSrc, img.naturalWidth, img.naturalHeight));
      // Resolve r2: sentinels to signed URLs (auto-refreshes near TTL).
      let cancelR2 = applyR2Src(img, curSrc);

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
          if ((updatedNode.attrs.src || '') !== curSrc) {
            cancelR2?.();
            curSrc = updatedNode.attrs.src || '';
            reserveSize(img, curSrc);
            cancelR2 = applyR2Src(img, curSrc);
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
