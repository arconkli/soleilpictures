// A menu opened by a hold: letting go raises a click where the finger was
// (and, unless the press was prevented, a mousedown and mouseup before it).
// That lands on the menu when it opened under the finger, or outside a
// popover, which takes the mousedown as a tap away and closes. Eat them, up to
// that one click. The next press clears the trap, since Android ends a long
// press with no click at all.
//
// `held`: the finger is still down (the menu opened mid-hold), so the click is
// as far off as the hold is long. The wait for it starts when the finger lifts.
const KINDS = ['mousedown', 'mouseup', 'click'];
const AFTER_LIFT_MS = 600;
const HELD_MAX_MS = 15000;
// The object form: Node's EventTarget (the unit test's window) ignores a bare
// true when removing, and browsers read the two the same.
const CAPTURE = { capture: true };

export function swallowNextClick({ held = false } = {}) {
  if (typeof window === 'undefined') return;
  let timer = null;
  const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); if (ev.type === 'click') done(); };
  const lifted = () => { clearTimeout(timer); timer = setTimeout(done, AFTER_LIFT_MS); };
  const done = () => {
    clearTimeout(timer);
    for (const k of KINDS) window.removeEventListener(k, eat, CAPTURE);
    window.removeEventListener('pointerup', lifted, CAPTURE);
    window.removeEventListener('pointercancel', lifted, CAPTURE);
    window.removeEventListener('pointerdown', done, CAPTURE);
  };
  timer = setTimeout(done, held ? HELD_MAX_MS : AFTER_LIFT_MS);
  for (const k of KINDS) window.addEventListener(k, eat, CAPTURE);
  if (held) {
    window.addEventListener('pointerup', lifted, CAPTURE);
    window.addEventListener('pointercancel', lifted, CAPTURE);
  }
  window.addEventListener('pointerdown', done, CAPTURE);
}
