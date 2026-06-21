// Subscribe a component to the app theme (`<html data-theme>`), the single
// source of truth applied by lib/theme.js. This is NOT a second theme store —
// it only *observes* the one attribute, via a single shared MutationObserver,
// so read-only surfaces (notes on the canvas) that compute theme-dependent
// colors in JS re-render when the user flips light/dark.

import { useSyncExternalStore } from 'react';
import { currentTheme } from './theme.js';

let snapshot = typeof document !== 'undefined' ? currentTheme() : 'dark';
const listeners = new Set();
let observer = null;

function notify() {
  const next = currentTheme();
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => { try { l(); } catch (_) { /* noop */ } });
}

function subscribe(listener) {
  listeners.add(listener);
  if (!observer && typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(notify);
    try { observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); }
    catch (_) { /* noop */ }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer) { observer.disconnect(); observer = null; }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => 'dark';

// Returns 'light' | 'dark' and re-renders on change.
export function useThemeAttr() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
