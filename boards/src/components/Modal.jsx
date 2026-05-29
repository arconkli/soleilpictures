// Shared modal/dialog primitive. Centralizes the behavior every dialog in the
// app needs but historically reimplemented unevenly (or skipped entirely):
// a consistent backdrop, Escape-to-close, backdrop-click-to-close, a focus
// trap, focus restore to the trigger on close, body scroll lock, and dialog
// ARIA (role/aria-modal/label). Visual chrome stays with the caller via
// `className`, so each modal keeps its own look while sharing behavior.
//
// Nesting-safe: Tab/Escape are only handled while focus is inside *this*
// panel. So a feedback confirm/prompt opened on top of a modal (e.g. from
// ShareModal's "remove collaborator") behaves correctly without the modal
// underneath stealing the keystroke.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { Icon } from './Icon.jsx';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Ref-counted body scroll lock so stacked modals don't unlock prematurely.
let lockCount = 0;
let prevOverflow = '';
function lockScroll() {
  if (lockCount === 0) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = prevOverflow;
}

function focusables(panel) {
  return Array.from(panel.querySelectorAll(FOCUSABLE))
    .filter(n => n.getClientRects().length > 0);
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

  // Capture trigger, set initial focus, lock scroll; restore focus + unlock
  // on close. Keyed on `open` only — callbacks are read via refs/closures so
  // we don't re-run the lifecycle when a parent re-renders.
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = returnFocusRef?.current || document.activeElement;
    lockScroll();

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current || focusables(panel)[0] || panel;
      try { target.focus({ preventScroll: true }); } catch (_) { /* noop */ }
    });

    return () => {
      cancelAnimationFrame(raf);
      unlockScroll();
      const t = triggerRef.current;
      if (t && typeof t.focus === 'function') {
        try { t.focus({ preventScroll: true }); } catch (_) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Trap Tab + handle Escape, but only while focus is inside this panel so a
  // dialog stacked on top of us keeps control of the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const panel = panelRef.current;
      if (!panel || !panel.contains(document.activeElement)) return;

      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = focusables(panel);
        if (nodes.length === 0) { e.preventDefault(); panel.focus?.(); return; }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  const onBackdropDown = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div className={`modal-shell-bg ${backdropClassName}`.trim()} onMouseDown={onBackdropDown}>
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
