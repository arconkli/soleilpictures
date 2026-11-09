// Active note Tiptap editor registry. Only one note is edited at a time on a
// board, so a single slot + subscription is enough. This lets the shared bottom
// toolbar (ToolOptionsBar / NoteRichTextBar) drive the live collaborative note
// editor with Tiptap commands, without threading the editor instance through
// the (heavily-shared) CanvasSurface render path.

//
// `actions` carries the few things the toolbar needs that are NOT plain Tiptap
// commands — currently just openAddComment, which has to run the whole
// useAddCommentFlow (composer placement, thread creation, mark application).

import { abandonTouchKeyboard } from './touchKeyboard.js';

let active = null;
let activeActions = {};
const subs = new Set();

export function setActiveNoteEditor(editor, actions = {}) {
  active = editor || null;
  activeActions = editor ? (actions || {}) : {};
  subs.forEach((cb) => { try { cb(active); } catch (_) {} });
}

export function getActiveNoteEditor() {
  return active;
}

export function getActiveNoteActions() {
  return activeActions;
}

export function subscribeActiveNoteEditor(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

// End the note edit in progress, as a click outside it does with a mouse. A
// finger's tap on the canvas can't: the canvas takes every touch
// (startTouchCanvasPress preventDefaults it), so the browser never blurs the
// editor. Blurring it here runs the editor's own exit (NoteTiptapSurface
// onBlur → exitEdit), synchronously, before the tap selects anything. A note
// still waiting for its editor (the keyboard keeper has the focus) goes back
// to reading. An editor that isn't focused is left to its own NOTES-13 exit,
// which already heard this press. `exceptCardId` is a note the tap landed on,
// which may be starting its own edit (see abandonTouchKeyboard).
export function endActiveNoteEdit(exceptCardId = null) {
  const abandoned = abandonTouchKeyboard(exceptCardId);
  const ed = active;
  if (!ed || ed.isDestroyed) return abandoned;
  try {
    if (ed.view.hasFocus()) { ed.view.dom.blur(); return true; }
  } catch (_) { /* torn down */ }
  return abandoned;
}

// Boards that can move to show a note's caret: each CanvasSurface adds one,
// so the note editor (its own chunk) asks without importing the canvas. A
// revealer answers only for an element inside its own board.
const revealers = new Set();

export function addCanvasRevealer(fn) {
  revealers.add(fn);
  return () => { revealers.delete(fn); };
}

// Ask the board holding `el` to glide so `rect` ({ top, bottom }, client px)
// sits inside `band` ({ top, bottom }). true when a board moved.
export function ensureClientRectVisible(el, rect, band) {
  for (const fn of revealers) {
    try { if (fn(el, rect, band)) return true; } catch (_) { /* a board mid-unmount */ }
  }
  return false;
}
