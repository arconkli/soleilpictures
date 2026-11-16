// A comment link was opened (?board=<cluster>&comment=<id>, lib/commentLink.js):
// App.jsx opens the cluster and leaves the request here; the canvas showing
// that cluster takes it once its comments have loaded, goes to the
// conversation and opens it. One request at a time; taken once. With a
// `cardId` it is a thread on the words of a doc or a note: the note layer
// (comments/NoteCommentsLayer.jsx) or the doc itself (DocSurface) takes it.
//
// The request carries two things its takers wait on:
//   synced   the cluster's server copy is in (the canvas says so, below).
//            Until it is, a comment that is not found is not called gone.
//   opened   the doc the comment is in has opened and seen the request
//            (DocSurface). Until it has, the note layer keeps asking the
//            doc's card to open: a card off screen is not drawn, and hears
//            nothing.
// A request nobody took is dropped after two minutes, so it cannot open
// something on a later, unrelated visit to that cluster.
let pending = null;
const subs = new Set();
const synced = new Set();   // clusters whose server copy is in
const tell = () => { subs.forEach((f) => f()); };

export const OPEN_COMMENT_MS = 2 * 60 * 1000;
const live = (now) => {
  if (pending && now - pending.at > OPEN_COMMENT_MS) pending = null;
  return pending;
};

export function requestOpenComment({ boardId, commentId, cardId = null } = {}, now = Date.now()) {
  if (!boardId || !commentId) return;
  pending = { boardId, commentId, cardId, at: now, synced: synced.has(boardId), opened: false };
  tell();
}
export function peekOpenComment(now = Date.now()) { return live(typeof now === 'number' ? now : Date.now()); }
// The request, if it is for this cluster; it is then gone.
export function takeOpenComment(boardId, now = Date.now()) {
  if (!live(now) || pending.boardId !== boardId) return null;
  const p = pending;
  pending = null;
  tell();
  return p;
}
export function subscribeOpenComment(f) { subs.add(f); return () => subs.delete(f); }

// The canvas, as its cluster's server copy arrives (and when it leaves).
export function setCommentBoardSynced(boardId, on) {
  if (!boardId || synced.has(boardId) === !!on) return;
  if (on) synced.add(boardId); else synced.delete(boardId);
  if (pending && pending.boardId === boardId) { pending = { ...pending, synced: !!on }; tell(); }
}
// Is what `ydoc` holds the server's copy? (A live, synced room says the same
// for a cluster with no saved snapshot.)
export function openCommentSynced(link, ydoc) {
  return !!link && (link.synced === true || ydoc?._soleilRoom?.synced === true);
}
// The doc the request is for has opened and has it.
export function ackOpenComment(cardId) {
  if (!pending || !cardId || pending.cardId !== cardId || pending.opened) return;
  pending = { ...pending, opened: true };
  tell();
}
