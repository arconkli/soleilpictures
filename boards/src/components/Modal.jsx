// Shared modal/dialog primitive. Centralizes the behavior every dialog in the
// app needs but historically reimplemented unevenly (or skipped entirely):
// a consistent backdrop, Escape-to-close, backdrop-click-to-close, a focus
// trap, focus restore to the trigger on close, body scroll lock, and dialog
// ARIA (role/aria-modal/label). Visual chrome stays with the caller via
// `className`, so each modal keeps its own look while sharing behavior.
//
// Nesting-safe: Tab/Escape are only handled while this modal is the TOP layer
// in lib/modalGuard. So a feedback confirm/prompt opened on top of a modal
// (e.g. from ShareModal's "remove collaborator") behaves correctly without the
// modal underneath stealing the keystroke. Escape also works when focus fell
// back to <body> — Trash's Restore removes the very row whose button had it.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { Icon } from './Icon.jsx';
// The Tab trap and the focusable query live in lib/modalGuard, shared with
// Settings, which keeps its own shell and so cannot wrap in this component.
import { registerModalOpen, isTopModal, focusablesIn as focusables, trapTabKey } from '../lib/modalGuard.js';

// Ref-counted body scroll lock so stacked modals don't unlock prematurely.
let lockCount = 0;
let prevOverflow = '';
// Exported so overlays that keep their own DOM/CSS (e.g. the upgrade-backdrop
// pricing/waitlist modals, whose stacking can't be re-parented onto Modal
// without a CSS reshuffle) can still share the same ref-counted scroll lock.
export function lockScroll() {
  if (lockCount === 0) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}
export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = prevOverflow;
}

export function Modal({
  open,
  onClose,
  className = '',
  backdropClassName = '',
  ariaLabel,
  labelledBy,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showClose = false,
  initialFocusRef,
  returnFocusRef,
  children,
}) {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const guardRef = useRef(null);

  // Capture trigger, set initial focus, lock scroll; restore focus + unlock
  // on close. Keyed on `open` only — callbacks are read via refs/closures so
  // we don't re-run the lifecycle when a parent re-renders.
  useEffect(() => {
    if (!open) return undefined;
    // While any modal is open, the canvas/list window shortcut handlers
    // stand down (lib/modalGuard) — a focused button inside a dialog isn't
    // an "editable target", so Backspace in the Trash modal used to delete
    // the selected cards on the board behind it.
    const unregister = registerModalOpen();
    guardRef.current = unregister;
    triggerRef.current = returnFocusRef?.current || document.activeElement;
    lockScroll();

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current || focusables(panel)[0] || panel;
      try { target.focus({ preventScroll: true }); } catch (_) { /* noop */ }
    });

    return () => {
      unregister();
      guardRef.current = null;
      cancelAnimationFrame(raf);
      unlockScroll();
      const t = triggerRef.current;
      if (t && typeof t.focus === 'function') {
        try { t.focus({ preventScroll: true }); } catch (_) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Trap Tab + handle Escape, but only while we are the top layer and focus
  // is inside this panel (or nowhere — on <body>), so a dialog stacked on top
  // of us, or a popover portaled outside us, keeps control of the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const panel = panelRef.current;
      if (!panel || !isTopModal(guardRef.current)) return;
      const active = document.activeElement;
      const focusLost = !active || active === document.body;
      if (!focusLost && !panel.contains(active)) return;

      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab') trapTabKey(e, panel);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  const onBackdropDown = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    // pointerdown, not mousedown: synthesized mouse events are unreliable
    // on touch, which made modals impossible to dismiss by tapping outside
    // (same fix useDismissOnOutside applies to popovers).
    <div className={`modal-shell-bg ${backdropClassName}`.trim()} onPointerDown={onBackdropDown}>
      <div
        ref={panelRef}
        className={`modal-shell ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {showClose && (
          <button type="button" className="modal-shell-x" aria-label="Close" onClick={() => onClose?.()}>
            <Icon as={X} size={18} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
