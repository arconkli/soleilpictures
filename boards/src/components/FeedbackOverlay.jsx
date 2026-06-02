// FeedbackOverlay — the visual layer for FeedbackProvider (confirm/prompt
// dialogs + toast stack). Split into its own lazy chunk because it's the only
// thing in the always-mounted provider that imports @phosphor-icons/react +
// createPortal. The provider renders this only when there's an active dialog
// or toast, so the signed-out landing never downloads Phosphor.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, WarningCircle, Info, X } from '@phosphor-icons/react';
import { Icon } from './Icon.jsx';

const TOAST_ICON = { success: CheckCircle, error: WarningCircle, info: Info };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function FeedbackOverlay({ dialog, onCloseDialog, toasts, onDismissToast }) {
  const overlay = (
    <>
      <FeedbackDialog dialog={dialog} onClose={onCloseDialog} />
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(item => (
          <div key={item.id}
               className={`toast toast-${item.type}${item.exiting ? ' toast-exiting' : ''}`}
               role={item.type === 'error' ? 'alert' : undefined}>
            <span className="toast-icon" aria-hidden="true">
              <Icon as={TOAST_ICON[item.type] || Info} size={16} weight="bold" />
            </span>
            <span className="toast-msg">{item.message}</span>
            {item.action && (
              <button type="button"
                      className="toast-action"
                      onClick={() => {
                        try { item.action.onClick?.(); } catch (_) {}
                        onDismissToast(item.id);
                      }}>
                {item.action.label || 'Undo'}
              </button>
            )}
            <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={() => onDismissToast(item.id)}>
              <Icon as={X} size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );

  // Portal to document.body so a high z-index actually wins over portal-mounted
  // modals (Settings, Pricing, etc.). Without the portal, any ancestor stacking
  // context above FeedbackProvider traps the dialog underneath those modals.
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null;
}

function FeedbackDialog({ dialog, onClose }) {
  const [value, setValue] = useState('');
  // Separate state for the type-to-confirm input on destructive confirms,
  // so it doesn't fight with the prompt-kind `value` above.
  const [typeToConfirm, setTypeToConfirm] = useState('');
  const formRef = useRef(null);

  useEffect(() => {
    if (!dialog) return undefined;
    setTypeToConfirm('');
    // Lock background scroll while the dialog is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(dialog.kind === 'confirm' ? false : null); return; }
      // Trap Tab within the dialog so keyboard focus can't wander behind it.
      if (event.key === 'Tab') {
        const panel = formRef.current;
        if (!panel) return;
        const nodes = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(n => n.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [dialog, onClose]);

  if (!dialog) return null;

  const requiresTyping = dialog.kind === 'confirm' && !!dialog.confirmText;
  // Trim so trailing whitespace doesn't lock the user out of confirming.
  const typeMatches = !requiresTyping || typeToConfirm.trim() === dialog.confirmText.trim();

  const submit = (event) => {
    event.preventDefault();
    if (dialog.kind === 'prompt') onClose(value);
    else if (requiresTyping && !typeMatches) return;
    else onClose(true);
  };

  return (
    <div className="feedback-bg" onMouseDown={() => onClose(dialog.kind === 'confirm' ? false : null)}>
      <form
        ref={formRef}
        className="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="feedback-hd">
          <div className="feedback-title">{dialog.title}</div>
          <button type="button" className="modal-x" aria-label="Close" onClick={() => onClose(dialog.kind === 'confirm' ? false : null)}>x</button>
        </div>
        {dialog.message && <div className="feedback-message">{dialog.message}</div>}
        {dialog.kind === 'prompt' && (
          <PromptField dialog={dialog} value={value} setValue={setValue} />
        )}
        {requiresTyping && (
          <label className="feedback-field">
            {dialog.confirmTextLabel && <span>{dialog.confirmTextLabel}</span>}
            <input
              autoFocus
              value={typeToConfirm}
              placeholder={dialog.confirmTextPlaceholder || dialog.confirmText}
              onChange={(event) => setTypeToConfirm(event.target.value)}
            />
          </label>
        )}
        <div className="feedback-actions">
          <button type="button" className="btn-secondary" onClick={() => onClose(dialog.kind === 'confirm' ? false : null)}>
            {dialog.cancelLabel}
          </button>
          <button
            type="submit"
            className={dialog.danger ? 'btn-primary btn-danger' : 'btn-primary'}
            autoFocus={!requiresTyping}
            disabled={requiresTyping && !typeMatches}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function PromptField({ dialog, value, setValue }) {
  useEffect(() => {
    setValue(dialog.defaultValue || '');
  }, [dialog.defaultValue, setValue]);

  return (
    <label className="feedback-field">
      {dialog.label && <span>{dialog.label}</span>}
      <input
        autoFocus
        value={value}
        placeholder={dialog.placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}
