// TeamConfirm — the Team page's small inline confirm, for what can't be undone
// (closing, leaving, a new link) and for a price shown before it is charged.
// Sticks to the top of the page body; Esc cancels and goes no further, so the
// page stays open. A danger confirm puts focus on Cancel.
import { useEffect, useRef } from 'react';

export function TeamConfirm({ message, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);

  useEffect(() => {
    const sel = danger ? '[data-cancel]' : '[data-confirm]';
    ref.current?.querySelector(sel)?.focus();
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel?.();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [danger, onCancel]);

  return (
    <div className="tp-confirm" role="alertdialog" aria-label="Confirm" ref={ref}>
      <span className="tp-confirm-t">{message}</span>
      <span className="tp-confirm-acts">
        <button type="button" className="tp-link" data-cancel disabled={busy} onClick={() => onCancel?.()}>Cancel</button>
        <button type="button" className={`tp-btn tp-btn-sm${danger ? ' tp-btn-danger' : ''}`} data-confirm disabled={busy} onClick={() => onConfirm?.()}>
          {confirmLabel}
        </button>
      </span>
    </div>
  );
}
