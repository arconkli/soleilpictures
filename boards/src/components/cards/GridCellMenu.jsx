// Full-size pop-out menu for a grid cell that is too small to host the inline
// hover pill. Portaled to document.body (cards live in a transformed canvas
// layer, so a position:fixed descendant would otherwise re-anchor to the
// transform) and placed flush BESIDE the cell (right → left → below → above) so
// it never covers the tiny cell. It escapes the .gridc { overflow:hidden } clip
// and stays a comfortable size at any cell size or zoom. Every option reuses the
// exact same gridActions.* handlers as the inline pill (passed in as callbacks),
// so both the Yjs and local shells work with no extra wiring.

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { Icon } from '../Icon.jsx';
import { Columns2 as Columns, Trash2 as Trash, TextT, Image as ImageIcon, Link, ArrowsClockwise, Edit as Pencil, Maximize2, Download } from '../../lib/icons.js';

const PAD = 10;
const GAP = 10;   // gap between the cell edge and the menu
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const stop = (e) => e.stopPropagation();

// Place the menu flush beside the cell rect, never overlapping it. Same order as
// ImageEditPopover: right → left → below → above, viewport-clamped.
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

export function GridCellMenu({ anchorRect, mode = 'empty', isImage = false,
                              onText, onImage, onLink, onSplitRow, onSplitCol, onClear,
                              onEditPhoto, onOpenFullScreen, onDownload, onClose,
                              extraItems = null }) {
  const ref = useRef(null);
  // Filled cells rest on Replace/Clear; clicking Replace reveals the choosers.
  // Empty cells show the choosers straight away. Held HERE (not GridCard's
  // swapCellId) so leaving the tiny cell for the portaled menu can't reset it.
  const [showChooser, setShowChooser] = useState(mode !== 'filled');
  useDismissOnOutside(ref, true, onClose);

  const [style, setStyle] = useState(() => anchorRect ? {
    position: 'fixed',
    left: clamp(anchorRect.right + GAP, PAD, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 220 - PAD),
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
      const w = el.offsetWidth || 220;
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

  // Run an action then close (all cell mutations either finish synchronously or
  // hand off to a picker/prompt, so closing the menu right after is correct).
  const run = (fn) => (e) => { e.stopPropagation(); fn?.(); onClose?.(); };

  const node = (
    <div className="gridc-cell-menu" ref={ref} style={style}
         onPointerDown={stop} onMouseDown={stop} onClick={stop}
         onDoubleClick={stop} onContextMenu={stop} onWheel={stop}>
      {showChooser ? (
        <div className="gcm-group">
          <button type="button" className="gcm-item" title="Text" aria-label="Text" onClick={run(onText)}>
            <span className="gridc-ico"><Icon as={TextT} size={16} /></span><span className="gcm-label">Text</span>
          </button>
          <button type="button" className="gcm-item" title="Image" aria-label="Image" onClick={run(onImage)}>
            <span className="gridc-ico"><Icon as={ImageIcon} size={16} /></span><span className="gcm-label">Image</span>
          </button>
          <button type="button" className="gcm-item" title="Link" aria-label="Link" onClick={run(onLink)}>
            <span className="gridc-ico"><Icon as={Link} size={16} /></span><span className="gcm-label">Link</span>
          </button>
        </div>
      ) : (
        <div className="gcm-group">
          {isImage && (
            <button type="button" className="gcm-item" title="Edit photo" aria-label="Edit photo" onClick={run(onEditPhoto)}>
              <span className="gridc-ico"><Icon as={Pencil} size={16} /></span><span className="gcm-label">Edit photo</span>
            </button>
          )}
          {isImage && (
            <button type="button" className="gcm-item" title="Open full screen" aria-label="Open full screen" onClick={run(onOpenFullScreen)}>
              <span className="gridc-ico"><Icon as={Maximize2} size={16} /></span><span className="gcm-label">Open full screen</span>
            </button>
          )}
          {isImage && (
            <button type="button" className="gcm-item" title="Download" aria-label="Download" onClick={run(onDownload)}>
              <span className="gridc-ico"><Icon as={Download} size={16} /></span><span className="gcm-label">Download</span>
            </button>
          )}
          <button type="button" className="gcm-item" title="Replace" aria-label="Replace"
                  onClick={(e) => { e.stopPropagation(); setShowChooser(true); }}>
            <span className="gridc-ico"><Icon as={ArrowsClockwise} size={16} /></span><span className="gcm-label">Replace</span>
          </button>
          <button type="button" className="gcm-item" title="Clear" aria-label="Clear" onClick={run(onClear)}>
            <span className="gridc-ico"><Icon as={Trash} size={16} /></span><span className="gcm-label">Clear</span>
          </button>
        </div>
      )}
      {onSplitRow ? (
        // Grid cells only — a schedule slot's subdivisions are fixed
        // (hours/minutes), so it simply omits the split handlers.
        <>
          <div className="gcm-sep" />
          <div className="gcm-group">
            <button type="button" className="gcm-item" title="Add a vertical line (split into columns)" aria-label="Split into columns" onClick={run(onSplitRow)}>
              <span className="gridc-ico"><Icon as={Columns} size={16} /></span><span className="gcm-label">Split columns</span>
            </button>
            <button type="button" className="gcm-item" title="Add a horizontal line (split into rows)" aria-label="Split into rows" onClick={run(onSplitCol)}>
              <span className="gridc-ico gridc-rot90"><Icon as={Columns} size={16} /></span><span className="gcm-label">Split rows</span>
            </button>
          </div>
        </>
      ) : null}
      {extraItems && extraItems.length ? (
        // Caller-specific actions (the schedule slot menu: remove item, break
        // into hours/minutes, …) — same look, same run-then-close discipline.
        <>
          <div className="gcm-sep" />
          <div className="gcm-group">
            {extraItems.map((it) => (
              <button key={it.id} type="button" className="gcm-item" title={it.label} aria-label={it.label} onClick={run(it.onClick)}>
                {it.icon ? <span className="gridc-ico"><Icon as={it.icon} size={16} /></span> : null}
                <span className="gcm-label">{it.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

export default GridCellMenu;
