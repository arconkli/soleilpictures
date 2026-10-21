import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
//  - A bar that formats a text (a doc's, a note's) is handed `text`, which
//    returns what it formats: a Tiptap editor, or a plain contenteditable.
//    The text keeps Tab (an indent, two spaces, a screenplay's next element),
//    so the keyboard had no way from the words to their bar: ⌥F10 in the text
//    goes to the bar's stop, as in other editors, and Escape in the bar goes
//    back to the text with the caret where it was. Focusing the text isn't
//    enough for that: a field in the bar takes the page's selection, and the
//    text then takes the focus with its caret at the start. An editor puts its
//    own selection back (its focus()); a plain one is given back the range ⌥F10
//    left it with. The bar says so with aria-keyshortcuts="Alt+F10".
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

// What a bar formats, if it's on the page: the element its keys come from,
// and the editor behind it (none for a plain contenteditable).
function textOf(getText) {
  try {
    const t = getText?.();
    const el = t?.view?.dom || (t?.nodeType === 1 ? t : null);
    if (!el || !el.isConnected || t.isDestroyed) return null;
    return { el, editor: el === t ? null : t };
  } catch (_) { return null; }
}

// The page's selection, if it's inside `el`.
function rangeIn(el) {
  const sel = window.getSelection?.();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return el.contains(r.startContainer) && el.contains(r.endContainer) ? r.cloneRange() : null;
}

export function useToolbarRoving(ref, { orientation = 'horizontal', text = null } = {}) {
  const live = useRef({ el: null, current: null, moved: false, off: null, caret: null });
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

  // ⌥F10 in the text: to the bar's stop.
  const textRef = useRef(text);
  useLayoutEffect(() => { textRef.current = text; });
  const formatsText = !!text;
  useEffect(() => {
    if (!formatsText) return undefined;
    const onKey = (e) => {
      if (e.key !== 'F10' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.defaultPrevented || isComposingKey(e)) return;
      const s = live.current;
      const bar = s.el;
      const home = textOf(textRef.current);
      if (!bar || !home || !home.el.contains(e.target)) return;
      const stop = s.current && bar.contains(s.current) && usable(s.current) ? s.current : controlsOf(bar).find(usable);
      if (!stop) return;
      e.preventDefault();
      e.stopPropagation();
      s.caret = home.editor ? null : rangeIn(home.el);
      stop.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [formatsText]);

  return useCallback((e) => {
    const bar = live.current.el;
    if (!bar || e.defaultPrevented || isComposingKey(e)) return;
    const mods = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
    // Escape: back to the text, where the caret was.
    if (e.key === 'Escape' && !mods) {
      const home = textOf(textRef.current);
      if (!home || !controlOf(bar, e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (home.editor) { home.editor.commands.focus(); return; }
      home.el.focus({ preventScroll: true });
      const r = live.current.caret;
      if (r && home.el.contains(r.startContainer) && home.el.contains(r.endContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    if (mods) return;
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
