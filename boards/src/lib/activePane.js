// Which pane (main | split) owns the global keyboard + clipboard shortcuts.
//
// Both CanvasSurface instances (and ListSurface) register window-level
// keydown/paste listeners. Without this arbiter, opening a split view meant
// one Cmd+Z fired undo on BOTH boards at once (and Cmd+C/X/V/D/A crosstalked
// the same way). Surfaces mark themselves active on pointerdown/pointerenter;
// the listeners bail unless they own the pane — but only while a split is
// actually open, so the single-pane case never depends on pointer history.
let activePaneId = 'main';

export function setActivePane(paneId) {
  if (paneId) activePaneId = paneId;
}

export function getActivePane() {
  return activePaneId;
}
