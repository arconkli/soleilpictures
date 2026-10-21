import { useCallback, useLayoutEffect, useRef } from 'react';
import { isComposingKey } from '../lib/composerKeys.js';
import { fieldKeepsKey, rovingIndex, rovingMove } from '../lib/toolbarRoving.js';

// What role="toolbar" promises a keyboard (the WAI-ARIA toolbar pattern): the
// whole bar is one Tab stop, and the arrow keys walk its controls, ← → across
// it (↑ ↓ down the tool rail), Home and End to either end, round from the last
// to the first. The bars said "toolbar" and gave Tab a stop for every control,
// thirty on the doc's, and no arrow moved.
//
//   const barRef = useRef(null);
//   const onKeyDown = useToolbarRoving(barRef);              // { orientation: 'vertical' }
//   <div role="toolbar" aria-label="…" ref={barRef} onKeyDown={onKeyDown}>
//
//  - The stop is the first control the bar can use (one turned off while
//    the editor loads hands it on, and takes it back once it's on), until
//    the arrows, a click or a focus leave it on another; a control that goes,
//    or is turned off, hands it back to the first.
//    Every other control in the bar is tabIndex -1, set on the element: the
//    bars' controls come from many components, and none of them has to know.
//  - A control keeps the keys it needs (lib/toolbarRoving.fieldKeepsKey): a
//    text field its caret until the caret is at its edge, a list ↑ ↓.
//  - A menu, a list or a dialog inside the bar is its own (the rail's +), and
//    a key in a popover portaled out of it isn't the bar's either, though
//    React bubbles it here. A key a control already handled
//    (defaultPrevented) is left alone, and so is one mid-syllable.
//  - The bar can come and go with what it shows, or be another element (the
//    tool options bar is one per tool): it is looked for after every render.
const CONTROLS = 'button, [role="button"], [role="switch"], input, select, textarea, a[href]';
const OWN_WIDGET = '[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"]';

function inOwnWidget(bar, el) {
  const w = el.parentElement?.closest(OWN_WIDGET);
  return !!w && w !== bar && bar.contains(w);
}
// Every control of the bar's own, shown or not.
function controlsOf(bar) {
  return [...bar.querySelectorAll(CONTROLS)].filter((el) => el.type !== 'hidden' && !inOwnWidget(bar, el));
}
const usable = (el) => !el.disabled && el.getClientRects().length > 0;

function controlOf(bar, target) {
  const el = target?.closest?.(CONTROLS);
  return el && bar.contains(el) && !inOwnWidget(bar, el) ? el : null;
}

function attach(bar, s) {
  const settle = () => {
    const all = controlsOf(bar);
    if (!(s.moved && all.includes(s.current) && usable(s.current))) {
      s.current = all.find(usable) || null;
      s.moved = false;
    }
    for (const el of all) {
      const t = el === s.current ? 0 : -1;
      if (el.tabIndex !== t) el.tabIndex = t;
    }
  };
  const onFocusIn = (e) => {
    const el = controlOf(bar, e.target);
    if (!el || (el === s.current && s.moved)) return;
    s.current = el;
    s.moved = true;
    settle();
  };
  // Attached with the focus already in it: that control holds the stop.
  const active = controlOf(bar, document.activeElement);
  if (active) { s.current = active; s.moved = true; }
  settle();
  // Controls come and go with the mode (a doc's screenplay controls, a note's
  // comment button), and turn on and off with the selection (Add link).
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(settle);
  mo?.observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  bar.addEventListener('focusin', onFocusIn);
  // A media query can hide the control holding the stop.
  window.addEventListener('resize', settle);
  return () => {
    mo?.disconnect();
    bar.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('resize', settle);
  };
}

export function useToolbarRoving(ref, { orientation = 'horizontal' } = {}) {
  const live = useRef({ el: null, current: null, moved: false, off: null });
  useLayoutEffect(() => {
    const s = live.current;
    const el = ref.current || null;
    if (el === s.el) return;
    s.off?.();
    s.off = null;
    s.el = el;
    s.current = null;
    s.moved = false;
    if (el) s.off = attach(el, s);
  });
  useLayoutEffect(() => () => {
    const s = live.current;
    s.off?.();
    s.off = null;
    s.el = null;
  }, []);

  return useCallback((e) => {
    const bar = live.current.el;
    if (!bar || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isComposingKey(e)) return;
    const move = rovingMove(e.key, orientation);
    if (move == null) return;
    const from = controlOf(bar, e.target);
    if (!from || fieldKeepsKey(e.target, e.key)) return;
    const items = controlsOf(bar).filter(usable);
    const i = items.indexOf(from);
    if (i < 0) return;
    // The bar's, and nothing behind it hears it.
    e.preventDefault();
    e.stopPropagation();
    items[rovingIndex(i, items.length, move)].focus();
  }, [orientation]);
}
