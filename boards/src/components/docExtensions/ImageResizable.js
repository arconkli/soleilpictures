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
// Exported for a doc upload, which knows the shape before the image node mounts.
export function rememberSize(src, w, h) {
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

// The image bar's icons in the doc look (components/doc/docLook.css): the
// look's bars draw Phosphor's regular, so these are its drawings (align left,
// centre and right, a full width's out-arrows, the bin), in place of today's
// glyphs.
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOOK_ICONS = {
  left: 'M48,40V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0Zm16,64V64A16,16,0,0,1,80,48h96a16,16,0,0,1,16,16v40a16,16,0,0,1-16,16H80A16,16,0,0,1,64,104Zm16,0h96V64H80Zm152,48v40a16,16,0,0,1-16,16H80a16,16,0,0,1-16-16V152a16,16,0,0,1,16-16H216A16,16,0,0,1,232,152Zm-16,40V152H80v40H216Z',
  center: 'M208,136H136V120h48a16,16,0,0,0,16-16V64a16,16,0,0,0-16-16H136V32a8,8,0,0,0-16,0V48H72A16,16,0,0,0,56,64v40a16,16,0,0,0,16,16h48v16H48a16,16,0,0,0-16,16v40a16,16,0,0,0,16,16h72v16a8,8,0,0,0,16,0V208h72a16,16,0,0,0,16-16V152A16,16,0,0,0,208,136ZM72,64H184v40H72ZM208,192H48V152H208v40Z',
  right: 'M224,40V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0ZM192,64v40a16,16,0,0,1-16,16H80a16,16,0,0,1-16-16V64A16,16,0,0,1,80,48h96A16,16,0,0,1,192,64Zm-16,0H80v40h96Zm16,88v40a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V152a16,16,0,0,1,16-16H176A16,16,0,0,1,192,152Zm-16,0H40v40H176Z',
  full: 'M136,40V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0ZM96,120H35.31l18.35-18.34A8,8,0,0,0,42.34,90.34l-32,32a8,8,0,0,0,0,11.32l32,32a8,8,0,0,0,11.32-11.32L35.31,136H96a8,8,0,0,0,0-16Zm149.66,2.34-32-32a8,8,0,0,0-11.32,11.32L220.69,120H160a8,8,0,0,0,0,16h60.69l-18.35,18.34a8,8,0,0,0,11.32,11.32l32-32A8,8,0,0,0,245.66,122.34Z',
  remove: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
};

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
      // The handle and the align bar sit in a frame shrink-wrapped to the
      // image. Placed on the full-width wrap, they floated at the column's
      // right edge and centre, nowhere near a centred 300px image.
      const frame = document.createElement('span');
      frame.className = 'tt-img-frame';
      frame.appendChild(img);
      dom.appendChild(frame);
      let curSrc = node.attrs.src || '';
      reserveSize(img, curSrc);
      img.addEventListener('load', () => rememberSize(curSrc, img.naturalWidth, img.naturalHeight));
      // Resolve r2: sentinels to signed URLs (auto-refreshes near TTL).
      let cancelR2 = applyR2Src(img, curSrc);

      // Resize handle (bottom-right). Only visible when the image is selected.
      const handle = document.createElement('div');
      handle.className = 'tt-img-resize';
      handle.title = 'Drag to resize';
      frame.appendChild(handle);

      // Alignment toolbar (top, floating). Only visible when selected.
      const tb = document.createElement('div');
      tb.className = 'tt-img-tb';
      tb.contentEditable = 'false';
      const mkBtn = (label, val, title) => {
        const b = document.createElement('button');
        b.type = 'button'; b.title = title; b.textContent = label;
        // The glyph alone named it "⇤" to a screen reader.
        b.setAttribute('aria-label', title);
        b.className = 'tt-img-tb-btn';
        b.dataset.icon = val || 'remove';
        // An alignment says whether it's the image's (update() keeps it).
        if (val) { b.dataset.align = val; b.setAttribute('aria-pressed', String(val === (node.attrs.align || 'center'))); }
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          if (!editor.isEditable) return;
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
        if (!editor.isEditable) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
      });
      tb.appendChild(remove);
      frame.appendChild(tb);
      const aligns = [...tb.querySelectorAll('[data-align]')];
      // Which look the bar is drawn in is the surface's it's on (the doc
      // look's is .dl-surface), known once the image is on the page: so at
      // its first selection, before the bar first shows.
      let drawn = false;
      const drawLook = () => {
        drawn = true;
        if (!dom.closest('.dl-surface')) return;
        for (const b of tb.querySelectorAll('.tt-img-tb-btn')) {
          const svg = document.createElementNS(SVG_NS, 'svg');
          for (const [k, v] of [['viewBox', '0 0 256 256'], ['width', '18'], ['height', '18'], ['fill', 'currentColor'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
          const path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', LOOK_ICONS[b.dataset.icon]);
          svg.appendChild(path);
          b.replaceChildren(svg);
          // The look's tooltip (components/toolbar/tipHost.js), not the browser's.
          b.dataset.tlTip = b.title;
          b.removeAttribute('title');
        }
      };

      // Where the bar goes: above the image while the view it scrolls in has
      // room for it there. Without room (the image opens the doc, or its top
      // has scrolled out of view, where a click on a half-seen image scrolls
      // it) the bar hung there anyway, clipped, and the selected image showed
      // none. Then it goes below, and with neither edge in view it rides at the
      // top of the part that shows. Measured while the image is selected.
      const GAP = 6;
      let clip = null;      // the ancestor that clips the page (.doc-paper)
      let placing = 0;
      const findClip = () => {
        for (let el = dom.parentElement; el && el !== document.body; el = el.parentElement) {
          if (getComputedStyle(el).overflowY !== 'visible') return el;
        }
        return null;
      };
      const placeBar = () => {
        placing = 0;
        const view = clip ? clip.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        const f = frame.getBoundingClientRect();
        // Screen px per page px: the doc's zoom scales the page, bar included.
        const k = frame.offsetHeight ? f.height / frame.offsetHeight : 1;
        const h = tb.offsetHeight * k;
        let place = 'above';
        let top = '';
        if (f.top - h < view.top) {
          if (f.bottom + h <= view.bottom) place = 'below';
          else {
            place = 'inside';
            const inset = (Math.max(view.top, f.top) - f.top) / k + GAP;
            top = `${Math.round(Math.max(0, Math.min(inset, frame.offsetHeight - tb.offsetHeight - GAP)))}px`;
          }
        }
        if (tb.dataset.place !== place) tb.dataset.place = place;
        if (tb.style.top !== top) tb.style.top = top;
      };
      const schedulePlace = () => { if (!placing) placing = requestAnimationFrame(placeBar); };
      const watchPlace = (on) => {
        if (on === !!clip) return;
        if (on) {
          clip = findClip() || document.documentElement;
          document.addEventListener('scroll', schedulePlace, { capture: true, passive: true });
          window.addEventListener('resize', schedulePlace);
          placeBar();
        } else {
          clip = null;
          document.removeEventListener('scroll', schedulePlace, { capture: true });
          window.removeEventListener('resize', schedulePlace);
          if (placing) cancelAnimationFrame(placing);
          placing = 0;
        }
      };

      // ── Resize logic ────────────────────────────────────────────────────
      // Widths are CSS px; the pointer moves in screen px. Under the doc's
      // CSS zoom the two differ, so the drag is scaled by the image's own
      // screen-to-CSS ratio — otherwise the edge trails or outruns the finger.
      let dragState = null; // { startX, startW, parentW, k, startStyle }
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        // A read-only reader (view-only member, public viewer): commands still
        // apply to a non-editable editor, so every image tool must bail here
        // or it rewrites a local copy the board room never accepts.
        if (!editor.isEditable) return;
        const cssW = parseFloat(getComputedStyle(img).width) || img.offsetWidth || 1;
        const screenW = img.getBoundingClientRect().width || cssW;
        const parentW = parseFloat(getComputedStyle(dom).width) || 760;
        dragState = { startX: e.clientX, startW: cssW, parentW, k: screenW / cssW || 1, startStyle: img.style.width };
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragState) return;
        const dx = (e.clientX - dragState.startX) / dragState.k;
        const next = Math.max(60, Math.min(dragState.parentW, dragState.startW + dx));
        img.style.width = Math.round(next) + 'px';
      });
      // A cancelled gesture (the OS took the touch, a scroll began) puts the
      // image back rather than committing a half-drag.
      handle.addEventListener('pointercancel', (e) => {
        if (!dragState) return;
        img.style.width = dragState.startStyle;
        dragState = null;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
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
        if (!editor.isEditable) return;
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
          dom.className = `tt-img-wrap tt-img-align-${updatedNode.attrs.align || 'center'}${clip ? ' is-selected' : ''}`;
          for (const b of aligns) b.setAttribute('aria-pressed', String(b.dataset.align === (updatedNode.attrs.align || 'center')));
          if (clip) schedulePlace();
          return true;
        },
        // No handles or align bar for a reader — they could only no-op.
        selectNode() {
          if (!editor.isEditable) return;
          if (!drawn) drawLook();
          dom.classList.add('is-selected');
          watchPlace(true);
        },
        deselectNode() { dom.classList.remove('is-selected'); watchPlace(false); },
        stopEvent(e) { return handle.contains(e.target) || tb.contains(e.target); },
        destroy() { cancelR2?.(); watchPlace(false); },
      };
    };
  },
});
