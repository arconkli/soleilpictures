// Board · Files — the two ways to look at one cluster. Pure helpers for the
// topbar switch (components/ViewSwitch.jsx) and its F shortcut, kept free of
// React/DOM so they test under node.
//
// The stored values stay 'canvas' and 'list' (boards.view, the API, MCP and
// every share bundle read them); only the interface says Board and Files.

export const VIEW_LABELS = Object.freeze({ canvas: 'Board', list: 'Files' });

// The other view. Anything that is not 'list' is the board ('doc' is a legacy
// value every reader already treats as canvas).
export function nextView(view) {
  return view === 'list' ? 'canvas' : 'list';
}

// What the Files view will show: every card except the sub-cluster mirrors,
// which Files lists separately as folders. Counted from the live cards so the
// number on the switch matches the rows you land on.
export function filesCountOf(cards) {
  if (!Array.isArray(cards)) return 0;
  let n = 0;
  for (const c of cards) {
    if (!c || c.kind === 'board' || c.kind === 'boardlink') continue;
    n += 1;
  }
  return n;
}

// Compact count for the switch badge. Hidden at zero — an empty badge says
// nothing a missing one doesn't.
export function formatFilesCount(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 999 ? '999+' : String(n);
}

// F, bare, outside an editor. The caller adds the guards that need app state
// (a modal, an open doc, the palette, a non-board surface).
export function isViewSwitchKey(e) {
  if (!e || (e.key !== 'f' && e.key !== 'F')) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  if (e.repeat) return false;
  return true;
}
