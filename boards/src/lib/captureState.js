// captureState.js — the admin Capture Mode flag store.
//
// Capture Mode stages the app for marketing screenshots and screen recordings:
// hides chrome, mutes toasts, freezes the grain, reframes a board to a phone
// shape, swaps in a persona and populates the canvas with synthetic peers.
//
// Shaped after perf.js on purpose. Every reader on a hot path (toast(), the
// analytics stamp, getCanvasScale) is a single boolean read when off, so this
// module costs nothing in normal operation. Zero imports, zero React — a leaf
// module CanvasSurface, App, the libs and `node --test` can all pull in
// cycle-free.
//
// ── The gate ───────────────────────────────────────────────────────────────
// The module boots DISARMED and every setter is a no-op until armCapture(true)
// is called, which App does only for tier === 'admin' (server truth, via
// get_my_tier / is_admin()). That means the gate is one testable predicate
// rather than a condition sprinkled through the UI, and a stray
// `window.__capture.set(...)` from a non-admin's console does nothing at all.
// Losing admin disarms and resets, so capture can never outlive the tier.
//
// ── What persists ──────────────────────────────────────────────────────────
// Staging flags go in sessionStorage: a reload mid-shoot has to survive, but a
// chromeless, silent UI surviving into tomorrow's real session is a support
// incident — which is why this is NOT localStorage (perf.js's `perfHud`
// precedent) and NOT profiles.settings (which syncs across devices).
//
// The persona and the synthetic cast are held in memory ONLY, not even in
// sessionStorage. A fake identity that outlives the tab and leaks into a real
// collaboration session is the worst failure this feature can have.

const STORAGE_KEY = 'soleil.capture';

const DEFAULTS = Object.freeze({
  on: false,          // master switch
  clean: false,       // hide chrome (body[data-capture-clean])
  silence: false,     // mute toasts
  freeze: false,      // stop the grain + idle animation
  spotlight: false,   // own-cursor vignette + click ripples
  reframe: false,     // ephemeral phone-shaped re-layout
  width: 0,           // reframe target width in board units; 0 = auto
  aspect: null,       // '9:16' | '4:5' | '1:1' | '16:9' | null — framing mask only
  persona: false,     // identity swap                    (never persisted)
  cast: 0,            // synthetic peer count             (never persisted)
});

// Held in memory only. Everything else round-trips through sessionStorage.
const EPHEMERAL_KEYS = Object.freeze(['persona', 'cast']);

let armed = false;
let state = DEFAULTS;
const listeners = new Set();

function _sessionGet(key) {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(key);
  } catch (_) { return null; }
}
function _sessionSet(key, value) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(key, value);
  } catch (_) {}
}
function _sessionRemove(key) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(key);
  } catch (_) {}
}

// Only keys we know about, only the declared type. A hand-edited sessionStorage
// blob must never be able to put a string where the reframe expects a number.
function _coerce(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (EPHEMERAL_KEYS.includes(key)) continue;
    const v = raw[key];
    if (typeof fallback === 'boolean' && typeof v === 'boolean') out[key] = v;
    else if (typeof fallback === 'number' && Number.isFinite(v)) out[key] = v;
    else if (key === 'aspect' && (v === null || typeof v === 'string')) out[key] = v;
  }
  return out;
}

function _persist() {
  const keep = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!EPHEMERAL_KEYS.includes(key)) keep[key] = state[key];
  }
  _sessionSet(STORAGE_KEY, JSON.stringify(keep));
}

function _emit() {
  for (const fn of [...listeners]) {
    try { fn(state); } catch (_) { /* a listener error must not break a toggle */ }
  }
}

// ── Arming ─────────────────────────────────────────────────────────────────

// Called from one App effect on tier === 'admin'. Arming rehydrates the staging
// flags from sessionStorage so a reload mid-shoot resumes; disarming resets to
// defaults AND clears storage, so a tier change can't leave a chromeless app.
export function armCapture(next) {
  const want = !!next;
  if (want === armed) return;
  armed = want;
  if (armed) {
    let restored = null;
    try { restored = _coerce(JSON.parse(_sessionGet(STORAGE_KEY))); } catch (_) { restored = null; }
    state = restored ? Object.freeze({ ...DEFAULTS, ...restored }) : DEFAULTS;
  } else {
    state = DEFAULTS;
    _sessionRemove(STORAGE_KEY);
  }
  _emit();
}

export function isArmed() { return armed; }

// ── Reads ──────────────────────────────────────────────────────────────────
// Each derived reader folds in `armed` and the master switch, so a caller never
// has to remember to check three things. These are the hot-path entry points.

export function isCaptureActive() { return armed && state.on; }
export function isSilenced()      { return armed && state.on && state.silence; }
export function isFrozen()        { return armed && state.on && state.freeze; }
export function isCleanChrome()   { return armed && state.on && state.clean; }
export function isPersonaOn()     { return armed && state.on && state.persona; }
export function isReframeOn()     { return armed && state.on && state.reframe; }
export function castSize()        { return isCaptureActive() ? state.cast : 0; }

// The whole blob, for React. Identity is stable between changes, so this is a
// valid useSyncExternalStore snapshot.
export function getCaptureState() { return state; }

// ── Writes ─────────────────────────────────────────────────────────────────

// Merge a patch. No-ops entirely while disarmed — that is the gate. Unknown
// keys are dropped rather than stored, so a typo can't create a phantom flag
// that reads as undefined forever.
export function setCapture(patch) {
  if (!armed || !patch || typeof patch !== 'object') return;
  let changed = false;
  const next = { ...state };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    const fallback = DEFAULTS[key];
    let v = value;
    if (typeof fallback === 'boolean') v = !!v;
    else if (typeof fallback === 'number') v = Number.isFinite(v) ? v : fallback;
    if (next[key] === v) continue;
    next[key] = v;
    changed = true;
  }
  if (!changed) return;
  state = Object.freeze(next);
  _persist();
  _emit();
}

// Turn everything off without disarming — the "get me back to a normal app"
// button. Clears the persona and the cast along with the staging flags.
export function resetCapture() {
  if (!armed) return;
  if (state === DEFAULTS) return;
  state = DEFAULTS;
  _persist();
  _emit();
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Test-only reset. Not gated on `armed` — the point is to get back to a known
// state between cases.
export function __resetForTests() {
  armed = false;
  state = DEFAULTS;
  listeners.clear();
  _sessionRemove(STORAGE_KEY);
}

export { DEFAULTS, EPHEMERAL_KEYS, STORAGE_KEY };
