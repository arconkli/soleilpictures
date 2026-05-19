import { useEffect, useRef } from 'react';

// Long-press detector that wires into a target element via ref.
// Fires `onLongPress(clientX, clientY, originalEvent)` when the user
// holds a pointer down at one position for `ms` milliseconds without
// moving more than `tolerance` pixels.
//
// Why a custom hook over @use-gesture's useDrag with delay/threshold:
//   - We need to coexist with the canvas's existing onPointerDown
//     handlers (drag-to-pan, lasso, card move) without stealing the
//     event stream. This hook listens at the capture phase and only
//     triggers if the user holds in place — never blocks normal drags.
//   - The original onContextMenu (right-click) keeps working for mice;
//     this hook only adds a touch equivalent.
//
// Usage:
//   const longPressRef = useLongPress(wrapRef, (x, y, e) => {
//     openContextMenu({ x, y, source: e });
//   }, { ms: 480, tolerance: 8, pointerType: 'touch' });
export function useLongPress(targetRef, onLongPress, opts = {}) {
  const { ms = 480, tolerance = 8, pointerType } = opts;
  const handlerRef = useRef(onLongPress);
  handlerRef.current = onLongPress;

  useEffect(() => {
    const el = targetRef?.current;
    if (!el || typeof handlerRef.current !== 'function') return;

    let timer = null;
    let startX = 0, startY = 0;
    let armedEvent = null;

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      armedEvent = null;
    };

    const onDown = (e) => {
      if (pointerType && e.pointerType !== pointerType) return;
      // Only the primary pointer arms — secondary touches in a pinch
      // shouldn't open a context menu.
      if (e.isPrimary === false) return;
      startX = e.clientX;
      startY = e.clientY;
      armedEvent = e;
      timer = setTimeout(() => {
        if (!armedEvent) return;
        handlerRef.current(startX, startY, armedEvent);
        cancel();
      }, ms);
    };

    const onMove = (e) => {
      if (!armedEvent) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy > tolerance * tolerance) cancel();
    };

    const onEnd = () => { cancel(); };

    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onEnd, { passive: true });
    el.addEventListener('pointercancel', onEnd, { passive: true });
    el.addEventListener('pointerleave', onEnd, { passive: true });
    return () => {
      cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('pointerleave', onEnd);
    };
  }, [targetRef, ms, tolerance, pointerType]);
}
