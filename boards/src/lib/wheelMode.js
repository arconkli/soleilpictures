// wheelMode — what a plain scroll wheel does on the canvas.
//
// The convention genuinely splits. Figma and Milanote pan; PureRef and Miro
// zoom. Someone arriving with PureRef muscle memory scrolls to zoom, watches
// the board slide sideways instead, and does it in the first thirty seconds,
// before they have placed anything. So this is a preference, and 'pan' stays
// the default — flipping it would break the other half of that audience for
// exactly the same reason.
//
// WHY A MODULE STORE AND NOT A PROP. The wheel handler in CanvasSurface has an
// empty dependency array on purpose: re-binding it fired the effect's cleanup
// mid-pan and nulled the peer cursor (see the comment above that effect). So
// the preference has to be readable SYNCHRONOUSLY from inside the handler and
// must never be a reason to re-bind. A getter over a module-level value is
// exactly that. It also avoids threading a prop through both App.jsx and
// local/LocalBoardsApp.jsx, which mount the same CanvasSurface.
//
// Persistence mirrors lib/theme.js: the account value lives in
// profiles.settings.ui.wheelMode, and is mirrored into the `soleil.ui`
// localStorage blob so a cold load reads the right value with zero dependency
// on the async profile fetch — no frame of the wrong gesture on boot.

export const WHEEL_MODES = ['pan', 'zoom'];
export const DEFAULT_WHEEL_MODE = 'pan';

const UI_CACHE_KEY = 'soleil.ui';

const normalize = (m) => (WHEEL_MODES.includes(m) ? m : DEFAULT_WHEEL_MODE);

function readCache() {
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    return normalize((raw ? JSON.parse(raw) : null)?.wheelMode);
  } catch (_) {
    // No storage, private mode, or no DOM at all (node tests). Default.
    return DEFAULT_WHEEL_MODE;
  }
}

let mode = readCache();

export function getWheelMode() { return mode; }

// Apply a mode now and mirror it for the next cold load. Mirrors applyThemeNow.
export function applyWheelModeNow(next) {
  const v = normalize(next);
  mode = v;
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    const ui = raw ? (JSON.parse(raw) || {}) : {};
    ui.wheelMode = v;
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(ui));
  } catch (_) { /* the in-memory value is still right for this session */ }
  return v;
}

// The whole modifier matrix, as one pure function — so it is node-testable
// without a browser and the handler stays a thin caller.
//
// The load-bearing row is ctrl. A trackpad pinch is delivered to the page as a
// wheel event with a synthetic ctrlKey on macOS AND Windows; if ctrl ever meant
// pan, pinch-to-zoom would stop working. It means zoom in every mode.
//
//   pan mode (default, unchanged from before this existed):
//     ctrl / cmd + wheel → zoom          everything else → pan
//
//   zoom mode:
//     ctrl + wheel       → zoom          (pinch — must not change)
//     cmd  + wheel       → pan           (the inverse gesture, mac)
//     alt  + wheel       → pan           (cross-platform: Windows has no cmd)
//     shift + wheel      → pan sideways
//     horizontal-dominant → pan          (a trackpad swipe stays a swipe)
//     plain wheel        → zoom
export function resolveWheelIntent({
  mode: m, ctrlKey, metaKey, altKey, shiftKey, deltaX, deltaY,
} = {}) {
  if (ctrlKey) return 'zoom';
  if (normalize(m) !== 'zoom') return metaKey ? 'zoom' : 'pan';
  if (metaKey || altKey || shiftKey) return 'pan';
  if (Math.abs(deltaX || 0) > Math.abs(deltaY || 0)) return 'pan';
  return 'zoom';
}

// One gesture, one intent. resolveWheelIntent reads each event on its own, and
// a gesture is many events: a trackpad's momentum tail keeps arriving after ⌘
// is let go (so a zoom ended in a pan), and a diagonal swipe in zoom mode
// crosses the horizontal-dominant line back and forth (so it alternated
// between zooming and panning). The latch keeps the intent the gesture started
// with for as long as its events keep coming: an event within
// WHEEL_GESTURE_GAP_MS of the one before belongs to the same gesture, and a
// longer gap starts a new one. ctrlKey is the exception and always zooms — it
// is a trackpad pinch, and a pinch must never pan.
//
// `prev` is what this returned last time (or null); `now` a monotonic ms
// timestamp. Returns { intent, t }, which is also the next call's `prev`.
export const WHEEL_GESTURE_GAP_MS = 150;

export function latchWheelIntent(prev, intent, now, { ctrlKey = false } = {}) {
  const t = Number.isFinite(now) ? now : 0;
  if (ctrlKey) return { intent: 'zoom', t };
  if (prev && (prev.intent === 'zoom' || prev.intent === 'pan')
      && Number.isFinite(prev.t) && t >= prev.t && (t - prev.t) <= WHEEL_GESTURE_GAP_MS) {
    return { intent: prev.intent, t };
  }
  return { intent: intent === 'zoom' ? 'zoom' : 'pan', t };
}
