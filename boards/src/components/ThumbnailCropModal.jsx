// Crop / reposition dialog for a custom cluster thumbnail.
//
// The user picks any image; clusters render their preview in a fixed 16:9 frame
// (the same 1200×675 frame renderThumbnail.js bakes auto thumbnails into). Photos
// are rarely 16:9, so this lets them drag to reposition and zoom within the frame
// before we bake the visible region to a WebP blob. The blob is handed to the
// caller, which uploads it over the board's canonical thumb key (uploads.js
// uploadBoardThumbnail) — so it appears on every surface that already reads
// thumb_key (grid tiles, nested-board covers, public views, exports).
//
// Geometry is kept trivially in sync between the live CSS preview and the canvas
// bake: at zoom=1 the image is scaled to COVER the frame (object-fit: cover
// baseline), then multiplied by `zoom` and shifted by `offset` (in frame px).
// The bake applies the SAME transform scaled by k = 1200 / measuredFrameWidth, so
// what you see is what you get. Pan is clamped so the image always covers the
// frame (no gaps).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
import { trackStroke } from '../lib/pointerStroke.js';

const FRAME_W = 1200;          // output canvas — matches renderThumbnail.js FRAME_W/H
const FRAME_H = 675;
const ASPECT = FRAME_H / FRAME_W;   // 0.5625 (16:9)
const MAX_ZOOM = 3;
const MAX_DECODE = 6000;       // guard absurd source dimensions before drawing

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function ThumbnailCropModal({ file, saving = false, onCancel, onSave }) {
  const [img, setImg] = useState(null);          // { el, w, h } | null
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [frameW, setFrameW] = useState(0);
  const frameRef = useRef(null);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // Decode the picked file. Object URL is revoked on unmount / re-pick.
  useEffect(() => {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { setError('That file isn’t an image.'); return; }
    let revoked = false;
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      if (revoked) return;
      if (!el.naturalWidth || !el.naturalHeight || el.naturalWidth > MAX_DECODE || el.naturalHeight > MAX_DECODE) {
        setError('That image is too large to use — try one under 6000px.');
        return;
      }
      setImg({ el, w: el.naturalWidth, h: el.naturalHeight });
    };
    el.onerror = () => { if (!revoked) setError('Couldn’t read that image.'); };
    el.src = url;
    return () => { revoked = true; URL.revokeObjectURL(url); };
  }, [file]);

  // Escape to cancel.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Measure the frame's rendered width so the cover math and the bake agree
  // regardless of viewport size.
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => setFrameW(node.clientWidth || 0);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(node);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [img]);

  const frameH = frameW * ASPECT;
  // Cover baseline: smallest scale that fully covers the frame at zoom 1.
  const base = img && frameW ? Math.max(frameW / img.w, frameH / img.h) : 1;
  const imgW = img ? img.w * base * zoom : 0;
  const imgH = img ? img.h * base * zoom : 0;
  const maxOffX = Math.max(0, (imgW - frameW) / 2);
  const maxOffY = Math.max(0, (imgH - frameH) / 2);

  // Re-clamp offset whenever the covered extent shrinks (zoom out / resize).
  useEffect(() => {
    setOffset((o) => {
      const nx = clamp(o.x, -maxOffX, maxOffX);
      const ny = clamp(o.y, -maxOffY, maxOffY);
      return (nx === o.x && ny === o.y) ? o : { x: nx, y: ny };
    });
  }, [maxOffX, maxOffY]);

  const onPointerDown = (e) => {
    if (!img || e.button != null && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const start = offsetRef.current;
    trackStroke({
      pointerId: e.pointerId,
      onSample: (ev) => {
        setOffset({
          x: clamp(start.x + (ev.clientX - startX), -maxOffX, maxOffX),
          y: clamp(start.y + (ev.clientY - startY), -maxOffY, maxOffY),
        });
      },
      onEnd: () => {},
    });
  };

  const doSave = () => {
    if (!img || saving) return;
    const k = FRAME_W / frameW;          // display frame px → output px
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_W; canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError('Couldn’t prepare the image.'); return; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const destW = imgW * k, destH = imgH * k;
    const destX = (FRAME_W - destW) / 2 + offset.x * k;
    const destY = (FRAME_H - destH) / 2 + offset.y * k;
    ctx.drawImage(img.el, destX, destY, destW, destH);
    canvas.toBlob(
      (blob) => { if (blob) onSave?.(blob); else setError('Couldn’t encode the image.'); },
      'image/webp', 0.85,
    );
  };

  const node = (
    <div style={S.overlay} role="dialog" aria-label="Set cluster thumbnail" aria-modal="true"
         onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div style={S.panel}>
        <div style={S.head}>
          <div style={S.title}>Set cluster thumbnail</div>
          <button style={S.x} aria-label="Cancel" onClick={onCancel}><Icon as={X} size={16} /></button>
        </div>

        {error ? (
          <div style={S.error}>{error}</div>
        ) : (
          <>
            <div ref={frameRef} style={S.frame}
                 onPointerDown={onPointerDown}
                 title="Drag to reposition">
              {img && frameW > 0 && (
                <img src={img.el.src} alt="" draggable={false}
                     style={{
                       position: 'absolute', left: '50%', top: '50%',
                       width: imgW, height: imgH, maxWidth: 'none',
                       transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                       userSelect: 'none', pointerEvents: 'none',
                     }} />
              )}
              {!img && <div style={S.frameLoading}>Loading…</div>}
              <div style={S.frameHint}>Drag to reposition</div>
            </div>

            <label style={S.zoomRow}>
              <span style={S.zoomLabel}>Zoom</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
                     disabled={!img}
                     onChange={(e) => setZoom(Number(e.target.value))}
                     style={S.range} aria-label="Zoom" />
            </label>
          </>
        )}

        <div style={S.actions}>
          <button style={S.btn} onClick={onCancel}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnPrimary, ...((!img || error || saving) ? S.btnDisabled : null) }}
                  disabled={!img || !!error || saving}
                  onClick={doSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 3000,
    background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  panel: {
    width: 'min(92vw, 560px)', background: 'var(--bg-1, #111114)',
    border: '1px solid var(--line-2, #2c2c32)', borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,.5)', color: 'var(--ink-0, #f5f5f7)',
    padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: 600 },
  x: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 6, border: 'none',
    background: 'transparent', color: 'var(--ink-2, #a0a0a8)', cursor: 'pointer',
  },
  frame: {
    position: 'relative', width: '100%', aspectRatio: '16 / 9',
    overflow: 'hidden', borderRadius: 8, background: 'var(--bg-2, #0c0c0e)',
    border: '1px solid var(--line-2, #2c2c32)', cursor: 'grab', touchAction: 'none',
  },
  frameLoading: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', color: 'var(--ink-2, #a0a0a8)', fontSize: 13,
  },
  frameHint: {
    position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', borderRadius: 999,
    background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 11, pointerEvents: 'none',
  },
  zoomRow: { display: 'flex', alignItems: 'center', gap: 12 },
  zoomLabel: { fontSize: 12, color: 'var(--ink-2, #a0a0a8)', width: 40 },
  range: { flex: 1, accentColor: 'var(--soleil, #ffa500)' },
  error: {
    padding: '14px 12px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg-2, #0c0c0e)', color: 'var(--ink-1, #d0d0d6)',
    border: '1px solid var(--line-2, #2c2c32)',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  btn: {
    padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: '1px solid var(--line-2, #2c2c32)', background: 'transparent',
    color: 'var(--ink-0, #f5f5f7)',
  },
  btnPrimary: {
    background: 'var(--soleil, #ffa500)', borderColor: 'var(--soleil, #ffa500)', color: '#1a1200',
  },
  btnDisabled: { opacity: 0.5, cursor: 'default' },
};

export default ThumbnailCropModal;
