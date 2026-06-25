// Compact photo-edit popover. Portaled to document.body (cards live in a
// transformed canvas layer, so a position:fixed descendant would otherwise
// re-anchor to the transform). Placed flush BESIDE the image it edits (right →
// left → below → above) so it never covers the photo, and draggable by its
// header (the TweaksPanel pattern) to reposition it anywhere on screen.

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { ImageAdjustPanel } from './ImageAdjustPanel.jsx';

const PANEL_W = 256;
const PAD = 10;
const GAP = 10;   // gap between the image edge and the panel

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

export function ImageEditPopover({ anchorRect, adjust, onChange, onReset, onDownload, onExpand,
                                   onCompareStart, onCompareEnd, onClose }) {
  const ref = useRef(null);
  const movedRef = useRef(false);   // user dragged → stop re-anchoring to the image
  useDismissOnOutside(ref, true, onClose);

  const [style, setStyle] = useState(() => anchorRect ? {
    position: 'fixed',
    left: clamp(anchorRect.right + GAP, PAD, window.innerWidth - PANEL_W - PAD),
    top: clamp(anchorRect.top, PAD, window.innerHeight - PAD),
    visibility: 'hidden',
  } : undefined);

  const aKey = anchorRect ? `${anchorRect.left},${anchorRect.top},${anchorRect.width},${anchorRect.height}` : null;
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = el.offsetWidth || PANEL_W;
      const h = el.offsetHeight || 0;
      if (movedRef.current) {
        // keep the user's position, just re-clamp into the viewport
        setStyle((prev) => {
          if (!prev) return prev;
          const left = clamp(parseFloat(prev.left) || PAD, PAD, vw - w - PAD);
          const top = clamp(parseFloat(prev.top) || PAD, PAD, vh - h - PAD);
          return { position: 'fixed', left, top };
        });
        return;
      }
      const { left, top } = placeBeside(anchorRect, w, h, vw, vh);
      setStyle((prev) => {
        if (prev && prev.left === left && prev.top === top && prev.position === 'fixed' && !prev.visibility) return prev;
        return { position: 'fixed', left, top };
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
    const move = (ev) => {
      movedRef.current = true;
      setStyle({
        position: 'fixed',
        left: clamp(startLeft + (ev.clientX - sx), PAD, window.innerWidth - w - PAD),
        top: clamp(startTop + (ev.clientY - sy), PAD, window.innerHeight - h - PAD),
      });
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
         onContextMenu={(e) => e.stopPropagation()}
         onWheel={(e) => e.stopPropagation()}>
      <ImageAdjustPanel adjust={adjust} mode="compact"
                        onChange={onChange} onReset={onReset}
                        onDownload={onDownload} onExpand={onExpand}
                        onCompareStart={onCompareStart} onCompareEnd={onCompareEnd} />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default ImageEditPopover;
