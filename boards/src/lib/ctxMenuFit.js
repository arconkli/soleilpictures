// Keep a right-click menu inside the window by MEASURING it.
//
// The card and canvas menus used to place themselves from a row-count guess
// (items × 30px). Real rows are 33px on a mouse (32px + 1px gap) and 40px on
// touch, and headers/dividers counted as rows, so a menu opened low on the
// screen ran past the bottom edge — on a touch tablet far enough that Delete
// could not be reached, because the menu was shorter than its max-height and
// so never scrolled. The guess still seeds the first render; this corrects it
// from the rendered box before paint.

import { useLayoutEffect, useRef } from 'react';

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

// Runs after every render (the content can change while open: the
// backlink count loads after it opens), writes the fitted top, and caps the
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

// ── The one menu's placement (pure: numbers in, numbers out) ──────────────
// `x`,`y` the pointer; `w`,`h` the menu's measured box; `vw`,`vh` the window.
// `top`/`bottom` bound the room (bottom already excludes the phone's tab bar
// and the home-bar inset). Opens right of the pointer, else to its left (the
// origin is then the right edge); below it, else flipped up (origin bottom),
// else pinned to the foot, else from the top, scrolling (maxHeight). The press
// point is first pulled inside the margin, so a press near an edge still
// leaves the menu at least `pad` from every window edge.
export function placeMenu({ x, y, w, h, vw, vh, pad = MENU_PAD, top = pad, bottom = vh - pad, above = false }) {
  const px = Math.min(Math.max(x, pad), vw - pad);
  const py = Math.min(Math.max(y, top), bottom);
  let left;
  let originX = 'left';
  if (px + w <= vw - pad) left = px;
  else if (px - w >= pad) { left = px - w; originX = 'right'; }
  else left = Math.max(pad, vw - w - pad);

  let t;
  let maxHeight;
  let originY = 'top';
  if (above) {
    t = Math.max(top, py - h);
    originY = 'bottom';
    if (h > py - top) maxHeight = py - t;
  } else if (py + h <= bottom) {
    t = py;
  } else if (py - h >= top) {
    t = py - h;
    originY = 'bottom';
  } else if (h <= bottom - top) {
    t = bottom - h;
    originY = 'bottom';
  } else {
    t = top;
    maxHeight = bottom - top;
  }
  return { left, top: t, maxHeight, originX, originY };
}

// A flyout for a row of a menu at `menu` ({left,right,top,bottom}); `row.top`
// the row's top. 2px off the menu's edge, its first row lined up with the row
// (4px up for the menu's padding), moved up to fit. `side` null: no room on
// either side (the caller steps in, or clamps inside the window).
export function placeFlyout({ menu, row, w, h, vw, vh, pad = MENU_PAD, prefer = 'right' }) {
  const GAP = 2;
  const fitsRight = menu.right + GAP + w <= vw - pad;
  const fitsLeft = menu.left - GAP - w >= pad;
  let side = null;
  if (prefer === 'left') side = fitsLeft ? 'left' : fitsRight ? 'right' : null;
  else side = fitsRight ? 'right' : fitsLeft ? 'left' : null;
  let left;
  if (side === 'right') left = menu.right + GAP;
  else if (side === 'left') left = menu.left - GAP - w;
  else left = Math.max(pad, Math.min(menu.right + GAP, vw - w - pad));
  const room = vh - 2 * pad;
  let t = row.top - 4;
  let maxHeight;
  if (h > room) { t = pad; maxHeight = room; } else t = Math.max(pad, Math.min(t, vh - h - pad));
  return { left, top: t, maxHeight, side };
}

// The room a menu may use: the window down to the phone shell's tab bar
// (.mb-nav, fixed to the foot) when it shows, else down to the home bar's
// inset. Measured the way useFitMenuToViewport does.
function viewRoom() {
  const nav = document.querySelector('.mb-nav')?.getBoundingClientRect();
  const navTop = nav && nav.height > 0 ? nav.top : Infinity;
  let bottom = Math.min(window.innerHeight, navTop);
  if (!(navTop < window.innerHeight)) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    bottom -= probe.offsetHeight;
    probe.remove();
  }
  return { vw: window.innerWidth, vh: window.innerHeight, bottom: bottom - MENU_PAD };
}

// Measures the menu and places it with placeMenu, after every render (rows
// load while it is open). Hidden until its first placement, so nothing jumps.
// Writes left/top/maxHeight, --ctx-ox/--ctx-oy (the animation grows from the
// pointer's corner) and has-more-below (the foot fades while rows wait below
// the fold; so does a stepped-in .ctx-step-body). Re-places on resize.
export function useMenuPlacement(ref, open, { x, y, above = false } = {}) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open) placed.current = false;
    if (!open || !el || typeof window === 'undefined') return undefined;
    const body = el.querySelector(':scope > .ctx-step-body');
    const mark = () => {
      for (const s of [el, body]) {
        if (s) s.classList.toggle('has-more-below', s.scrollTop + s.clientHeight < s.scrollHeight - 1);
      }
    };
    const fit = () => {
      if (!placed.current) el.style.visibility = 'hidden';
      // A fixed box shrinks toward the window's edge: measure from the left
      // edge, and with no cap from the last fit (a stepped-in menu shrinks to it).
      el.style.left = '0px';
      if (el.classList.contains('is-step')) el.style.maxHeight = '';
      const w = el.offsetWidth;
      const h = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      const { vw, vh, bottom } = viewRoom();
      const p = placeMenu({ x, y, w, h, vw, vh, bottom, above });
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      el.style.maxHeight = p.maxHeight != null ? `${p.maxHeight}px` : '';
      el.style.setProperty('--ctx-ox', p.originX === 'right' ? '100%' : '0%');
      el.style.setProperty('--ctx-oy', p.originY === 'bottom' ? '100%' : '0%');
      if (!placed.current) { placed.current = true; el.style.visibility = ''; }
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

// The phone sheet's list scrolls inside the sheet (.ctx-menu.is-sheet); while
// rows wait below its fold it carries has-more-below (so does a stepped-in
// .ctx-step-body), which fades its foot. Marked after every render (a step in
// or out changes what scrolls), on scroll and on a resize.
export function useMoreBelow(ref, active) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof window === 'undefined') return undefined;
    const body = el.querySelector(':scope > .ctx-step-body');
    const mark = () => {
      for (const s of [el, body]) {
        if (s) s.classList.toggle('has-more-below', s.scrollTop + s.clientHeight < s.scrollHeight - 1);
      }
    };
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    body?.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    // The sheet slides up and its panel is capped after layout: re-mark on a box change.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(mark) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', mark);
      body?.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
      ro?.disconnect();
    };
  });
}
