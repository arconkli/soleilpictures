// The link to one comment, for Copy link and for notices. Three places:
//
//   canvas      <app>?board=<cluster id>&comment=<comment id>
//   doc / note  <app>?board=<cluster id>&card=<card id>&comment=<thread id>
//   shared file <origin>/f/<share token>?comment=<comment id>
//
// lib/commentLink.js reads them back. The writing is here, apart from the
// reading, because only the comment parts write one (they arrive on a press)
// while the app reads one as it opens: in one file the two would be a chunk
// of their own in the app's first download. commentLink.test.mjs holds the
// two together.
//
// Pure: the page's address comes in as `href`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// the same ids lib/commentLink.js reads (its LOOSE_ID, the one rule; kept as
// a literal here so this file imports nothing: commentLink.test.mjs compares)
const LOOSE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const norm = (id) => (UUID.test(id) ? id.toLowerCase() : id);

// { surface: 'canvas', boardId, commentId }
// { surface: 'doc' | 'note', boardId, cardId, commentId }
// { surface: 'file', token, commentId }
// → the address, or null when a part is missing or isn't an id.
export function commentLinkUrl(href, target = {}) {
  const { surface, boardId, cardId, token, commentId } = target;
  if (!commentId || !LOOSE_ID.test(String(commentId))) return null;
  let url;
  try { url = new URL(href); } catch (_) { return null; }
  const comment = encodeURIComponent(norm(String(commentId)));
  if (surface === 'file') {
    if (!token || !UUID.test(String(token))) return null;
    return `${url.origin}/f/${String(token).toLowerCase()}?comment=${comment}`;
  }
  if (!boardId || !UUID.test(String(boardId))) return null;
  const q = new URLSearchParams();
  q.set('board', String(boardId).toLowerCase());
  if (surface === 'doc' || surface === 'note') {
    if (!cardId || !LOOSE_ID.test(String(cardId))) return null;
    q.set('card', norm(String(cardId)));
  } else if (surface !== 'canvas') {
    return null;
  }
  q.set('comment', norm(String(commentId)));
  return `${url.origin}${url.pathname}?${q.toString()}`;
}
