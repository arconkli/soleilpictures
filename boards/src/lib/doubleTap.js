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
