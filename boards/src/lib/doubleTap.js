// Touch double-tap detector.
//
// The browser's native `dblclick` is unreliable on touch — especially here,
// where the canvas sets `touch-action: none` and owns every gesture, so two
// quick taps frequently never produce a `dblclick` at all. Every inline editor
// (notes, card/board titles) and the board-tile open used to rely on that
// native event, so on phones you simply couldn't enter edit mode or open a
// board by tapping. This synthesizes the double-tap from two `pointerup`s.
//
// Usage: keep a `useRef({})` per surface and call this in `onPointerUp`. It
// returns true on the SECOND qualifying tap (and resets the ref so the next
// tap starts a fresh pair). Pass `key` (e.g. a card id) to require both taps
// on the same target. Uses `e.timeStamp` (monotonic DOM time) — never
// `Date.now()`.
export function tapIsDouble(ref, e, { maxMs = 320, maxDist = 24, key = null } = {}) {
  const p = ref.current || {};
  const dt = e.timeStamp - (p.t || 0);
  const near =
    Math.abs(e.clientX - (p.x || 0)) < maxDist &&
    Math.abs(e.clientY - (p.y || 0)) < maxDist;
  if (p.t && (key == null || p.key === key) && dt > 0 && dt < maxMs && near) {
    ref.current = {};
    return true;
  }
  ref.current = { t: e.timeStamp, x: e.clientX, y: e.clientY, key };
  return false;
}

// The mouse events and the click a tap still owes the page. The browser sends
// them just after the finger lifts, to whatever is under it by then — so when a
// double tap opens something over that spot (a doc), they land inside it: in
// its editor, on a toolbar button, on the backdrop that closes it. Call this
// from the pointerup that opens it: for `ms` it swallows that tap's mousedown,
// mouseup, click and dblclick near (x, y), once each, in the capture phase,
// then gets out of the way. Returns a function that stops it early.
const GHOST_TYPES = ['mousedown', 'mouseup', 'click', 'dblclick'];
export function swallowGhostClick({ x, y }, { ms = 600, maxDist = 30 } = {}) {
  if (typeof window === 'undefined') return () => {};
  const seen = new Set();
  let timer = 0;
  const onEvent = (ev) => {
    if (seen.has(ev.type)) return;
    if (Math.abs(ev.clientX - x) > maxDist || Math.abs(ev.clientY - y) > maxDist) return;
    seen.add(ev.type);
    ev.preventDefault();
    ev.stopPropagation();
  };
  // The options object, not a bare `true`: Node's EventTarget (the unit test's
  // window) won't remove a listener by the boolean form. Browsers take either.
  const capture = { capture: true };
  const stop = () => {
    clearTimeout(timer);
    for (const t of GHOST_TYPES) window.removeEventListener(t, onEvent, capture);
  };
  for (const t of GHOST_TYPES) window.addEventListener(t, onEvent, capture);
  timer = setTimeout(stop, ms);
  return stop;
}
