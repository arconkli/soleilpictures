// The review player's keyboard, as one pure map from a key event to an action
// (playerKeys.test.mjs). The player listens in the capture phase while it's
// open, so these never reach the board or Files behind it.
//
// `kHeld`: K is down. K+J / K+L inch one frame, as on an editing keyboard.
export const PLAYER_KEYS = [
  ['Space', 'Play · pause'],
  ['J / K / L', 'Play backward · stop · forward — press again to go faster'],
  ['K + J / K + L', 'One frame back · forward'],
  ['← / →', 'One frame back · forward'],
  ['⇧← / ⇧→', 'One second back · forward'],
  ['Home / End', 'First · last frame'],
  ['I / O', 'Set in · out'],
  ['⌥X', 'Clear in and out'],
  ['⌥L', 'Loop between in and out'],
  ['↑ / ↓', 'Previous · next comment'],
  ['C', 'Comment on this frame'],
  ['D', 'Draw on this frame'],
  ['M', 'Mute'],
  ['F', 'Full screen'],
  ['G', 'Framing guides'],
  ['\\', 'Flip to the other version'],
  ['Esc', 'Close'],
];

export function playerAction(e, { kHeld = false } = {}) {
  if (!e) return null;
  if (e.metaKey || e.ctrlKey) return null;
  const key = e.key;
  const code = e.code || '';
  const shift = !!e.shiftKey;
  // ⌥ letters type characters on a Mac (⌥L is "¬"): match the physical key.
  if (e.altKey) {
    if (code === 'KeyL') return 'loop';
    if (code === 'KeyX') return 'clearInOut';
    return null;
  }
  switch (key) {
    case ' ': case 'Spacebar': return 'toggle';
    case 'ArrowLeft': return shift ? 'back1s' : 'back1f';
    case 'ArrowRight': return shift ? 'fwd1s' : 'fwd1f';
    case ',': return 'back1f';
    case '.': return 'fwd1f';
    case 'ArrowUp': return 'prevComment';
    case 'ArrowDown': return 'nextComment';
    case 'Home': return 'start';
    case 'End': return 'end';
    case 'Escape': return 'escape';
    case '\\': return 'compare';
    default: break;
  }
  switch (String(key || '').toLowerCase()) {
    case 'j': return kHeld ? 'back1f' : 'shuttleBack';
    case 'l': return kHeld ? 'fwd1f' : 'shuttleFwd';
    case 'k': return 'stop';
    case 'i': return 'markIn';
    case 'o': return 'markOut';
    case 'c': return 'comment';
    case 'd': return 'draw';
    case 'm': return 'mute';
    case 'f': return 'fullscreen';
    case 'g': return 'guides';
    default: return null;
  }
}
