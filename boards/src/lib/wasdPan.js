// wasdPan — hold W, A, S or D to move around a board, for people who would
// rather steer with the keyboard than drag. Settings → Appearance → Canvas.
//
// OFF BY DEFAULT, because two of the four letters already mean something on
// the canvas: A picks the Arrow tool and D picks Free-draw. Someone who never
// asked for this must never press D for the pen and watch the board slide
// away. With it on, the movement keys move and nothing else: the two tools stay
// a click away on the rail, and ⌘A / ⌘D (select all, duplicate) are untouched,
// because a key pressed with ⌘, Ctrl or Alt is never a movement key.
//
// PHYSICAL KEYS (e.code), not letters (e.key). A movement cluster is about
// where the fingers rest, not what is printed on the caps: on AZERTY the same
// four keys print Z Q S D. The tool shortcuts read e.key, so there the key
// printed A (code KeyQ) still picks the Arrow tool and only D gives one up.
//
// WHY A MODULE STORE: the same reason as lib/wheelMode.js. The canvas reads
// this from window key listeners that must not re-bind when a setting changes,
// so it has to be a synchronous read of a module-level value. Persistence is
// the wheel's too: profiles.settings.ui.wasdPan, mirrored into the `soleil.ui`
// localStorage blob so a cold load knows before the profile fetch returns.

export const DEFAULT_WASD_PAN = false;

const UI_CACHE_KEY = 'soleil.ui';

// Only a real `true` turns it on. A corrupt blob, a string or an older client
// must never hand somebody the setting that takes A and D away.
const normalize = (v) => v === true;

function readCache() {
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    return normalize((raw ? JSON.parse(raw) : null)?.wasdPan);
  } catch (_) {
    // No storage, private mode, or no DOM at all (node tests). Default.
    return DEFAULT_WASD_PAN;
  }
}

let on = readCache();

export function getWasdPan() { return on; }

// Apply now and mirror it for the next cold load. Mirrors applyWheelModeNow.
export function applyWasdPanNow(next) {
  const v = normalize(next);
  on = v;
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    const ui = raw ? (JSON.parse(raw) || {}) : {};
    ui.wasdPan = v;
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(ui));
  } catch (_) { /* the in-memory value is still right for this session */ }
  return v;
}

// Each key by its physical position, as the screen direction it moves the VIEW:
// W looks further up the board, S down, A left, D right.
export const WASD_CODES = Object.freeze({
  KeyW: Object.freeze([0, -1]),
  KeyA: Object.freeze([-1, 0]),
  KeyS: Object.freeze([0, 1]),
  KeyD: Object.freeze([1, 0]),
});

// The movement key a keydown is, or null. Shift is allowed, as the faster
// gear. ⌘, Ctrl and Alt never are: those combinations belong to their own
// shortcuts, and macOS sends no keyup for a letter let go while ⌘ is held,
// which would leave the board drifting on its own.
export function wasdCodeOf(e) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
  return Object.prototype.hasOwnProperty.call(WASD_CODES, e.code) ? e.code : null;
}

// Where the held keys point, as a unit vector, or 0,0. Opposite keys cancel,
// and a diagonal goes as fast as a straight line rather than √2 faster.
export function wasdDirection(held) {
  let x = 0, y = 0;
  for (const code of held || []) {
    const d = WASD_CODES[code];
    if (d) { x += d[0]; y += d[1]; }
  }
  const len = Math.hypot(x, y);
  return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

// Screen pixels per second: screen, not board, so the board passes under you
// at the same visible pace at any zoom. Shift multiplies it.
export const WASD_SPEED = 900;
export const WASD_FAST = 2.5;
// Seconds for the speed to close most of the gap to what the keys ask for, in
// both directions: a tap nudges, a hold glides and letting go eases to a stop,
// instead of the board lurching into motion and halting dead.
export const WASD_EASE = 0.08;
// Below this, with no key held, the board is at rest (pixels per second).
export const WASD_REST = 8;

// One frame of easing from velocity `v` toward `target` over `dt` seconds.
// `tau` 0 is no easing at all, which is what Reduce Motion gets.
export function wasdStep(v, target, dt, tau = WASD_EASE) {
  if (!(tau > 0)) return { x: target.x, y: target.y };
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return { x: v.x + (target.x - v.x) * k, y: v.y + (target.y - v.y) * k };
}
