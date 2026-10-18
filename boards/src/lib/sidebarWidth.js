// How wide the sidebar is, and how it is allowed to change.
//
// The sidebar holds the clusters and, below them, the files of the one you're
// in, so one fixed width suits nobody: filenames want room, a canvas wants it
// back. It resizes between MIN and MAX and the choice is remembered per device
// (not per workspace — it is a property of the screen, not of the work).
// Storage can be missing or throw (private windows, blocked site data), so
// nothing here ever throws.
//
// Past SPLIT_AT it is wide enough for two columns, and the files move from
// under the clusters to beside them (ClusterSidebar). Its expand button jumps
// between the two: to WIDE, and back to the narrow width it came from.

export const SIDEBAR_W = Object.freeze({ MIN: 240, MAX: 760, DEFAULT: 320, STEP: 16, SPLIT_AT: 540, WIDE: 640 });
export const SIDEBAR_W_KEY = 'soleil.ui.sidebarW';

export function isWideSidebar(width) {
  return Number(width) >= SIDEBAR_W.SPLIT_AT;
}

// The width the expand button goes to: wide from narrow, and from wide back to
// `narrow` (the last narrow width), or the default when there isn't one.
export function toggledSidebarWidth(width, narrow = null) {
  if (!isWideSidebar(width)) return Math.max(SIDEBAR_W.WIDE, clampSidebarWidth(width));
  const back = clampSidebarWidth(narrow ?? SIDEBAR_W.DEFAULT);
  return isWideSidebar(back) ? SIDEBAR_W.DEFAULT : back;
}

export function clampSidebarWidth(n) {
  const v = Number(n);
  if (n === null || n === '' || !Number.isFinite(v)) return SIDEBAR_W.DEFAULT;
  return Math.min(SIDEBAR_W.MAX, Math.max(SIDEBAR_W.MIN, Math.round(v)));
}

export function readSidebarWidth(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SIDEBAR_W_KEY);
    if (raw == null) return SIDEBAR_W.DEFAULT;
    return clampSidebarWidth(raw);
  } catch {
    return SIDEBAR_W.DEFAULT;
  }
}

export function writeSidebarWidth(n, storage = globalThis.localStorage) {
  const w = clampSidebarWidth(n);
  try {
    storage.setItem(SIDEBAR_W_KEY, String(w));
  } catch { /* unwritable storage: the width just isn't remembered */ }
  return w;
}

export function widthFromDrag(startWidth, startX, currentX) {
  return clampSidebarWidth(startWidth + currentX - startX);
}

// Keyboard resizing for the separator handle; null = not a resize key.
export function widthFromKey(width, key) {
  switch (key) {
    case 'ArrowLeft': return clampSidebarWidth(width - SIDEBAR_W.STEP);
    case 'ArrowRight': return clampSidebarWidth(width + SIDEBAR_W.STEP);
    case 'Home': return SIDEBAR_W.MIN;
    case 'End': return SIDEBAR_W.MAX;
    default: return null;
  }
}
