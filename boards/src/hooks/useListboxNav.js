import { useEffect, useRef, useState } from 'react';

// Roving-index keyboard navigation for a flat list of selectable items
// (search results, menu rows, emoji grid). Shared so every picker gets the
// same Arrow/Enter behavior + scroll-into-view instead of hand-rolling it
// (most pickers had none).
//
//   const { active, setActive, onKeyDown, registerItem } =
//     useListboxNav(items.length, { onSelect: (i) => items[i].activate(), resetKey: query });
//
// - Wire onKeyDown to the input/container that has focus.
// - Spread ref={registerItem(i)} onto each row and mark active === i.
// - resetKey: when it changes (e.g. a new query) the active index resets to 0.
// Escape is intentionally NOT handled here — popovers own their own dismissal.
export function useListboxNav(itemCount, { onSelect, resetKey } = {}) {
  const [active, setActive] = useState(0);
  const refs = useRef([]);

  useEffect(() => { setActive(0); }, [resetKey]);

  // Keep the active index in range as the list shrinks/grows.
  useEffect(() => {
    if (itemCount === 0) { if (active !== 0) setActive(0); return; }
    if (active > itemCount - 1) setActive(itemCount - 1);
  }, [itemCount, active]);

  // Scroll the active row into view (nearest edge — no jumpy centering).
  useEffect(() => {
    refs.current[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, itemCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
      if (itemCount > 0) { e.preventDefault(); onSelect?.(active); }
    }
  };

  const registerItem = (i) => (el) => { refs.current[i] = el; };

  return { active, setActive, onKeyDown, registerItem };
}
