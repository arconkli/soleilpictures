// Active note Tiptap editor registry. Only one note is edited at a time on a
// board, so a single slot + subscription is enough. This lets the shared bottom
// toolbar (ToolOptionsBar / NoteRichTextBar) drive the live collaborative note
// editor with Tiptap commands, without threading the editor instance through
// the (heavily-shared) CanvasSurface render path.

let active = null;
const subs = new Set();

export function setActiveNoteEditor(editor) {
  active = editor || null;
  subs.forEach((cb) => { try { cb(active); } catch (_) {} });
}

export function getActiveNoteEditor() {
  return active;
}

export function subscribeActiveNoteEditor(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
