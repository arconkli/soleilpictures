// Who answers ⌘Z while a note is being edited.
//
// A note being written has two undo histories: its text lives in the note's
// own UndoManager (getNoteUndoManager, through Collaboration), and a style for
// the whole note set from the note bar (colour, background, font, size,
// "Center in the box") is a card field on the board's undo. ⌘Z in the editor
// only ever reached the text, so after a style change it took back typing and
// left the style. This keeps the order: each board step written from the note
// bar is remembered with how deep the text history was then, and ⌘Z goes to
// the board while no text change has come since; ⇧⌘Z mirrors it. One route per
// editing session, so it never reaches a step from before the note was opened.
//
// styleWrite records a microtask later: a write inside an outer transaction
// (Center in the box) only becomes a board step when that transaction ends.
const MAX = 20;
const last = (a) => (a && a.length ? a[a.length - 1] : null);

export function createNoteUndoRoute(textUndo) {
  let past = [];   // board steps, oldest first: { board, item, depth }
  let future = []; // board steps undone from here, newest last
  let pending = false;
  const depth = (stack) => (textUndo ? textUndo[stack].length : 0);
  // A new text change starts a new branch: no board step is redone past it.
  const onText = () => { if (!textUndo.undoing && !textUndo.redoing) future = []; };
  if (textUndo) {
    textUndo.on('stack-item-added', onText);
    textUndo.on('stack-item-updated', onText);
  }
  const record = (board) => {
    const item = last(board?.undoManager?.undoStack);
    if (!item) return;
    future = [];
    if (last(past)?.item === item) return; // merged into the same board step
    if (textUndo) {
      // Typing on either side of the style is two text steps, and text undone
      // before the style isn't redone after it.
      textUndo.stopCapturing();
      textUndo.clear(false, true);
    }
    past.push({ board, item, depth: depth('undoStack') });
    if (past.length > MAX) past.shift();
  };
  return {
    // board: the canvas mutators ({ undoManager, undo, redo }); write: the
    // card write. A style never merges into a board step that isn't a style
    // (a colour picked right after the note was placed must not undo with the
    // "add card"), but styles in a row still do (a colour pad's drag).
    styleWrite(board, write) {
      const um = board?.undoManager;
      const top = last(past);
      // A new board step unless the board's last step is this route's last
      // style and no text has changed since: style, typing, style inside the
      // board's capture window is three steps, not the two styles as one.
      if (!pending && um && (last(um.undoStack) !== (top?.item ?? null)
          || (top && depth('undoStack') !== top.depth))) um.stopCapturing();
      pending = true;
      try { write(); } finally {
        queueMicrotask(() => { pending = false; record(board); });
      }
    },
    // true when the board took the key; false leaves it to the editor.
    undo() {
      const e = last(past);
      if (!e || depth('undoStack') > e.depth) return false;
      past.pop();
      const um = e.board.undoManager;
      if (last(um?.undoStack) !== e.item) { past = []; return false; }
      e.board.undo();
      const item = last(um.redoStack);
      if (item) future.push({ board: e.board, item, depth: depth('redoStack') });
      return true;
    },
    redo() {
      const e = last(future);
      if (!e || depth('redoStack') > e.depth) return false;
      future.pop();
      const um = e.board.undoManager;
      if (last(um?.redoStack) !== e.item) { future = []; return false; }
      e.board.redo();
      const item = last(um.undoStack);
      if (item) past.push({ board: e.board, item, depth: depth('undoStack') });
      return true;
    },
    destroy() {
      if (!textUndo) return;
      textUndo.off('stack-item-added', onText);
      textUndo.off('stack-item-updated', onText);
    },
  };
}
