import { useEffect, useRef } from 'react';

// Dismiss a popover / menu / dropdown when the user interacts OUTSIDE it.
//
// Registers BOTH `pointerdown` and `mousedown` in the CAPTURE phase. This is the
// lesson learned in ColorPicker.jsx: on touch a tap fires pointer events first,
// and a synthesized `mousedown` may never arrive if a card's pointer handler
// calls stopPropagation — so a mousedown-only outside-listener leaves popovers
// stuck open on phones. Capturing pointerdown closes them on tap-outside, while
// mousedown stays as the desktop/compat fallback. Escape also closes by default.
//
// The `armed` timeout(0) prevents the very click/tap that opened the popover
// from immediately closing it again (the opening event can still be in flight
// when this effect attaches).
//
// Usage:
//   const ref = useRef(null);
//   useDismissOnOutside(ref, open, onClose);            // open is a boolean
//   useDismissOnOutside(ref, true, onClose);            // always-on while mounted
//   useDismissOnOutside(ref, open, onClose, { escapeCapture: true });
export function useDismissOnOutside(ref, isOpen, onClose, options = {}) {
  const { escape = true, escapeCapture = false, ignore = null } = options;
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (isOpen === false) return undefined;
    let armed = false;
    const t = setTimeout(() => { armed = true; }, 0);
    const onDocDown = (e) => {
      if (!armed) return;
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      // Opt-in escape hatch: a portaled control can have an interactive sibling
      // OUTSIDE its ref (e.g. a drag layer over a grid cell) that must NOT count
      // as an outside-tap. Default null → unchanged for every other caller.
      if (ignore && e.target?.closest?.(ignore)) return;
      onCloseRef.current?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    if (escape) window.addEventListener('keydown', onKey, escapeCapture);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      if (escape) window.removeEventListener('keydown', onKey, escapeCapture);
    };
  }, [isOpen, escape, escapeCapture, ref, ignore]);
}
