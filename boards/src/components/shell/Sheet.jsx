import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Bottom sheet primitive. Used as the phone-width alternative to
// modals and side drawers in P2 (MessagesPanel, SettingsPanel,
// ShareModal, RecoveryModal, TrashModal, context menus).
//
// Props:
//   open      — controlled
//   onClose   — fired on backdrop click / swipe-down / Esc
//   title     — optional header text
//   children  — body content; scrolls internally
//   snap      — 'half' | 'full' (default 'full'). Half = 50vh,
//               full = 90vh. Snap points are visual only here;
//               the user can still swipe-down to dismiss.
//
// Desktop note: this component is intentionally only rendered when
// useBreakpoint().isPhone is true at the call site. We do not gate
// internally so callers retain full control over which surface
// shows what (sheet vs. side panel vs. dialog).
export function Sheet({ open, onClose, title, children, snap = 'full' }) {
  const dragStart = useRef(null);
  const sheetRef = useRef(null);
  const snapTimer = useRef(null);
  const [dragY, setDragY] = useState(0);
  // True for the ~200ms after a released drag while the sheet eases home.
  const [snapping, setSnapping] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setDragY(0); setSnapping(false); }
  }, [open]);

  useEffect(() => () => clearTimeout(snapTimer.current), []);

  if (!open) return null;

  const onPointerDown = (e) => {
    if (e.target.dataset?.sheetGrab !== 'true') return;
    dragStart.current = { y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragStart.current || dragStart.current.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - dragStart.current.y);
    setDragY(dy);
  };
  const onPointerUp = (e) => {
    if (!dragStart.current || dragStart.current.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - dragStart.current.y);
    dragStart.current = null;
    if (dy > 120) { onClose?.(); return; }
    if (dy > 0) {
      // Ease back instead of snapping. The transition style only exists for
      // this window so the sheet carries no inline transform at rest.
      setSnapping(true);
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => setSnapping(false), 220);
    }
    setDragY(0);
  };

  return createPortal(
    <div className="sheet-root" data-snap={snap} role="dialog" aria-modal="true">
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        ref={sheetRef}
        className="sheet-panel"
        // Live drags track the finger 1:1 (no transition); a released drag
        // keeps a transition just long enough to ease home.
        style={dragY
          ? { transform: `translateY(${dragY}px)`, transition: 'none' }
          : snapping
            ? { transition: 'transform 200ms var(--ease)' }
            : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="sheet-grip-row" data-sheet-grab="true">
          <div className="sheet-grip" data-sheet-grab="true" />
        </div>
        {title ? <div className="sheet-title">{title}</div> : null}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
