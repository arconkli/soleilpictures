import { createContext, Suspense, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { isSilenced } from '../lib/captureState.js';
import { placeGroupedToast, releaseToastGroup } from '../lib/toastGroup.js';
import { reportToast } from '../lib/errorReporting.js';

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
  // What screen readers hear. The visual stack only mounts with its first
  // toast, and a live region inserted together with its content is not
  // announced — so "Deleted · Undo" was silent. These two regions are mounted
  // from boot and only their text changes. The id-parity nbsp makes a repeat
  // of the same message still count as a change.
  const [announce, setAnnounce] = useState({ polite: '', alert: '' });
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
      // Optional third choice between Cancel and Confirm. The promise then
      // resolves 'alt' when it is picked, so a caller that passes one must
      // test for it before treating the result as a yes.
      altLabel: options.altLabel || null,
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
      // Optional one-tap quick-fill chips (e.g. canned rejection reasons).
      suggestions: Array.isArray(options.suggestions) ? options.suggestions : null,
      confirmLabel: options.confirmLabel || 'Save',
      cancelLabel: options.cancelLabel || 'Cancel',
      resolve,
    });
  }), []);

  // Grouped toasts (lib/toastGroup.js): which live toast each group key is
  // showing in, and each toast's expiry timer, so a merge can restart it.
  const groupsRef = useRef(new Map());
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    releaseToastGroup(groupsRef.current, id);
    window.clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    // Flag for the exit animation, then remove after it plays.
    setToasts(current => current.map(item => item.id === id ? { ...item, exiting: true } : item));
    window.setTimeout(() => {
      setToasts(current => current.filter(item => item.id !== id));
    }, TOAST_EXIT_MS);
  }, []);
  // Mirror of the toasts state so the manual-dismiss path can read the item
  // outside a setState updater (updaters double-invoke under StrictMode, and a
  // side effect there would fire onDismiss twice).
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  // Hand-dismiss (the toast X). Distinct from the TTL-expiry path so a toast's
  // onDismiss means "the user saw this and closed it" — expiry stays silent.
  // Skips toasts already exiting: an X clicked during the expiry exit animation
  // is the timer's dismissal, not the user's.
  const dismissToastManual = useCallback((id) => {
    const item = toastsRef.current.find(t => t.id === id);
    if (item && !item.exiting) {
      try { item.onDismiss?.(); } catch (_) { /* never block the dismiss */ }
    }
    dismissToast(id);
  }, [dismissToast]);
  // `group` + `groupMessage(n)`: a toast for a group already on screen joins
  // that toast instead of stacking another ("3 uploads failed"), taking the
  // newest action and restarting its timer.
  //
  // Returns a function that takes the toast down early — for a "working on
  // it" toast whose work has finished. Callers that ignore it lose nothing.
  // `code`: a toast that says something failed names the failure, in
  // snake_case. It is how the failure is reported (lib/errorReporting.js),
  // since the text can quote a name; one without a code is 'uncoded'.
  const toast = useCallback(({ type = 'info', message, code = null, action = null, actions = null, ttl = 4200, onDismiss = null, group = null, groupMessage = null }) => {
    if (!message) return () => {};
    if (type === 'error' || type === 'warning') reportToast(type, code, group);
    // Capture Mode (admin-only) mutes toasts so a stray "Copied" or an undo
    // strip can't land in the middle of a take. Read from the module rather
    // than React state on purpose: `toast` sits in the useMemo'd context value
    // below, so making it depend on a flag would re-render the entire app tree
    // every time the flag flipped. confirm/prompt are deliberately NEVER muted
    // — they block a flow, and silently resolving one would strand the caller.
    if (isSilenced()) return () => {};
    const fresh = nextId.current++;
    const placed = placeGroupedToast(groupsRef.current, { group, message, groupMessage }, fresh);
    const id = placed.id;
    const text = placed.message;
    const list = Array.isArray(actions) && actions.length ? actions.filter(Boolean) : null;
    const item = { id, type, message: text, action, actions: list, onDismiss, group, exiting: false };
    setToasts(current => (placed.merged && current.some(t => t.id === id)
      ? current.map(t => (t.id === id ? item : t))
      : [...current, item]));
    const first = list?.[0] || action;
    // Parity from `fresh`, not `id`: a merged toast keeps its id, and the
    // announcement still has to change to be spoken again.
    const spoken = `${text}${first ? ` — ${(list || [first]).map((a) => a.label || 'Undo').join(', ')} available` : ''}${fresh % 2 ? '\u00a0' : ''}`;
    setAnnounce(type === 'error' ? { polite: '', alert: spoken } : { polite: spoken, alert: '' });
    window.clearTimeout(timersRef.current.get(id));
    timersRef.current.set(id, window.setTimeout(() => dismissToast(id), Math.max(1000, ttl)));
    return () => dismissToast(id);
  }, [dismissToast]);

  const value = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);
  // Dev only: a spec raises a real toast through this (error-collection.spec.js).
  if (import.meta.env.DEV && typeof window !== 'undefined') window.__soleilToast = toast;

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce.polite}</div>
      <div className="sr-only" role="alert" aria-atomic="true">{announce.alert}</div>
      {(dialog || toasts.length > 0) && (
        <Suspense fallback={null}>
          <FeedbackOverlay
            dialog={dialog}
            onCloseDialog={closeDialog}
            toasts={toasts}
            onDismissToast={dismissToast}
            onManualDismiss={dismissToastManual}
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

// For components that also render outside the provider (the DEV QA harnesses
// mount cards and the lightbox bare): null there instead of a throw.
export function useOptionalFeedback() {
  return useContext(FeedbackContext);
}
