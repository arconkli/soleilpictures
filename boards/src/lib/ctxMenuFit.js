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

// Top for a menu of height `h` that has to end at `bottom`, over what opened
// it (the selection bar's ⋯, at the foot of the window): right above it, or
// from the top pad, scrolling, when the room above is shorter than the menu.
export function fitMenuAbove(bottom, h, pad = MENU_PAD) {
  return Math.max(pad, bottom - h);
}

// Runs after every render (the content can change while open: tags and the
// backlink count load after it opens), writes the fitted top, and caps the
// height to what is left below it so anything taller scrolls. `above`: `y` is
// where the menu ends (fitMenuAbove), and what's loading is reserved over it.
//
// A menu that scrolls hides its scrollbar (styles.css), so while rows wait
// below the fold it carries has-more-below, which fades its foot; so does a
// stepped-in submenu's .ctx-step-body, the part of it that scrolls. Marked
// here after every render, on scroll, and on a resize (which re-fits too).
export function useFitMenuToViewport(ref, open, y, reserve = 0, above = false) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof window === 'undefined') return undefined;
    const body = el.querySelector(':scope > .ctx-step-body');
    const mark = () => {
      for (const s of [el, body]) {
        if (s) s.classList.toggle('has-more-below', s.scrollTop + s.clientHeight < s.scrollHeight - 1);
      }
    };
    const fit = () => {
      // The window, down to the phone shell's tab bar when it shows (.mb-nav,
      // fixed to the foot): a menu ends over the bar, not under it. The bar is
      // fixed, so its box says whether it shows (hidden, it has none; slid
      // away, its top is past the window's).
      const nav = document.querySelector('.mb-nav')?.getBoundingClientRect();
      const navTop = nav && nav.height > 0 ? nav.top : Infinity;
      const viewH = Math.min(window.innerHeight, navTop);
      // The last fit's cap, off a stepped-in submenu: it shrinks to it (its
      // rows scroll inside), and would measure as short as the cap. The menu's
      // own rows keep theirs: its scrollHeight is its full height under it.
      if (el.classList.contains('is-step')) el.style.maxHeight = '';
      // scrollHeight is the full content height even while max-height clips it;
      // add the border, which it leaves out.
      const h = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      if (above) {
        const top = fitMenuAbove(y, h + reserve);
        el.style.top = `${top}px`;
        el.style.maxHeight = `${y - top}px`;
      } else {
        const top = fitMenuTop(y, h, viewH, reserve);
        el.style.top = `${top}px`;
        // With no bar under it, the home indicator's strip is kept clear too.
        const room = viewH - top - MENU_PAD;
        el.style.maxHeight = navTop < window.innerHeight
          ? `${room}px`
          : `calc(${room}px - env(safe-area-inset-bottom, 0px))`;
      }
      mark();
    };
    fit();
    el.addEventListener('scroll', mark, { passive: true });
    body?.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', fit);
    return () => {
      el.removeEventListener('scroll', mark);
      body?.removeEventListener('scroll', mark);
      window.removeEventListener('resize', fit);
    };
  });
}
