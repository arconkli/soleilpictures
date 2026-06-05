import { createContext, Suspense, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { lazyWithReload } from '../lib/lazyWithReload.js';

// The visual layer (confirm/prompt dialogs + toast stack) is the only part of
// this always-mounted provider that pulls in @phosphor-icons + react-dom's
// createPortal. Lazy-load it and only render it when there's something to show,
// so the signed-out landing never downloads Phosphor.
const FeedbackOverlay = lazyWithReload(() => import('./FeedbackOverlay.jsx'));

const TOAST_EXIT_MS = 200;

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const lastTrigger = useRef(null);

  const closeDialog = useCallback((value) => {
    setDialog(current => {
      if (current?.resolve) current.resolve(value);
      return null;
    });
    // Restore focus to whatever opened the dialog — captured before the
    // dialog autofocused its own control — once it has unmounted.
    const t = lastTrigger.current;
    lastTrigger.current = null;
    if (t && typeof t.focus === 'function') {
      requestAnimationFrame(() => { try { t.focus({ preventScroll: true }); } catch (_) { /* noop */ } });
    }
  }, []);

  const confirm = useCallback((options) => new Promise(resolve => {
    lastTrigger.current = typeof document !== 'undefined' ? document.activeElement : null;
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
    lastTrigger.current = typeof document !== 'undefined' ? document.activeElement : null;
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

  const dismissToast = useCallback((id) => {
    // Flag for the exit animation, then remove after it plays.
    setToasts(current => current.map(item => item.id === id ? { ...item, exiting: true } : item));
    window.setTimeout(() => {
      setToasts(current => current.filter(item => item.id !== id));
    }, TOAST_EXIT_MS);
  }, []);
  const toast = useCallback(({ type = 'info', message, action = null, ttl = 4200 }) => {
    if (!message) return;
    const id = nextId.current++;
    setToasts(current => [...current, { id, type, message, action, exiting: false }]);
    window.setTimeout(() => dismissToast(id), Math.max(1000, ttl));
  }, [dismissToast]);

  const value = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {(dialog || toasts.length > 0) && (
        <Suspense fallback={null}>
          <FeedbackOverlay
            dialog={dialog}
            onCloseDialog={closeDialog}
            toasts={toasts}
            onDismissToast={dismissToast}
          />
        </Suspense>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}
