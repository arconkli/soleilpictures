// How the canvas knows a dialog is open.
//
// CanvasSurface and ListSurface register WINDOW-level keydown/paste handlers.
// Modal.jsx traps focus, but a focused <button> is not an "editable target",
// so before this guard a Backspace pressed inside the Trash dialog (or
// Version history, Settings, a confirm prompt) fell through and DELETED the
// selected cards on the board behind it — the same class of bug the sketch
// pad had. Every dialog-ish surface registers here on mount; the window
// shortcut handlers stand down while anything is open.
//
// A counter (not a boolean) because dialogs stack: a confirm prompt opens on
// top of the Version-history modal, etc.
let openCount = 0;

export function registerModalOpen() {
  openCount += 1;
  return () => { openCount = Math.max(0, openCount - 1); };
}

export function anyModalOpen() {
  return openCount > 0;
}
