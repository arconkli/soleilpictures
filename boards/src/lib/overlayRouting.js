// Which overlay owns Cmd+Z right now.
//
// While a doc overlay is open, canvas Cmd+Z must NOT silently undo canvas
// ops hidden behind it — doc STRUCTURAL undo (the DOC_ORIGIN UndoManager
// from docState.getDocUndoManager) owns the shortcut instead. Overlays
// register here on mount; CanvasSurface's window keydown handler stands
// down while any target is registered. Typing inside a text editor is
// unaffected — Tiptap's own y-undo swallows Cmd+Z before either window
// listener can act on it.
//
// This is a STACK, not a single slot: a docked doc pane and a modal doc can
// be mounted at once, and each registers its own window keydown listener.
// Every listener must check `getDocUndoTarget() === mine` before acting —
// the TOP of the stack owns the shortcut — or one keypress fires both
// surfaces' undos. Popping on unmount hands ownership back to the surface
// below (closing the modal re-arms the docked pane).
let docUndoTargets = [];

export function pushDocUndoTarget(um) {
  if (um) docUndoTargets.push(um);
}

export function removeDocUndoTarget(um) {
  docUndoTargets = docUndoTargets.filter((t) => t !== um);
}

export function getDocUndoTarget() {
  return docUndoTargets.length ? docUndoTargets[docUndoTargets.length - 1] : null;
}

// Back-compat setter: null clears the stack; a target replaces it.
export function setDocUndoTarget(um) {
  docUndoTargets = um ? [um] : [];
}
