// Which conversations are open on screen right now, by thread id. The shared
// comment card (components/comments/CommentCard.jsx: the canvas card, a doc's
// panel, a note's card, a shared file's rail) holds its thread here while it
// shows it, and a notice about a conversation you are looking at stays out of
// the toasts (lib/notificationsBell.js shouldToastNotice, App's mention
// toast). Counted, so two cards on one thread (a split view) release cleanly.
const open = new Map();

// → the release, for an effect's cleanup.
export function holdThreadOpen(threadId) {
  if (!threadId) return () => {};
  const id = String(threadId);
  open.set(id, (open.get(id) || 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const n = (open.get(id) || 1) - 1;
    if (n > 0) open.set(id, n); else open.delete(id);
  };
}

export function isThreadOpen(threadId) {
  return !!threadId && open.has(String(threadId));
}
