// Files beside the board — one view, two sizes. Pure state model for the
// docked Files panel (components/FilesDock.jsx) and the shells that host it.
//
//   off    the board alone
//   panel  the board with Files docked on its right edge
//   full   Files fills the pane (the board is not mounted)
//
// `full` is the cluster's stored view — boards.view = 'list' — so it keeps the
// shared, persisted meaning public links and parent cards already rely on.
// Whether the panel is open, and how wide, are this device's own preference:
// opening or resizing it never writes to the board.

export const DOCK = Object.freeze({
  MIN: 300,              // narrowest panel
  DEFAULT: 400,          // first open, and a double-click on the divider
  CANVAS_MIN: 360,       // the board never gets narrower than this
  EXPAND_FRACTION: 0.7,  // dragging the divider past 70% of the pane expands
  CLOSE_BELOW: 180,      // releasing narrower than this closes the panel
  KEY_STEP: 32,          // ←/→ on the focused divider
  EXPAND_PAST: 48,       // the expand point sits this far past the widest panel
  CLICK_SLOP: 3,         // a divider press that moves less than this is a click
});

// Room to dock: a desktop pane wide enough for both a usable board and a
// usable panel. Phones and touch tablets keep Files full-screen — HTML5 drag
// (how files reach the board) doesn't fire on touch.
export function canDock(paneWidth, { mobileShell = false } = {}) {
  if (mobileShell) return false;
  return Number.isFinite(paneWidth) && paneWidth >= DOCK.MIN + DOCK.CANVAS_MIN;
}

export function filesModeOf({ view, dockOpen, canDock: room }) {
  if (view === 'list') return 'full';
  return dockOpen && room ? 'panel' : 'off';
}

// What each control does from each mode. `next` is the mode to move to;
// focusSearch asks the host to focus the panel's search box.
//
//   event     off                     panel            full
//   toggle    panel (full if no room) off              off       F, ⌘K
//   board     —                       off              off       topbar Board
//   files     panel (full if no room) focus search     —         topbar Files
//   expand    —                       full             —         ⤢, divider
//   shrink    —                       —                panel     ⤡ (room only)
//   close     —                       off              —         ×, divider
export function planFilesEvent(mode, event, { canDock: room = true } = {}) {
  const open = room ? 'panel' : 'full';
  switch (event) {
    case 'toggle': return { next: mode === 'off' ? open : 'off' };
    case 'board':  return { next: 'off' };
    case 'files':
      if (mode === 'off') return { next: open };
      return { next: mode, focusSearch: mode === 'panel' };
    case 'expand': return { next: mode === 'panel' ? 'full' : mode };
    case 'shrink': return { next: mode === 'full' && room ? 'panel' : mode };
    case 'close':  return { next: mode === 'panel' ? 'off' : mode };
    default:       return { next: mode };
  }
}

// The topbar's two segments: Board is pressed only when Files is out of the
// way; Files is pressed whenever it is showing, beside the board or full.
export function switchSegments(mode) {
  return { board: mode === 'off', files: mode !== 'off' };
}

export function clampWidth(width, paneWidth) {
  const max = Math.max(DOCK.MIN, (paneWidth || 0) - DOCK.CANVAS_MIN);
  const w = Number.isFinite(width) ? width : DOCK.DEFAULT;
  return Math.round(Math.min(max, Math.max(DOCK.MIN, w)));
}

// While dragging the divider: what letting go here would do. The expand point
// is always past the widest panel clampWidth allows, so a panel resting at its
// maximum can't expand from a press that barely moved.
export function dragPreview(width, paneWidth) {
  if (!Number.isFinite(width) || !Number.isFinite(paneWidth) || paneWidth <= 0) return null;
  const widest = Math.max(DOCK.MIN, paneWidth - DOCK.CANVAS_MIN);
  const expandAt = Math.max(DOCK.EXPAND_FRACTION * paneWidth, widest + DOCK.EXPAND_PAST);
  if (width >= expandAt) return 'full';
  if (width < DOCK.CLOSE_BELOW) return 'close';
  return null;
}

// Letting go of the divider: expand, close, or settle on a clamped width.
export function releaseDock(width, paneWidth) {
  const preview = dragPreview(width, paneWidth);
  if (preview) return { action: preview === 'full' ? 'expand' : 'close' };
  return { action: 'resize', width: clampWidth(width, paneWidth) };
}

// ── device preference ───────────────────────────────────────────────────────
const PREFS_KEY = 'soleil.files.dock';
const DEFAULT_PREFS = Object.freeze({ open: false, width: DOCK.DEFAULT });

function store(storage) {
  if (storage !== undefined) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function readDockPrefs(storage) {
  try {
    const raw = store(storage)?.getItem(PREFS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_PREFS };
    return {
      open: v.open === true,
      width: Number.isFinite(v.width) ? v.width : DOCK.DEFAULT,
    };
  } catch (_) { return { ...DEFAULT_PREFS }; }
}

export function writeDockPrefs(prefs, storage) {
  try { store(storage)?.setItem(PREFS_KEY, JSON.stringify({ open: !!prefs.open, width: prefs.width })); } catch (_) {}
}

// One-time hint the first time the panel opens (F used to mean full-screen
// Files). Read-fail = seen, so broken storage never nags.
const HINT_KEY = 'soleil.files.dockHint';
export function dockHintSeen(storage) {
  try { return store(storage)?.getItem(HINT_KEY) === '1'; } catch (_) { return true; }
}
export function markDockHintSeen(storage) {
  try { store(storage)?.setItem(HINT_KEY, '1'); } catch (_) {}
}

// The panel's path bar: root, an ellipsis for anything that won't fit, then
// the last few clusters down to where you are. ELLIPSIS marks the gap.
export const ELLIPSIS = '…';
export function collapsePath(ids, max = 3) {
  const path = Array.isArray(ids) ? ids.filter((x) => x != null) : [];
  if (path.length <= max || max < 2) return path;
  return [path[0], ELLIPSIS, ...path.slice(path.length - (max - 1))];
}
