// wheelHint — the one-time "scrolling pans" nudge.
//
// A preference nobody finds is wasted work, and Settings → Display is not
// somewhere people visit. This is what makes the wheel-mode setting worth
// having: catch the moment someone is fighting the canvas and tell them, once.
//
// NOT a powerReveal. That engine is count-based on board CONTENT (4 images →
// Grids, 3 notes → Docs) with a hard budget of one reveal per session, and
// those are activation moments worth more than this one. A gesture nudge must
// not take that slot. This follows momentumHint/liftHint instead: device-local
// localStorage, once ever, and a read failure counts as SEEN so a browser with
// broken storage never nags on every load.
//
// DETECTING IT. The obvious signal — "lots of hard scrolling" — is also exactly
// what deliberate panning looks like, so it would fire on people who are
// perfectly happy. The distinguishing signal is DIRECTION REVERSAL. Panning
// with intent is monotonic: you are going somewhere. Trying to zoom is
// oscillatory: you scroll down expecting to zoom in, watch the board slide
// away, scroll back up to undo it, and try again. Down-up-down-up in a second
// and a half is not a person navigating.

const HINT_KEY = 'soleil.wheelHintSeen';

export function wheelHintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch (_) { return true; }
}

export function markWheelHintSeen() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch (_) {}
}

export const WHEEL_FRUSTRATION = Object.freeze({
  WINDOW_MS: 1500,      // reversals have to be one continuous fight, not a day's scrolling
  MIN_REVERSALS: 3,     // down-up-down-up
  MIN_DELTA: 30,        // a deliberate push; filters trackpad drift and inertia tails
});

// `first` is null rather than 0 for "no run yet": a timestamp of 0 is falsy, so
// a truthiness check restarts the run on every event and it can never build up.
export function freshWheelState() {
  return { first: null, lastSign: 0, reversals: 0 };
}

// Fold one wheel event into the detector. Pure: returns the next state and
// whether this event completes the pattern. `t` is a monotonic ms timestamp.
//
// Anything that is not a plain, deliberate, vertical wheel RESETS rather than
// being ignored — someone who reaches for a modifier has demonstrably found the
// zoom gesture, and someone whose gesture went horizontal is on a trackpad
// doing something else. Both make the run meaningless.
export function trackWheelFrustration(state, ev) {
  const s = state || freshWheelState();
  const { t = 0, deltaX = 0, deltaY = 0, ctrlKey, metaKey, altKey, shiftKey } = ev || {};

  if (ctrlKey || metaKey || altKey || shiftKey) return { state: freshWheelState(), fire: false };
  if (Math.abs(deltaY) < WHEEL_FRUSTRATION.MIN_DELTA) return { state: freshWheelState(), fire: false };
  if (Math.abs(deltaX) > Math.abs(deltaY)) return { state: freshWheelState(), fire: false };

  // Start a fresh run on the first event, or once the old one has gone stale.
  const started = (s.first === null || s.first === undefined || (t - s.first) > WHEEL_FRUSTRATION.WINDOW_MS)
    ? { first: t, lastSign: 0, reversals: 0 }
    : s;

  const sign = deltaY > 0 ? 1 : -1;
  const reversals = (started.lastSign !== 0 && sign !== started.lastSign)
    ? started.reversals + 1
    : started.reversals;

  const next = { first: started.first, lastSign: sign, reversals };
  if (reversals >= WHEEL_FRUSTRATION.MIN_REVERSALS) {
    // Consume the run: whoever fires this marks the hint seen, and a state that
    // stayed armed would re-fire on the very next event.
    return { state: freshWheelState(), fire: true };
  }
  return { state: next, fire: false };
}
