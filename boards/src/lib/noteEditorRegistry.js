// Active note Tiptap editor registry. Only one note is edited at a time on a
// board, so a single slot + subscription is enough. This lets the shared bottom
// toolbar (ToolOptionsBar / NoteRichTextBar) drive the live collaborative note
// editor with Tiptap commands, without threading the editor instance through
// the (heavily-shared) CanvasSurface render path.

//
// `actions` carries the few things the toolbar needs that are NOT plain Tiptap
// commands — currently just openAddComment, which has to run the whole
// useAddCommentFlow (composer placement, thread creation, mark application).

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
