// Which layout a doc card opens in — remembered across cards and sessions.
//
// A doc card opens either fullscreen or docked beside the canvas. The mode was
// per-card local state defaulting to fullscreen, so a user working with a doc
// docked to the side lost the dock the moment they opened the NEXT doc: it
// took over the whole window. The layout is a workspace preference, not a
// property of one card — so it lives here, next to the dock's width ratio,
// which was already persisted the same way.
//
// Stored per device (localStorage), not per board: it describes how this
// person likes to read, and it should follow them across clusters.

const KEY = 'soleil.boards.docCardMode';
const MODES = ['full', 'side'];
export const DEFAULT_DOC_OPEN_MODE = 'full';

// True for a mode a doc card can actually be OPENED in. 'closed' is a real
// DocCard state but never a remembered preference — persisting it would make
// the next double-click open nothing.
export function isDocOpenMode(mode) {
  return MODES.includes(mode);
}

export function readDocOpenMode() {
  if (typeof localStorage === 'undefined') return DEFAULT_DOC_OPEN_MODE;
  try {
    const v = localStorage.getItem(KEY);
    return isDocOpenMode(v) ? v : DEFAULT_DOC_OPEN_MODE;
  } catch (_) {
    return DEFAULT_DOC_OPEN_MODE;
  }
}

export function writeDocOpenMode(mode) {
  if (!isDocOpenMode(mode)) return;
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, mode); } catch (_) {}
}
