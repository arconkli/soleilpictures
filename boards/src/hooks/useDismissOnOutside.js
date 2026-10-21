import { useLayoutEffect, useRef } from 'react';
import { isComposingKey } from '../lib/composerKeys.js';

// Dismiss a popover / menu / dropdown when the user interacts OUTSIDE it.
//
// Registers BOTH `pointerdown` and `mousedown` in the CAPTURE phase. This is the
// lesson learned in ColorPicker.jsx: on touch a tap fires pointer events first,
// and a synthesized `mousedown` may never arrive if a card's pointer handler
// calls stopPropagation — so a mousedown-only outside-listener leaves popovers
// stuck open on phones. Capturing pointerdown closes them on tap-outside, while
// mousedown stays as the desktop/compat fallback. Escape also closes by default.
//
// It listens from a layout effect, so from the moment the popover is on
// screen, and counts only a press that began after that. The press that
// opened it can still be on its way: its pointerdown came before this was
// listening, and the mousedown a browser makes from it follows (after a tap,
// once the finger lifts, and WebKit stamps it with that later moment). So a
// mousedown counts only behind a pointerdown this has seen. It used to wait
// out a timeout(0) instead, and a browser delivers input before timers, so a
// press soon after the popover appeared went unseen and left it open.
//
// Usage:
//   const ref = useRef(null);
//   useDismissOnOutside(ref, open, onClose);            // open is a boolean
//   useDismissOnOutside(ref, true, onClose);            // always-on while mounted
//   useDismissOnOutside(ref, open, onClose, { escapeCapture: true });
export function useDismissOnOutside(ref, isOpen, onClose, options = {}) {
  const { escape = true, escapeCapture = false, ignore = null } = options;
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (isOpen === false) return undefined;
    const since = performance.now();
    let pressed = typeof window !== 'undefined' && !window.PointerEvent;
    const onDocDown = (e) => {
      if (e.timeStamp && e.timeStamp < since) return;
      if (e.type === 'pointerdown') pressed = true;
      else if (!pressed) return;
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      // Opt-in escape hatch: a portaled control can have an interactive sibling
      // OUTSIDE its ref (e.g. a drag layer over a grid cell) that must NOT count
      // as an outside-tap. Default null → unchanged for every other caller.
      if (ignore && e.target?.closest?.(ignore)) return;
      onCloseRef.current?.();
    };
    // An Escape mid-syllable is the input method's: it drops the syllable,
    // and the popover stays (lib/modalGuard.js stands down the same way).
    const onKey = (e) => { if (e.key === 'Escape' && !isComposingKey(e)) onCloseRef.current?.(); };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    if (escape) window.addEventListener('keydown', onKey, escapeCapture);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      if (escape) window.removeEventListener('keydown', onKey, escapeCapture);
    };
  }, [isOpen, escape, escapeCapture, ref, ignore]);
}
