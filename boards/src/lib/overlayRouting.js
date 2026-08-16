// Which overlay owns Cmd+Z right now.
//
// While a doc overlay is open, canvas Cmd+Z must NOT silently undo canvas
// ops hidden behind it — doc STRUCTURAL undo (the DOC_ORIGIN UndoManager
// from docState.getDocUndoManager) owns the shortcut instead. The doc
// surface registers itself here on mount; CanvasSurface's window keydown
// handler stands down while a target is registered (the doc surface has its
// own listener, so gating here also prevents a split view from double-firing
// the doc undo through both panes' handlers). Typing inside the doc's text
// editor is unaffected — Tiptap's own y-undo swallows Cmd+Z before either
// window listener can act on it.
let docUndoTarget = null;

export function setDocUndoTarget(um) {
  docUndoTarget = um || null;
}

export function getDocUndoTarget() {
  return docUndoTarget;
}
