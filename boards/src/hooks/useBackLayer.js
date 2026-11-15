import { useEffect, useRef } from 'react';
import { registerBackLayer } from '../lib/modalGuard.js';

// The same question useBreakpoint's isTouch asks: is a finger the pointer?
// Phones, iPads in either shell, the Capacitor app. A computer with a mouse
// answers no, and gets no history entries for its panels.
const TOUCH_Q = '(hover: none) and (pointer: coarse)';
export function fingerIsPointer() {
  try { return !!window.matchMedia?.(TOUCH_Q)?.matches; } catch (_) { return false; }
}

// On touch, the phone's Back (or the iOS edge swipe) closes this panel while
// it is open instead of leaving the cluster or the app: a layer in
// lib/modalGuard, as shell/Sheet.jsx is. One layer per panel: don't add this
// to something already inside a Modal or a Sheet, or one Back pops two things.
export function useBackLayer(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // No close handler, no layer: it would eat a Back without closing, and
    // the next Back would navigate with the panel still up.
    if (!open || !fingerIsPointer() || typeof closeRef.current !== 'function') return undefined;
    return registerBackLayer(() => closeRef.current?.());
  }, [open]);
}
