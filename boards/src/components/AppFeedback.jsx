import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const closeDialog = useCallback((value) => {
    setDialog(current => {
      if (current?.resolve) current.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback((options) => new Promise(resolve => {
    setDialog({
      kind: 'confirm',
      title: options.title || 'Confirm action',
      message: options.message,
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      danger: !!options.danger,
      // Optional "type this exact string to enable the confirm button"
      // gate. Used for destructive actions like deleting a workspace.
      confirmText: options.confirmText || null,
      confirmTextLabel: options.confirmTextLabel || null,
      confirmTextPlaceholder: options.confirmTextPlaceholder || null,
      resolve,
    });
  }), []);

  const prompt = useCallback((options) => new Promise(resolve => {
    setDialog({
      kind: 'prompt',
      title: options.title || 'Enter value',
      message: options.message,
      label: options.label,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue || '',
      confirmLabel: options.confirmLabel || 'Save',
      cancelLabel: options.cancelLabel || 'Cancel',
      resolve,
    });
  }), []);

  const toast = useCallback(({ type = 'info', message, action = null, ttl = 4200 }) => {
    if (!message) return;
    const id = nextId.current++;
    setToasts(current => [...current, { id, type, message, action }]);
    window.setTimeout(() => {
      setToasts(current => current.filter(item => item.id !== id));
    }, Math.max(1000, ttl));
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts(current => current.filter(item => item.id !== id));
  }, []);

  const value = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackDialog dialog={dialog} onClose={closeDialog} />
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(item => (
          <div key={item.id} className={`toast toast-${item.type}`}>
            <span className="toast-msg">{item.message}</span>
            {item.action && (
              <button type="button"
                      className="toast-action"
                      onClick={() => {
                        try { item.action.onClick?.(); } catch (_) {}
                        dismissToast(item.id);
                      }}>
                {item.action.label || 'Undo'}
              </button>
            )}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}

function FeedbackDialog({ dialog, onClose }) {
  const [value, setValue] = useState('');
  // Separate state for the type-to-confirm input on destructive confirms,
  // so it doesn't fight with the prompt-kind `value` above.
  const [typeToConfirm, setTypeToConfirm] = useState('');

  useEffect(() => {
    if (!dialog) return;
    setTypeToConfirm('');
    const onKey = (event) => {
      if (event.key === 'Escape') onClose(dialog.kind === 'confirm' ? false : null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
