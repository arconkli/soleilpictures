// The review player's keyboard, as one pure map from a key event to an action
// (playerKeys.test.mjs). The player listens in the capture phase while it's
// the top layer, so these never reach the board or Files behind it.
//
// PLAYER_KEYS is the one list the shortcut sheet in the player, the app's
// shortcuts overlay (ShortcutsOverlay 'Player') and the docs page are checked
// against (playerKeysDocs.test.mjs). `future` rows belong to frame comments,
// which haven't shipped: nothing lists them yet.
export const PLAYER_KEYS = [
  { group: 'Transport', keys: ['Space'], label: 'Play · pause' },
  { group: 'Transport', keys: ['J', 'K', 'L'], label: 'Play backward · stop · forward — again to go faster' },
  { group: 'Transport', keys: ['K+J', 'K+L'], label: 'Tap: one frame back · forward. Hold: play slowly' },
  { group: 'Transport', keys: ['←', '→'], label: 'One frame back · forward' },
  { group: 'Transport', keys: [',', '.'], label: 'One frame back · forward' },
  { group: 'Transport', keys: ['⇧←', '⇧→'], label: 'One second back · forward' },
  { group: 'Transport', keys: ['Home', 'End'], label: 'First · last frame' },
  { group: 'Transport', keys: ['⇧<', '⇧>'], label: 'Slower · faster' },
  { group: 'Transport', keys: ['0–9'], label: 'Type a timecode, frame or seconds to jump to' },
  { group: 'Marking', keys: ['I', 'O'], label: 'Set in · out' },
  { group: 'Marking', keys: ['⇧I', '⇧O'], label: 'Go to in · out' },
  { group: 'Marking', keys: ['⇧Space'], label: 'Play from in to out' },
  { group: 'Marking', keys: ['⌥L'], label: 'Loop (between in and out, or the whole clip)' },
  { group: 'Marking', keys: ['⌥X'], label: 'Clear in and out' },
  { group: 'View', keys: ['⌥=', '⌥−'], label: 'Zoom the timeline in · out' },
  { group: 'View', keys: ['⌥0'], label: 'Fit the whole clip in the timeline' },
  { group: 'View', keys: ['⇧Z'], label: 'Zoom the timeline to in and out' },
  { group: 'View', keys: ['Z'], label: 'Zoom the picture: fit · 100% · 200% — drag to look around' },
  { group: 'View', keys: ['G'], label: 'Framing guides — again for the next one' },
  { group: 'View', keys: ['F'], label: 'Full screen' },
  { group: 'View', keys: ['M'], label: 'Mute' },
  { group: 'View', keys: ['⇧↑', '⇧↓'], label: 'Volume up · down' },
  { group: 'Review', keys: ['\\'], label: 'Flip to the version you compare with' },
  { group: 'Review', keys: [`⌘C`], label: 'Copy the timecode' },
  { group: 'Review', keys: [`⇧⌘C`], label: 'Copy a link to this frame' },
  { group: 'Review', keys: ['?'], label: 'Show these shortcuts' },
  { group: 'Review', keys: ['Esc'], label: 'Close the player' },
  { group: 'Review', keys: ['↑', '↓'], label: 'Previous · next comment', future: true },
  { group: 'Review', keys: ['C'], label: 'Comment on this frame', future: true },
  { group: 'Review', keys: ['D'], label: 'Draw on this frame', future: true },
];

// Actions a held key may repeat: stepping and volume. Everything else (J/L
// doubling, I/O, loop…) acts once per press — an OS key-repeat must not
// shuttle to 8× or toggle loop forty times.
const REPEATABLE = new Set(['back1f', 'fwd1f', 'back1s', 'fwd1s', 'volUp', 'volDown']);

// `kHeld`: K is down. K+J / K+L inch one frame, as on an editing keyboard.
// Returns an action string, or { action: 'tcEntry', seed } for a digit.
export function playerAction(e, { kHeld = false } = {}) {
  if (!e) return null;
  const key = e.key;
  const code = e.code || '';
  const shift = !!e.shiftKey;
  if (e.metaKey || e.ctrlKey) {
    // Copy the timecode — the caller checks nothing else is selected first.
    if (!e.altKey && String(key).toLowerCase() === 'c') return shift ? 'copyLink' : 'copyTc';
    return null;
  }
  // ⌥ letters type characters on a Mac (⌥L is "¬"): match the physical key.
  if (e.altKey) {
    if (code === 'KeyL') return 'loop';
    if (code === 'KeyX') return 'clearInOut';
    if (code === 'Equal' || code === 'NumpadAdd') return 'zoomIn';
    if (code === 'Minus' || code === 'NumpadSubtract') return 'zoomOut';
    if (code === 'Digit0' || code === 'Numpad0') return 'zoomFit';
    return null;
  }
  switch (key) {
    case ' ': case 'Spacebar': return shift ? 'playInOut' : 'toggle';
    case 'ArrowLeft': return shift ? 'back1s' : 'back1f';
    case 'ArrowRight': return shift ? 'fwd1s' : 'fwd1f';
    case 'ArrowUp': return shift ? 'volUp' : 'prevComment';
    case 'ArrowDown': return shift ? 'volDown' : 'nextComment';
    case ',': return 'back1f';
    case '.': return 'fwd1f';
    case '<': return 'slower';
    case '>': return 'faster';
    case 'Home': return 'start';
    case 'End': return 'end';
    case 'Escape': return 'escape';
    case '\\': return 'compare';
    case '?': return 'help';
    case '+': case '-': return { action: 'tcEntry', seed: key };
    default: break;
  }
  if (/^[0-9]$/.test(key)) return { action: 'tcEntry', seed: key };
  switch (String(key || '').toLowerCase()) {
    case 'j': return kHeld ? 'back1f' : 'shuttleBack';
    case 'l': return kHeld ? 'fwd1f' : 'shuttleFwd';
    case 'k': return 'stop';
    case 'i': return shift ? 'goIn' : 'markIn';
    case 'o': return shift ? 'goOut' : 'markOut';
    case 'z': return shift ? 'zoomRange' : 'pictureZoom';
    case 'c': return shift ? null : 'comment';
    case 'd': return shift ? null : 'draw';
    case 'm': return shift ? null : 'mute';
    case 'f': return shift ? null : 'fullscreen';
    case 'g': return shift ? null : 'guides';
    default: return null;
  }
}

export const actionName = (a) => (a && typeof a === 'object' ? a.action : a);

// Whether the player should take this key at all. Not while typing; not
// Space/Enter on a focused button (that's the button's own click); and a
// held key repeats only the actions that are meant to repeat.
export function shouldHandleKey(e, action) {
  if (!e || !action) return false;
  const t = e.target;
  const tag = t?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return false;
  if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return false;
  if (e.isComposing) return false;
  if (e.repeat && !REPEATABLE.has(actionName(action))) return false;
  return true;
}
