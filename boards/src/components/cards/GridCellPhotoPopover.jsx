// Full image controls for a grid IMAGE cell — parity with a standalone image
// card, plus cell-specific framing. Portaled to <body> (cards live in the
// transformed canvas layer) and placed flush beside the cell. Composes:
//   • a cell-only FRAMING header — Fill/Fit + Reposition (arms a drag layer on
//     the cell) + a Zoom slider + Reset framing;
//   • the SHARED ImageAdjustPanel (reused verbatim) for the full non-destructive
//     photo-adjust stack (compact essentials → expand to all Light/Color/Detail).
// All writes are lifted to the parent (GridCard) via callbacks so the on-canvas
// cell updates live (GridCard owns the reactive gridCells + the SVG filter def).

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { Icon } from '../Icon.jsx';
import { Hand, RotateCcw, Search } from '../../lib/icons.js';
import { ImageAdjustPanel } from '../ImageAdjustPanel.jsx';

const PAD = 10;
const GAP = 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const stop = (e) => e.stopPropagation();

// Place the panel flush beside the cell rect (right → left → below → above),
// viewport-clamped. Same order as ImageEditPopover.
function placeBeside(rect, w, h, vw, vh) {
  const topAligned = clamp(rect.top, PAD, vh - h - PAD);
  if (rect.right + GAP + w <= vw - PAD) return { left: rect.right + GAP, top: topAligned };
  if (rect.left - GAP - w >= PAD) return { left: rect.left - GAP - w, top: topAligned };
  const centered = clamp(rect.left + rect.width / 2 - w / 2, PAD, vw - w - PAD);
  if (rect.bottom + GAP + h <= vh - PAD) return { left: centered, top: rect.bottom + GAP };
  if (rect.top - GAP - h >= PAD) return { left: centered, top: rect.top - GAP - h };
  return { left: vw - w - PAD, top: topAligned };
}

export function GridCellPhotoPopover({ anchorRect, fit, zoom = 1, adjust, repositionOn = false,
                                       onFit, onAdjustChange, onAdjustReset, onOpenFullEditor, onToggleReposition,
                                       onResetFraming, onCompareStart, onCompareEnd, onClose }) {
  const ref = useRef(null);
  // Ignore the reposition drag layer (a portal SIBLING over the cell) so dragging
  // to pan doesn't count as an outside-tap and close the editor mid-drag.
  useDismissOnOutside(ref, true, onClose, { ignore: '.gridc-reposition' });

  const [style, setStyle] = useState(() => anchorRect ? {
    position: 'fixed',
    left: clamp(anchorRect.right + GAP, PAD, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 280 - PAD),
    top: clamp(anchorRect.top, PAD, (typeof window !== 'undefined' ? window.innerHeight : 768) - PAD),
    visibility: 'hidden',
  } : undefined);

  const aKey = anchorRect ? `${anchorRect.left},${anchorRect.top},${anchorRect.width},${anchorRect.height}` : null;
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return undefined;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = el.offsetWidth || 280;
      const h = el.offsetHeight || 0;
      const { left, top } = placeBeside(anchorRect, w, h, vw, vh);
      setStyle((prev) => {
        if (prev && prev.left === left && prev.top === top && prev.position === 'fixed' && !prev.visibility) return prev;
        return { position: 'fixed', left, top };
      });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', place); };
  }, [aKey]);

  const isContain = fit === 'contain';
  const z = Number(zoom) > 1 ? Number(zoom) : 1;

  const node = (
    <div className="gridc-photo-pop" ref={ref} style={style}
         onPointerDown={stop} onMouseDown={stop} onClick={stop}
         onDoubleClick={stop} onContextMenu={stop} onWheel={stop}>
      <div className="gcp-frame">
        <div className="gcp-eyebrow">Fit to cell</div>
        <div className="gcp-frame-row">
          <div className="gcp-seg" role="group" aria-label="Image fit">
            <button type="button" className={`gcp-seg-btn ${!isContain ? 'is-on' : ''}`}
                    aria-label="Fill" aria-pressed={!isContain} onClick={() => onFit?.({ fit: 'cover' })}>Fill</button>
            <button type="button" className={`gcp-seg-btn ${isContain ? 'is-on' : ''}`}
                    aria-label="Fit" aria-pressed={isContain} onClick={() => onFit?.({ fit: 'contain' })}>Fit</button>
          </div>
          <button type="button" className={`gcp-tool ${repositionOn ? 'is-on' : ''}`}
                  aria-label="Reposition" aria-pressed={repositionOn} title="Drag the image in the cell to reposition"
                  onClick={onToggleReposition}>
            <Icon as={Hand} size={15} /><span>Reposition</span>
          </button>
          <button type="button" className="gcp-tool is-icon" aria-label="Reset framing" title="Reset framing"
                  onClick={onResetFraming}>
            <Icon as={RotateCcw} size={14} />
          </button>
        </div>
        <div className="gcp-zoom" aria-disabled={isContain}>
          <Icon as={Search} size={14} />
          <input type="range" className="gcp-zoom-slider" min={1} max={3} step={0.01} value={z}
                 aria-label="Zoom" disabled={isContain}
                 onChange={(e) => onFit?.({ zoom: Number(e.target.value) })}
                 onDoubleClick={() => onFit?.({ zoom: 1 })} />
          <span className="gcp-zoom-val">{z.toFixed(1)}×</span>
        </div>
      </div>
      <div className="gcp-sep" />
      <ImageAdjustPanel
        adjust={adjust}
        mode="compact"
        onChange={onAdjustChange}
        onReset={onAdjustReset}
        onExpand={onOpenFullEditor}
        onCompareStart={onCompareStart}
        onCompareEnd={onCompareEnd} />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default GridCellPhotoPopover;
