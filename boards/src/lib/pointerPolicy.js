// Who gets to draw on a touch device: the finger, the stylus, or both.
//
// The problem this solves is palm rejection, and it cannot be solved by
// filtering pointer events alone. trackStroke locks a stroke to the pointerId
// that started it, which is correct — but if a palm lands on the glass BEFORE
// the Pencil tip does, the palm wins the race, owns the stroke, and the Pencil
// is then rejected as "a different pointer" for the rest of the gesture. The
// user draws a line with their hand and nothing happens with the pen.
//
// Every serious drawing app on a tablet resolves this the same way: once the
// device has shown it has a stylus, the finger stops being a drawing implement
// and becomes a navigation one. Procreate, GoodNotes, Notability and Freeform
// all behave this way, so it is also what an iPad user already expects.
//
// Detection is observational, not a capability query — `maxTouchPoints` and
// friends can't tell you whether someone owns a Pencil. We watch for a real
// `pointerType === 'pen'` event and remember it. That means the very first pen
// stroke on a device still runs under the finger-draws default; from the second
// one on, the finger pans. The switch is announced once (see the caller) so it
// never reads as the app breaking.

const KEY_STYLUS_SEEN = 'soleil.stylusSeen';
const KEY_FINGER_DRAWS = 'soleil.drawWithFinger';

function read(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_) { /* private mode / storage disabled — policy just won't persist */ }
}

const listeners = new Set();
function emit() {
  for (const fn of listeners) { try { fn(); } catch (_) {} }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Stylus detection ──────────────────────────────────────────────────────

let stylusSeenCache = null;

export function stylusSeen() {
  if (stylusSeenCache === null) stylusSeenCache = read(KEY_STYLUS_SEEN) === '1';
  return stylusSeenCache;
}

// Call from any pointerdown. Returns true the FIRST time a stylus is seen, so
// the caller can tell the user their finger just became a pan gesture rather
// than letting them discover it by drawing nothing.
export function notePointerType(pointerType) {
  if (pointerType !== 'pen') return false;
  if (stylusSeen()) return false;
  stylusSeenCache = true;
  write(KEY_STYLUS_SEEN, '1');
  emit();
  return true;
}

// ── The finger preference ─────────────────────────────────────────────────

// null = follow the automatic policy; true/false = the user decided.
export function drawWithFingerPref() {
  const raw = read(KEY_FINGER_DRAWS);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

export function setDrawWithFinger(value) {
  write(KEY_FINGER_DRAWS, value === null ? null : (value ? '1' : '0'));
  emit();
}

// The actual question the draw tool asks. An explicit choice always wins; with
// no choice on record, a finger draws right up until the device proves it has a
// stylus.
export function fingerShouldDraw() {
  const pref = drawWithFingerPref();
  if (pref !== null) return pref;
  return !stylusSeen();
}

// Should THIS pointer paint, given the current policy? Mouse and pen always do.
// (An explicit "draw with finger" opt-in also re-enables touch.)
export function pointerCanDraw(pointerType) {
  if (pointerType === 'touch') return fingerShouldDraw();
  return true;
}

// Test seam — the policy is process-wide cached state, so specs need a way back
// to a clean slate.
export function resetPointerPolicy() {
  stylusSeenCache = null;
  write(KEY_STYLUS_SEEN, null);
  write(KEY_FINGER_DRAWS, null);
  emit();
}
