// Compact photo-edit popover. Portaled to document.body (cards live in a
// transformed canvas layer, so a position:fixed descendant would otherwise
// re-anchor to the transform) and viewport-clamped from an {x,y} anchor —
// the same pattern as ColorPicker.jsx. Hosts the shared ImageAdjustPanel.

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { ImageAdjustPanel } from './ImageAdjustPanel.jsx';

const PANEL_W = 248;
const PAD = 10;

export function ImageEditPopover({ position, adjust, onChange, onReset, onDownload, onExpand, onClose }) {
  const ref = useRef(null);
  useDismissOnOutside(ref, true, onClose);

  const [style, setStyle] = useState(() => position ? {
    position: 'fixed',
    left: Math.max(PAD, Math.min(window.innerWidth - PANEL_W - PAD, position.x - PANEL_W / 2)),
    top: position.y + 8,
    visibility: 'hidden',
  } : undefined);

  const posX = position?.x;
  const posY = position?.y;
  useLayoutEffect(() => {
    if (posX == null || posY == null || !ref.current) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth || PANEL_W;
      const h = el.offsetHeight || 0;
      const spaceBelow = vh - posY - PAD;
      const placeBelow = spaceBelow >= h + 12 || (vh - posY) > posY;
      const top = placeBelow
        ? Math.max(PAD, Math.min(vh - h - PAD, posY + 10))
        : Math.max(PAD, posY - h - 10);
      const left = Math.max(PAD, Math.min(vw - w - PAD, posX - w / 2));
      setStyle(prev => {
        if (prev && prev.left === left && prev.top === top && prev.position === 'fixed' && !prev.visibility) {
          return prev;
        }
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
  }, [posX, posY]);

  const node = (
    <div className="iep-pop" ref={ref} style={style}
         onPointerDown={(e) => e.stopPropagation()}
         onMouseDown={(e) => e.stopPropagation()}
         onClick={(e) => e.stopPropagation()}
         onDoubleClick={(e) => e.stopPropagation()}
         onContextMenu={(e) => e.stopPropagation()}
         onWheel={(e) => e.stopPropagation()}>
      <ImageAdjustPanel adjust={adjust} mode="compact"
                        onChange={onChange} onReset={onReset}
                        onDownload={onDownload} onExpand={onExpand} />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default ImageEditPopover;
