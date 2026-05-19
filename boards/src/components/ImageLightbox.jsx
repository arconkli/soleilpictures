// Fullscreen image preview. Opens fit-to-screen by default; click the image
// to zoom to actual (natural) size with drag-to-pan. Escape or click on the
// backdrop closes. Includes a Download button that resolves R2 references
// to signed URLs and triggers a browser download.

import { useEffect, useRef, useState } from 'react';
import { useGesture } from '@use-gesture/react';
import { R2Image } from './R2Image.jsx';
import { resolveSrc } from '../lib/r2.js';

export function ImageLightbox({ src, title, alt, onClose }) {
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
    dragRef.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
  };
  const onPanMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };
  const onPanEnd = () => { dragRef.current = null; };

  const filenameFor = (s, t) => {
    let base = (t || '').toString().trim();
    if (!base) {
      // Use the last path segment of the URL when no title is set.
      const m = String(s || '').match(/([^/?#]+)(?:[?#]|$)/);
      base = m ? decodeURIComponent(m[1]) : 'image';
    }
    base = base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    if (!/\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$/i.test(base)) base += '.jpg';
    return base;
  };

  const onDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await resolveSrc(src);
      if (!url) return;
      // Fetch + blob so the `download` attribute works across origins
      // (a plain anchor with download="" gets ignored on cross-origin
      // responses without the right headers).
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filenameFor(url, title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (_) {
      // Fall back to opening in a new tab.
      const url = await resolveSrc(src).catch(() => null);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

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
                   // otherwise fall back to the mouse fit/actual modes.
                   if (touchScale !== 1) {
                     return { transform: `scale(${touchScale}) translate(${pan.x / touchScale}px, ${pan.y / touchScale}px)` };
                   }
                   if (mode === 'actual') return { transform: `translate(${pan.x}px, ${pan.y}px)` };
                   return undefined;
                 })()} />
      </div>
      {title && <div className="lightbox-cap">{title}</div>}
    </div>
  );
}
