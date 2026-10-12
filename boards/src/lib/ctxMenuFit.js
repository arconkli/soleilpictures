// Keep a right-click menu inside the window by MEASURING it.
//
// The card and canvas menus used to place themselves from a row-count guess
// (items × 30px). Real rows are 33px on a mouse (32px + 1px gap) and 40px on
// touch, and headers/dividers counted as rows, so a menu opened low on the
// screen ran past the bottom edge — on a touch tablet far enough that Delete
// could not be reached, because the menu was shorter than its max-height and
// so never scrolled. The guess still seeds the first render; this corrects it
// from the rendered box before paint.

import { useLayoutEffect } from 'react';

export const MENU_PAD = 8;

// Top for a menu of height `h` (plus `reserve` px of content still loading)
// asked to open at `y` in a window `viewH` tall. Floored at the top pad: a menu
// taller than the window starts at the top and scrolls.
export function fitMenuTop(y, h, viewH, reserve = 0, pad = MENU_PAD) {
  const need = Math.min(h + reserve, viewH - 2 * pad);
  return Math.max(pad, Math.min(y, viewH - need - pad));
}

// Runs after every render (the content can change while open: tags and the
// backlink count load after it opens), writes the fitted top, and caps the
// height to what is left below it so anything taller scrolls.
export function useFitMenuToViewport(ref, open, y, reserve = 0) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof window === 'undefined') return;
    const viewH = window.innerHeight;
    // scrollHeight is the full content height even while max-height clips it;
    // add the border, which it leaves out.
    const h = el.scrollHeight + (el.offsetHeight - el.clientHeight);
    const top = fitMenuTop(y, h, viewH, reserve);
    el.style.top = `${top}px`;
    el.style.maxHeight = `${viewH - top - MENU_PAD}px`;
  });
}
