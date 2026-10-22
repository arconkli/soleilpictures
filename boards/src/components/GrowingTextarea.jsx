import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useAutosizeTextarea } from '../hooks/useAutosizeTextarea.js';

// A textarea that grows with its text, up to `maxLines` or `maxShare` of the
// Messages panel, then scrolls inside itself. The ref is the <textarea>.
//   focusAtEnd — take focus on mount with the caret after the text, where an
//   edit carries on from (autoFocus would leave it at the start).
export const GrowingTextarea = forwardRef(function GrowingTextarea({ value, maxLines = 8, maxShare = 0.4, focusAtEnd = false, ...props }, ref) {
  const inner = useRef(null);
  useImperativeHandle(ref, () => inner.current, []);
  useAutosizeTextarea(inner, value, { maxLines, maxShare });
  useEffect(() => {
    const el = inner.current;
    if (!focusAtEnd || !el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch (_) {}
    el.scrollTop = el.scrollHeight;
  }, [focusAtEnd]);
  return <textarea ref={inner} rows={1} value={value} {...props} />;
});
