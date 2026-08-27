// Finger-scrolling for scroll containers that live INSIDE the canvas.
//
// Why this exists at all: `.canvas-wrap { touch-action: none }` tells the
// browser "I own every gesture here" so useGesture can run pinch-zoom and
// two-finger pan. But touch-action INTERSECTS down the ancestor chain — a
// descendant can only narrow it, never re-widen it — so that one declaration
// also makes every scroll container inside a card (a clipped note body, a grid
// cell, the schedule peek, the phone tool rail) impossible to scroll with a
// finger. No CSS on the descendant can undo it.
//
// So we drive the scroll ourselves, which is exactly what the wheel handler in
// CanvasSurface already does for the mouse: it early-returns (no
// preventDefault) over a clipped note so the browser performs its own native
// overflow scroll. Touch has no such escape hatch, so instead of "let the
// browser do it" we set scrollTop directly from the pointer delta.
//
// The ARMING rule mirrors that wheel carve-out: a container that lives in card
// CONTENT only scrolls once the card is selected or being edited. Otherwise a
// one-finger drag across a big note could never pan the board — on a dense
// canvas you'd be trapped. Chrome scrollers (the tool rail) and containers that
// only exist in an already-deliberate open state (schedule peek, grid cell
// editor) are always armed.

import { trackStroke } from './pointerStroke.js';

// Vertical scroll containers inside .canvas-wrap, and whether they require the
// owning card to be selected/editing before a finger drag scrolls them.
const CONTAINERS = [
  { sel: '.note-body', requireActive: true },
  { sel: '.gc-text', requireActive: true },
  { sel: '.gc-text-edit', requireActive: false },
  { sel: '.schedc-peekbody', requireActive: false },
  // Listed BEFORE .cnv-tools deliberately — the templates panel lives inside
  // the rail, so without its own entry findTouchScrollable climbs past it and
  // a drag over the template list scrolls the rail behind it.
  { sel: '.tplt-scroll', requireActive: false },
  { sel: '.cnv-tools', requireActive: false },
];

const SELECTOR = CONTAINERS.map(c => c.sel).join(', ');

// 1px slack: sub-pixel layout rounding routinely leaves scrollHeight a hair
// above clientHeight on a container that has nothing to scroll.
const OVERFLOW_EPS = 1;

export function canScrollVertically(el) {
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + OVERFLOW_EPS;
}

// "Active" = the user has already committed attention to this card: it's
// selected, something in it is being edited, or the container itself is a live
// contenteditable. Matches the wheel handler's isEditing/isSelected pair.
export function isTouchScrollArmed(el) {
  if (!el) return false;
  const entry = CONTAINERS.find(c => el.matches?.(c.sel));
  if (!entry) return false;
  if (!entry.requireActive) return true;
  if (el.getAttribute?.('contenteditable') === 'true') return true;
  if (el.closest?.('.is-editing')) return true;
  if (el.closest?.('.card.is-selected')) return true;
  return false;
}

// Nearest armed, actually-overflowing scroll container at or above `target`.
// Returns null when the gesture should fall through to the canvas (pan / lift /
// marquee), which is the common case.
export function findTouchScrollable(target) {
  let el = target?.closest?.(SELECTOR);
  while (el) {
    if (canScrollVertically(el) && isTouchScrollArmed(el)) return el;
    // Keep climbing: a non-overflowing inner container must not shadow a
    // scrollable outer one (e.g. a grid cell inside the tool rail).
    el = el.parentElement?.closest?.(SELECTOR) || null;
  }
  return null;
}

// Apply a finger delta. `dy` is the pointer's movement in CSS px (finger down
// the screen = positive), so the content moves the opposite way. Returns the
// number of pixels actually consumed — 0 means the container is pinned at that
// end, which callers use to decide nothing more should happen (we deliberately
// do NOT hand the remainder back to canvas pan; the wheel path behaves the same
// way and the predictability is worth more than rubber-banding).
export function driveTouchScroll(el, dy) {
  if (!el || !dy) return 0;
  const before = el.scrollTop;
  const max = el.scrollHeight - el.clientHeight;
  const next = Math.max(0, Math.min(max, before - dy));
  if (next === before) return 0;
  el.scrollTop = next;
  return next - before;
}

// Self-contained gesture for surfaces that never reach CanvasSurface's card
// pointer handler — an editing note (NoteTiptapSurface stops propagation so
// canvas drags can't hijack typing) and the phone tool rail (the background
// handler bails on .cnv-tools before any pan starts). CanvasSurface's own
// non-editing-card path integrates with its existing pan/lift state machine
// instead of calling this.
//
// Deliberately does NOT preventDefault at pointerdown: a plain tap must still
// place the caret / activate the control. The scroll only engages once the
// finger passes `threshold`, at which point nothing else is watching anyway.
// Returns true if a scrollable was found and the gesture is being tracked.
export function startTouchScrollGesture(e, { threshold = 10 } = {}) {
  if (e.pointerType !== 'touch' || !e.isPrimary) return false;
  const el = findTouchScrollable(e.target);
  if (!el) return false;
  const startY = e.clientY;
  let lastY = startY;
  let engaged = false;
  trackStroke({
    pointerId: e.pointerId,
    onSample: (ev) => {
      if (!engaged && Math.abs(ev.clientY - startY) > threshold) engaged = true;
      if (engaged) driveTouchScroll(el, ev.clientY - lastY);
      lastY = ev.clientY;
    },
    onEnd: () => {},
  });
  return true;
}
