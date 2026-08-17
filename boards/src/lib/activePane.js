// Which pane (main | split) owns the global keyboard + clipboard shortcuts.
//
// Both CanvasSurface instances (and ListSurface) register window-level
// keydown/paste listeners. Without this arbiter, opening a split view meant
// one Cmd+Z fired undo on BOTH boards at once (and Cmd+C/X/V/D/A crosstalked
// the same way). Surfaces mark themselves active on pointerdown/pointerenter;
// the listeners bail unless they own the pane — but only while a split is
// actually open, so the single-pane case never depends on pointer history.
// It also decides what the TOOLBAR is talking about. A split shows two boards
// and there is one topbar, so the breadcrumb, the back/forward pair and the
// sidebar highlight all describe the pane you last touched — which means React
// has to re-render when this changes, hence the subscription. Kept as a module
// (not context) because the window-level listeners read it synchronously from
// inside event handlers, where a React value would be a render behind.
let activePaneId = 'main';
const listeners = new Set();

export function setActivePane(paneId) {
  if (!paneId || paneId === activePaneId) return;
  activePaneId = paneId;
  // A listener that throws must not stop the others from hearing about it.
  for (const fn of [...listeners]) { try { fn(activePaneId); } catch (_) {} }
}

export function getActivePane() {
  return activePaneId;
}

// Returns an unsubscribe. Fires only on genuine changes — the setter above
// bails when the pane is unchanged, so hovering back and forth inside one pane
// doesn't re-render the shell.
export function subscribeActivePane(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
