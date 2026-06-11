import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Slide-in left drawer for phone width. Wraps existing sidebar
// content (workspace switcher, board tree, tags, footer) without
// requiring those components to know about mobile.
//
// Props:
//   open     — controlled
//   onClose  — fired on backdrop click / swipe-left / Esc
//   children — sidebar content
//
// Animation: translateX from -100% to 0. Width: min(85vw, 320px)
// so the user can see a sliver of the underlying canvas as
// affordance for "tap outside to close."
export function MobileDrawer({ open, onClose, children }) {
  const dragStart = useRef(null);
  const snapTimer = useRef(null);
  const [dragX, setDragX] = useState(0);
  // True for the ~200ms after a released drag while the drawer eases home.
  const [snapping, setSnapping] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setDragX(0); setSnapping(false); }
  }, [open]);

  useEffect(() => () => clearTimeout(snapTimer.current), []);

  if (!open) return null;

  const onPointerDown = (e) => {
    dragStart.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragStart.current || dragStart.current.id !== e.pointerId) return;
    const dx = Math.min(0, e.clientX - dragStart.current.x);
    setDragX(dx);
  };
  const onPointerUp = (e) => {
    // Always release the capture taken in onPointerDown (this handler also
    // serves onPointerCancel) so a mid-swipe interruption can't leave the
    // pointer captured and lock out further interaction.
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) {}
    if (!dragStart.current || dragStart.current.id !== e.pointerId) return;
    const dx = Math.min(0, e.clientX - dragStart.current.x);
    dragStart.current = null;
    if (dx < -80) { onClose?.(); return; }
    if (dx < 0) {
      // Ease back instead of snapping; transition exists only for this window.
      setSnapping(true);
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => setSnapping(false), 220);
    }
    setDragX(0);
  };

  return createPortal(
    <div className="md-drawer-root" role="dialog" aria-modal="true">
      <div className="md-drawer-backdrop" onClick={onClose} />
      <aside
        className="md-drawer-panel"
        // Live drags track the finger 1:1 (no transition); a released drag
        // keeps a transition just long enough to ease home.
        style={dragX
          ? { transform: `translateX(${dragX}px)`, transition: 'none' }
          : snapping
            ? { transition: 'transform 200ms var(--ease)' }
            : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}
