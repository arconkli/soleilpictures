// Fullscreen image preview. Opens fit-to-screen by default; click the image
// to zoom to actual (natural) size with drag-to-pan. Escape or click on the
// backdrop closes. Includes a Download button that resolves R2 references
// to signed URLs and triggers a browser download.

import { useEffect, useRef, useState } from 'react';
import { useGesture } from '@use-gesture/react';
import { R2Image } from './R2Image.jsx';
import { downloadImage } from '../lib/imageExport.js';
import { buildFilterRef, buildTransform } from '../lib/imageAdjust.js';

export function ImageLightbox({ src, title, alt, adjust, cardId, onClose }) {
  // 'fit'    → contained inside the viewport (default)
  // 'actual' → natural size, pannable
  // Touch: pinch-zoom interpolates continuously between fit and 4× scale,
  // stored in `touchScale`. Tap still toggles fit↔actual modes.
  const [mode, setMode] = useState('fit');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [touchScale, setTouchScale] = useState(1);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset pan when switching back to fit mode so the next 'actual' switch
  // starts centered.
  useEffect(() => {
    if (mode === 'fit') { setPan({ x: 0, y: 0 }); setTouchScale(1); }
  }, [mode]);

  // Touch pinch-zoom on the stage. Interpolates a free scale that
  // overrides the fit/actual mode while the user is pinching. On release
  // we snap back to whichever mode best matches the final scale: <1.2x
  // returns to fit, >=1.2x switches to actual.
  useGesture(
    {
      onPinch: ({ event, movement: [ms], memo, last }) => {
        if (event?.cancelable) event.preventDefault();
        const start = memo ?? touchScale;
        const next = Math.max(1, Math.min(4, start * ms));
        setTouchScale(next);
        if (last) {
          if (next < 1.2) { setMode('fit'); setTouchScale(1); }
          else setMode('actual');
        }
        return start;
      },
    },
    {
      target: stageRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0.25, max: 6 }, rubberband: true },
    },
  );

  const onImgClick = (e) => {
    e.stopPropagation();
    setMode((m) => (m === 'fit' ? 'actual' : 'fit'));
  };

  const onPanStart = (e) => {
    if (mode !== 'actual') return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y, pointerId: e.pointerId };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
  };
  const onPanMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };
  const onPanEnd = (e) => {
    // Always release the capture taken in onPanStart (this also serves
    // onPointerCancel) so an interrupted pan can't leave the pointer captured.
    if (dragRef.current) {
      try { e?.currentTarget?.releasePointerCapture?.(dragRef.current.pointerId); } catch (_) {}
    }
    dragRef.current = null;
  };

  const onDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    // Delegates to the shared module, which bakes any photo adjustments into
    // the file (or streams the original when there are none).
    try { await downloadImage({ src, title, adjust }); }
    finally { setDownloading(false); }
  };

  // Reflect photo adjustments in the viewer. `filter` is a separate CSS
  // property from `transform`, so it never collides with the pan/zoom
  // transform; the flip transform is appended to whatever transform the
  // pan/zoom logic produces.
  const adjFilter = buildFilterRef(adjust, cardId);
  const adjFlip = buildTransform(adjust);

  return (
    <div className={`lightbox lightbox-mode-${mode}`}
         onClick={() => onClose?.()}
         role="dialog"
         aria-label="Image preview">
      <button className="lightbox-x" aria-label="Close"
              onClick={(e) => { e.stopPropagation(); onClose?.(); }}>×</button>
      <button className="lightbox-download"
              aria-label="Download"
              title="Download"
              disabled={downloading}
              onClick={onDownload}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
             stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2 V11 M4 8 L8 12 L12 8 M3 14 H13" />
        </svg>
      </button>
      <div className="lightbox-stage"
           ref={stageRef}
           style={{ touchAction: 'manipulation' }}
           onPointerDown={onPanStart}
           onPointerMove={onPanMove}
           onPointerUp={onPanEnd}
           onPointerCancel={onPanEnd}>
        <R2Image className="lightbox-img"
                 src={src}
                 alt={alt || title || ''}
                 eager
                 draggable="false"
                 onClick={onImgClick}
                 style={(() => {
                   // Touch pinch wins while active (touchScale != 1),
                   // otherwise fall back to the mouse fit/actual modes. The
                   // flip transform (if any) is appended; the color filter is
                   // a separate property.
                   let transform = '';
                   if (touchScale !== 1) {
                     transform = `scale(${touchScale}) translate(${pan.x / touchScale}px, ${pan.y / touchScale}px)`;
                   } else if (mode === 'actual') {
                     transform = `translate(${pan.x}px, ${pan.y}px)`;
                   }
                   if (adjFlip) transform = `${transform} ${adjFlip}`.trim();
                   const style = {};
                   if (transform) style.transform = transform;
                   if (adjFilter) style.filter = adjFilter;
                   return Object.keys(style).length ? style : undefined;
                 })()} />
      </div>
      {title && <div className="lightbox-cap">{title}</div>}
    </div>
  );
}
