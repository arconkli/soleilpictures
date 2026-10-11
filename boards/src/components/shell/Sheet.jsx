import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerModalOpen, registerBackLayer } from '../../lib/modalGuard.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(n => n.getClientRects().length > 0);
}
// Fields that raise the phone's soft keyboard when focused. A sheet must not
// land on one when it opens: Android shows the keyboard for a programmatic
// focus during the opening tap, and it covers a half-height sheet (Templates
// opens on its search field).
const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image']);
function isTextEntry(n) {
  if (n.isContentEditable || n.tagName === 'TEXTAREA') return true;
  return n.tagName === 'INPUT' && !NON_TEXT_INPUT.has((n.type || 'text').toLowerCase());
}

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
//   className — extra class on .sheet-root. Exists so a caller that is
//               ITSELF a high-z portal (the SketchPad overlay) can lift
//               the sheet above it; .sheet-root's z-index of 1000 sits
//               far below that and the sheet would open out of sight.
//
// Desktop note: this component is intentionally only rendered when
// useBreakpoint().isPhone is true at the call site. We do not gate
// internally so callers retain full control over which surface
// shows what (sheet vs. side panel vs. dialog).
export function Sheet({ open, onClose, title, children, snap = 'full', className = '' }) {
  const dragStart = useRef(null);
  const sheetRef = useRef(null);
  const snapTimer = useRef(null);
  const [dragY, setDragY] = useState(0);
  // True for the ~200ms after a released drag while the sheet eases home.
  const [snapping, setSnapping] = useState(false);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // A layer in lib/modalGuard while open, like Modal: the canvas's window
  // shortcuts (Backspace = delete the selection) stand down behind it,
  // Escape closes only the top layer, and the phone's Back closes the sheet
  // instead of leaving the app. Focus moves into the sheet (its first control
  // that isn't a text field, else the panel) and goes back to whatever opened
  // it (the + puck) on close.
  useEffect(() => {
    if (!open) return undefined;
    const unregister = registerModalOpen({ onEscape: () => { onCloseRef.current?.(); return true; } });
    const unBack = registerBackLayer(() => onCloseRef.current?.());
    const trigger = document.activeElement;
    const raf = requestAnimationFrame(() => {
      const panel = sheetRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const target = focusables(panel).find(n => !isTextEntry(n)) || panel;
      try { target.focus({ preventScroll: true }); } catch (_) { /* noop */ }
    });
    return () => {
      cancelAnimationFrame(raf);
      unregister();
      unBack();
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
        try { trigger.focus({ preventScroll: true }); } catch (_) { /* noop */ }
      }
    };
  }, [open]);

  // Keep Tab inside the sheet; it used to walk into the page behind it.
  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const panel = sheetRef.current;
    if (!panel) return;
    const nodes = focusables(panel);
    if (nodes.length === 0) { e.preventDefault(); panel.focus?.(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

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
    <div className={`sheet-root ${className}`.trim()} data-snap={snap} role="dialog" aria-modal="true"
         aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'Sheet'}
         onKeyDown={onKeyDown}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        ref={sheetRef}
        className="sheet-panel"
        tabIndex={-1}
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
        {title ? <div className="sheet-title" id={titleId}>{title}</div> : null}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
