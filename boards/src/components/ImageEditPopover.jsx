// Compact photo-edit popover. Portaled to document.body (cards live in a
// transformed canvas layer, so a position:fixed descendant would otherwise
// re-anchor to the transform). Placed flush BESIDE the image it edits (right →
// left → below → above) so it never covers the photo, and draggable by its
// header (the TweaksPanel pattern) to reposition it anywhere on screen.

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { ImageAdjustPanel } from './ImageAdjustPanel.jsx';
import { swallowContextMenu } from '../lib/contextMenuGuard.js';

const PANEL_W = 256;
const PAD = 10;
const GAP = 10;   // gap between the image edge and the panel

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The bottom of the space the panel may use. On the phone shell the bottom
// nav and its raised + button are fixed over the page; clamping to the window
// alone parked Reset on top of the nav with the gold + glowing through it.
function usableHeight() {
  const vh = window.innerHeight;
  let bottom = vh;
  for (const el of document.querySelectorAll('.mb-nav, .mb-nav-create, .mb-nav-create-fab')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < bottom) bottom = r.top;
  }
  // Never let a stray fixed bar squeeze the panel to nothing.
  return Math.max(bottom, Math.min(vh, 240));
}

// Place the panel flush beside the image rect, never overlapping it.
function placeBeside(rect, w, h, vw, vh) {
  const topAligned = clamp(rect.top, PAD, vh - h - PAD);
  if (rect.right + GAP + w <= vw - PAD)         // right
    return { left: rect.right + GAP, top: topAligned };
  if (rect.left - GAP - w >= PAD)               // left
    return { left: rect.left - GAP - w, top: topAligned };
  const centered = clamp(rect.left + rect.width / 2 - w / 2, PAD, vw - w - PAD);
  if (rect.bottom + GAP + h <= vh - PAD)        // below
    return { left: centered, top: rect.bottom + GAP };
  if (rect.top - GAP - h >= PAD)                // above
    return { left: centered, top: rect.top - GAP - h };
  return { left: vw - w - PAD, top: topAligned }; // fallback: pin to right edge
}

export function ImageEditPopover({ anchorRect, adjust, onChange, onReset, onExpand,
                                   onCompareStart, onCompareEnd, onClose }) {
  const ref = useRef(null);
  const movedRef = useRef(false);   // user dragged → stop re-anchoring to the image
  useDismissOnOutside(ref, true, onClose);

  const [style, setStyle] = useState(() => anchorRect ? {
    position: 'fixed',
    left: clamp(anchorRect.right + GAP, PAD, window.innerWidth - PANEL_W - PAD),
    top: clamp(anchorRect.top, PAD, usableHeight() - PAD),
    visibility: 'hidden',
  } : undefined);

  const aKey = anchorRect ? `${anchorRect.left},${anchorRect.top},${anchorRect.width},${anchorRect.height}` : null;
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vw = window.innerWidth, vh = usableHeight();
      const w = el.offsetWidth || PANEL_W;
      // Natural height (scrollHeight: a capped panel still reports its full
      // content), then capped to the usable height so a panel taller than a
      // phone's space scrolls inside instead of running under the nav.
      const maxH = vh - 2 * PAD;
      const capped = el.scrollHeight > maxH;
      const h = capped ? maxH : (el.offsetHeight || 0);
      const fit = capped ? { maxHeight: maxH, overflowY: 'auto' } : {};
      if (movedRef.current) {
        // keep the user's position, just re-clamp into the viewport
        setStyle((prev) => {
          if (!prev) return prev;
          const left = clamp(parseFloat(prev.left) || PAD, PAD, vw - w - PAD);
          const top = clamp(parseFloat(prev.top) || PAD, PAD, vh - h - PAD);
          return { position: 'fixed', left, top, ...fit };
        });
        return;
      }
      const { left, top } = placeBeside(anchorRect, w, h, vw, vh);
      setStyle((prev) => {
        if (prev && prev.left === left && prev.top === top && prev.position === 'fixed' && !prev.visibility
          && prev.maxHeight === fit.maxHeight) return prev;
        return { position: 'fixed', left, top, ...fit };
      });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', place);
    };
  }, [aKey]);

  // Drag the whole panel by its header (TweaksPanel pattern). Screen-space, so
  // deltas are raw pixels (no zoom division).
  const onPointerDown = (e) => {
    e.stopPropagation();
    const onHeader = e.target.closest?.('.iap-head') && !e.target.closest?.('button');
    if (!onHeader) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startLeft = r.left, startTop = r.top;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vh = usableHeight();
    const move = (ev) => {
      movedRef.current = true;
      setStyle((prev) => ({
        position: 'fixed',
        left: clamp(startLeft + (ev.clientX - sx), PAD, window.innerWidth - w - PAD),
        top: clamp(startTop + (ev.clientY - sy), PAD, vh - h - PAD),
        ...(prev?.maxHeight ? { maxHeight: prev.maxHeight, overflowY: 'auto' } : {}),
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const node = (
    <div className="iep-pop" ref={ref} style={style}
         onPointerDown={onPointerDown}
         onMouseDown={(e) => e.stopPropagation()}
         onClick={(e) => e.stopPropagation()}
         onDoubleClick={(e) => e.stopPropagation()}
         onContextMenu={swallowContextMenu}
         onWheel={(e) => e.stopPropagation()}>
      <ImageAdjustPanel adjust={adjust} mode="compact"
                        onChange={onChange} onReset={onReset} onExpand={onExpand}
                        onCompareStart={onCompareStart} onCompareEnd={onCompareEnd} />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default ImageEditPopover;
