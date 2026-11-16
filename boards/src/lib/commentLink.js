// Reading the link to one comment (Copy link, notices). Three places:
//
//   canvas      <app>?board=<cluster id>&comment=<comment id>
//   doc / note  <app>?board=<cluster id>&card=<card id>&comment=<thread id>
//   shared file <origin>/f/<share token>?comment=<comment id>
//
// The first two ride the app's own ?board=&card= deep link (lib/cardLink.js;
// App.jsx reads it once the clusters have loaded): the cluster opens, the card
// is brought into view and the conversation opens. A shared file is its own
// page (main.jsx routes /f/<token>; lib/fileShares.js fileShareUrl).
//
// Pure: the page's address comes in as `href`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Canvas and file comments are uuids; a doc thread is 'cm_…' and its reply
// 'cr_…' (docState); a card is a uuid or an api-… id (keepDraft's CARD_ID).
// THE id rule for a comment link and a comment notice, 80 characters:
// lib/notificationsBell.js and lib/commentNotices.js import it (NOTICE_ID);
// lib/commentLinkUrl.js (LOOSE_ID) and the emails
// (supabase/functions/_shared/email/templates.ts LINK_ID, another runtime)
// keep the same literal. commentLink.test.mjs holds them all to this one.
export const LOOSE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE_PATH = /^\/f\/([0-9a-f-]{36})\/?$/i;

const norm = (id) => (UUID.test(id) ? id.toLowerCase() : id);

// Writing one is lib/commentLinkUrl.js (commentLinkUrl), which only the
// comment parts need; this file is what the app reads as it opens.

// What an address asks to open, or null when it names no comment.
//   { surface: 'file', token, commentId }
//   { surface: 'card', boardId, cardId, commentId }   a doc's or a note's thread
//   { surface: 'canvas', boardId, commentId }
// A doc and a note read the same: the card says which it is.
export function readCommentLink(href) {
  let url;
  try { url = new URL(href, 'https://x.invalid'); } catch (_) { return null; }
  const raw = url.searchParams.get('comment');
  if (!raw || !LOOSE_ID.test(raw)) return null;
  const commentId = norm(raw);
  const f = FILE_PATH.exec(url.pathname);
  if (f) return UUID.test(f[1]) ? { surface: 'file', token: f[1].toLowerCase(), commentId } : null;
  const board = url.searchParams.get('board');
  if (!board || !UUID.test(board)) return null;
  const boardId = board.toLowerCase();
  const card = url.searchParams.get('card');
  if (card) return LOOSE_ID.test(card) ? { surface: 'card', boardId, cardId: norm(card), commentId } : null;
  return { surface: 'canvas', boardId, commentId };
}

// An email's link (deepLink in the email templates) names the cluster as ?b=,
// the key the sign-in gate consumes, and a comment beside it as &comment=
// (and &card= for a doc's or a note's thread). These are the keys to carry
// over as the gate strips ?w=&b=: the same link, in the app's own ?board=
// form that App.jsx reads once the clusters have loaded. Null when the
// address names no comment, or any of its ids is not an id.
export function emailCommentKeys(searchParams) {
  try {
    const b = searchParams.get('b');
    const comment = searchParams.get('comment');
    const card = searchParams.get('card');
    if (!b || !UUID.test(b) || !comment || !LOOSE_ID.test(comment)) return null;
    if (card && !LOOSE_ID.test(card)) return null;
    return { board: b.toLowerCase(), comment, ...(card ? { card } : {}) };
  } catch (_) { return null; }
}

// The address without the comment (and, in the app, without the deep-link
// keys it came with), for history.replaceState once the comment is open.
export function withoutCommentLink(href) {
  let url;
  try { url = new URL(href); } catch (_) { return href; }
  url.searchParams.delete('comment');
  if (!FILE_PATH.test(url.pathname)) { url.searchParams.delete('board'); url.searchParams.delete('card'); }
  return url.pathname + (url.search || '') + (url.hash || '');
}
