// Comments over the API. A board carries two kinds of comment thread:
//
//   · its own, the bubbles on the canvas: rows in public.comments, on a card, a
//     group, a point, or the board as a whole (lib/commentsApi.js);
//   · the ones inside a doc or a note, on a run of its text: filed in that
//     card's docComments Y.Map (lib/commentKeys.js), the text marked by a
//     CommentMark inside the card's own fragments.
//
// Both read as one list, each thread the same shape whichever kind it is. The
// board's own are written as the app writes them, and as the user, so the
// table's policies decide who may comment, resolve or delete. Pure: the Worker
// (worker-api.js) does the reading and the writing.

import { readComments, readPages, getPageSheetIds } from './docState.js';
import { fragmentToJSON } from './docMarkdown.js';
import { pickCommentOffset } from './commentPlacement.js';
import { emailToName } from './personName.js';
import { pickPresenceColor } from './presenceColor.js';

export const COMMENTS = {
  // A comment's words, at most: where the app cuts one in a doc or a note
  // (docState.addCommentThread); a test holds the two together.
  maxBody: 4000,
  defaultLimit: 50,
  maxLimit: 200,
  // A board's own comments read for one list. Boards carry dozens; past this
  // the answer says it is short rather than being short quietly.
  maxRows: 2000,
  // Thread ids one resolve_comments call takes.
  maxResolve: 50,
  // How much of the text a doc's comment is on comes back with it.
  maxQuote: 300,
  // How long the words a new comment in a doc is put on may be.
  maxAnchor: 2000,
};

// What a read of the board's own comments selects.
export const COMMENT_FIELDS = 'id,anchor_kind,anchor_id,anchor_x,anchor_y,offset_x,offset_y,'
  + 'doc_page_id,author,body,reply_to,hidden,resolved,created_at';

export const STATUSES = ['open', 'resolved', 'all'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A board's own comment has a uuid; a thread inside a doc or a note has the
// id docState gave it ('cm_…'), and a reply in one 'cr_…'.
export const isBoardCommentId = (id) => UUID.test(String(id || ''));
const CARD_COMMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const time = (s) => {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : 0;
};

// ── Reading ─────────────────────────────────────────────────────────────────

// The board's own threads from its rows: each top-level comment with its
// replies, oldest first. A reply whose thread is gone (deleted, so not read)
// goes with it, as on the canvas.
export function boardThreads(rows) {
  const replies = new Map();
  const roots = [];
  for (const r of rows || []) {
    if (!r?.id) continue;
    if (r.reply_to) {
      if (!replies.has(r.reply_to)) replies.set(r.reply_to, []);
      replies.get(r.reply_to).push(r);
    } else {
      roots.push(r);
    }
  }
  return roots.map((r) => {
    const kind = r.anchor_kind;
    return {
      id: r.id,
      // Rows from before a doc's comments moved into the doc read as the doc's.
      on: kind === 'doc_range' ? 'doc' : kind,
      card_id: kind === 'card' || kind === 'doc_range' ? r.anchor_id ?? null : null,
      group_id: kind === 'group' ? r.anchor_id ?? null : null,
      x: kind === 'point' ? r.anchor_x ?? null : null,
      y: kind === 'point' ? r.anchor_y ?? null : null,
      page_id: kind === 'doc_range' ? r.doc_page_id ?? null : null,
      body: r.body ?? '',
      author_id: r.author ?? null,
      created_at: r.created_at ?? null,
      resolved: !!r.resolved,
      hidden: !!r.hidden,
      replies: (replies.get(r.id) || [])
        .sort((a, b) => time(a.created_at) - time(b.created_at))
        .map((x) => ({ id: x.id, body: x.body ?? '', author_id: x.author ?? null, created_at: x.created_at ?? null })),
    };
  });
}

// The text each comment mark in a fragment covers, by thread id: one thread's
// runs in reading order, a space between runs in different blocks.
export function collectQuotes(frag, into = new Map()) {
  if (!frag || typeof frag.toArray !== 'function') return into;
  let block = 0;
  const last = new Map();
  const visit = (node) => {
    if (node?.type === 'text') {
      for (const m of node.marks || []) {
        const id = m?.type === 'comment' ? m.attrs?.id : null;
        if (!id || !node.text) continue;
        const prev = into.get(id) || '';
        into.set(id, prev + (prev && last.get(id) !== block ? ' ' : '') + node.text);
        last.set(id, block);
      }
      return;
    }
    block += 1;
    for (const c of node?.content || []) visit(c);
  };
  for (const n of fragmentToJSON(frag).content) visit(n);
  return into;
}

// The threads inside the board's docs and notes, each with the text it is on.
// `cards` are readCards' own, their Y types still live: this runs while the
// board is open.
export function cardThreads(cards) {
  const out = [];
  for (const card of cards || []) {
    const comments = card?.docComments;
    if (!comments || typeof comments.forEach !== 'function') continue;
    const kind = card.kind || 'note';
    if (kind !== 'doc' && kind !== 'note') continue;
    const threads = readComments(null, { comments });
    if (!threads.length) continue;

    const quotes = new Map();
    const titles = new Map();
    if (kind === 'doc') {
      const scope = {
        pages: card.docPages, content: card.docPageContent,
        pageSheets: card.docPageSheets, sheetContent: card.docSheetContent,
      };
      const pages = readPages(null, scope);
      for (const p of pages) titles.set(p.id, p.name || '');
      // Every page a thread is on, read once; a thread filed with no page
      // (from before pages) is looked for on all of them.
      const wanted = new Set(threads.map((t) => t.pageId));
      const read = wanted.has(undefined) || wanted.has(null) ? pages.map((p) => p.id) : [...wanted];
      for (const pageId of read) {
        for (const sid of getPageSheetIds(null, pageId, scope)) {
          collectQuotes(sid === pageId ? scope.content?.get?.(sid) : scope.sheetContent?.get?.(sid), quotes);
        }
      }
    } else {
      collectQuotes(card.noteFragment, quotes);
    }

    for (const t of threads) {
      out.push({
        id: t.id,
        on: kind,
        card_id: String(card.id),
        group_id: null,
        x: null,
        y: null,
        page_id: kind === 'doc' ? t.pageId ?? null : null,
        page_title: kind === 'doc' && t.pageId != null ? titles.get(t.pageId) ?? null : null,
        quote: quotes.get(t.id) || null,
        body: typeof t.body === 'string' ? t.body : '',
        author_id: t.authorId || null,
        author_name: typeof t.author === 'string' ? t.author : null,
        created_at: iso(t.ts),
        resolved: !!t.resolved,
        hidden: false,
        replies: (t.replies || []).map((r) => ({
          id: r.id ?? null,
          body: typeof r.body === 'string' ? r.body : '',
          author_id: r.authorId || null,
          author_name: typeof r.author === 'string' ? r.author : null,
          created_at: iso(r.ts),
        })),
      });
    }
  }
  return out;
}

// People's names as the app shows them (lib/userProfiles.js): the one they
// set (member_profiles), else one made from their email (users_by_ids, which
// answers only for people who share a workspace with the reader).
export function namesFrom(profiles, users) {
  const out = new Map();
  for (const u of users || []) {
    if (u?.user_id && u.email) out.set(u.user_id, emailToName(u.email) || u.email);
  }
  for (const p of profiles || []) {
    if (p?.user_id && p.display_name) out.set(p.user_id, p.display_name);
  }
  return out;
}

// Everyone a list names, for one lookup.
export function authorIds(threads) {
  const ids = new Set();
  for (const t of threads) {
    if (t.author_id) ids.add(t.author_id);
    for (const r of t.replies) if (r.author_id) ids.add(r.author_id);
  }
  return [...ids].filter((id) => UUID.test(id));
}

// When a thread last moved: its newest reply, else when it was started.
const lastActive = (t) => Math.max(time(t.created_at), ...t.replies.map((r) => time(r.created_at)));

// One page of threads, liveliest first, and how many there are of each kind.
export function pageThreads(threads, { status = 'open', offset = 0, limit = COMMENTS.defaultLimit } = {}) {
  const counts = { open: 0, resolved: 0 };
  for (const t of threads) counts[t.resolved ? 'resolved' : 'open'] += 1;
  const want = threads
    .filter((t) => status === 'all' || (status === 'resolved') === t.resolved)
    .sort((a, b) => lastActive(b) - lastActive(a) || String(a.id).localeCompare(String(b.id)));
  const page = want.slice(offset, offset + limit);
  return { counts, page, hasMore: offset + page.length < want.length };
}

// A thread as the API hands it out. Fields that don't apply to where it is are
// left out rather than sent as null, so a list costs a model what it says.
export function publicThread(t, { names = new Map(), userId = null, cards = new Map(), url = null } = {}) {
  const who = (id, stored) => ({
    author_id: id || null,
    author_name: (id && names.get(id)) || stored || 'Member',
    by_you: !!id && id === userId,
  });
  const out = { id: t.id, on: t.on };
  if (t.card_id != null) {
    const c = cards.get(String(t.card_id));
    out.card_id = String(t.card_id);
    out.card_kind = c?.kind ?? null;
    out.card_title = c?.title || null;
  }
  if (t.group_id != null) out.group_id = t.group_id;
  if (t.on === 'point') {
    out.x = t.x;
    out.y = t.y;
  }
  if (t.page_id != null) {
    out.page_id = t.page_id;
    if (t.page_title != null) out.page_title = t.page_title;
  }
  if (t.quote) {
    out.quote = t.quote.length > COMMENTS.maxQuote ? `${t.quote.slice(0, COMMENTS.maxQuote)}…` : t.quote;
  }
  Object.assign(out, { body: t.body, ...who(t.author_id, t.author_name), created_at: t.created_at, resolved: t.resolved });
  if (t.hidden) out.hidden = true;
  out.replies = t.replies.map((r) => ({
    id: r.id, body: r.body, ...who(r.author_id, r.author_name), created_at: r.created_at,
  }));
  if (url) out.url = url;
  return out;
}

// ── Writing ─────────────────────────────────────────────────────────────────

const MAX_COORD = 1_000_000_000;

// A new comment as POST /boards/:id/comments takes it: its words, and where it
// goes — on a card, on a group, at a point (x and y), on the board as a whole
// (none of those), on words inside a doc (card_id with quote, and page_id to
// say which page), or into a thread (reply_to, where it sits with the thread).
// `{ problem }` names what's wrong with it.
export function readNewComment(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { problem: 'send a JSON object with body' };
  if (typeof b.body !== 'string' || !b.body.trim()) return { problem: 'body is required: the comment\'s words' };
  const body = b.body.trim();
  if (body.length > COMMENTS.maxBody) {
    return { problem: `body is ${body.length} characters; a comment holds at most ${COMMENTS.maxBody}` };
  }
  const placed = ['card_id', 'group_id', 'x', 'y', 'quote', 'page_id'].filter((k) => b[k] != null);
  if (b.reply_to != null) {
    if (typeof b.reply_to !== 'string' || !b.reply_to) return { problem: 'reply_to must be a comment id' };
    if (placed.length) return { problem: 'a reply sits with its thread: leave out card_id, group_id, x, y, quote and page_id' };
    return { body, replyTo: b.reply_to };
  }
  if (b.page_id != null && b.quote == null) return { problem: 'page_id goes with quote: the page the words are on' };
  if (b.quote != null) {
    if (b.card_id == null) return { problem: 'quote goes with card_id: the doc the words are in' };
    if (typeof b.quote !== 'string' || !b.quote.trim()) return { problem: 'quote must be the words the comment is on' };
    if (b.quote.length > COMMENTS.maxAnchor) {
      return { problem: `quote is ${b.quote.length} characters; a comment goes on at most ${COMMENTS.maxAnchor}` };
    }
    if (b.page_id != null && (typeof b.page_id !== 'string' || !b.page_id)) return { problem: 'page_id must be a page id' };
  }
  const atPoint = b.x != null || b.y != null;
  if (atPoint && !(Number.isFinite(b.x) && Number.isFinite(b.y))) return { problem: 'x and y go together, as numbers' };
  // A point is stored in integer columns.
  if (atPoint && Math.max(Math.abs(b.x), Math.abs(b.y)) > MAX_COORD) {
    return { problem: `x and y must be within ${MAX_COORD} of the board's origin` };
  }
  if ([b.card_id != null, b.group_id != null, atPoint].filter(Boolean).length > 1) {
    return { problem: 'one of card_id, group_id, or x and y — or none of them, for the board as a whole' };
  }
  for (const k of ['card_id', 'group_id']) {
    if (b[k] != null && (typeof b[k] !== 'string' || !b[k])) return { problem: `${k} must be an id` };
  }
  const inDoc = b.quote != null ? { kind: 'doc', id: b.card_id, quote: b.quote, pageId: b.page_id ?? null } : null;
  const anchor = inDoc || (b.card_id != null ? { kind: 'card', id: b.card_id }
    : b.group_id != null ? { kind: 'group', id: b.group_id }
      : atPoint ? { kind: 'point', x: Math.round(b.x), y: Math.round(b.y) }
        : { kind: 'board' });
  return { body, anchor };
}

// What PATCH /boards/:id/comments takes: the threads, and whether to resolve
// them or reopen them.
export function readResolveMany(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { problem: 'send {"comment_ids": [...], "resolved": true}' };
  const extra = Object.keys(b).find((k) => k !== 'comment_ids' && k !== 'resolved');
  if (extra) return { problem: `${extra} isn't taken here: send comment_ids and resolved` };
  if (typeof b.resolved !== 'boolean') return { problem: 'resolved must be true (resolve them) or false (reopen them)' };
  if (!Array.isArray(b.comment_ids) || !b.comment_ids.length) return { problem: 'comment_ids must list thread ids' };
  if (b.comment_ids.length > COMMENTS.maxResolve) return { problem: `at most ${COMMENTS.maxResolve} threads a call` };
  if (b.comment_ids.some((x) => typeof x !== 'string' || !x)) return { problem: 'comment_ids must be comment ids' };
  return { ids: [...new Set(b.comment_ids)], resolved: b.resolved };
}

// ── Threads inside docs and notes ───────────────────────────────────────────

// The thread inside a doc or a note that `id` names, among a board's cards
// (the cards Y.Map, live): the thread itself, or one of its replies
// (`replyId` then). Null when no card holds it.
export function findCardThread(cardsMap, id) {
  if (typeof id !== 'string' || !CARD_COMMENT_ID.test(id)) return null;
  for (const [cardId, ym] of cardsMap.entries()) {
    if (!ym || typeof ym.get !== 'function') continue;
    const kind = ym.get('kind') || 'note';
    if (kind !== 'doc' && kind !== 'note') continue;
    const comments = ym.get('docComments');
    if (!comments || typeof comments.forEach !== 'function') continue;
    for (const thread of readComments(null, { comments })) {
      const at = { cardId: String(cardId), kind, ym, comments, thread };
      if (thread.id === id) return at;
      if (thread.replies.some((r) => r.id === id)) return { ...at, replyId: id };
    }
  }
  return null;
}

// Who a comment written in a doc or a note is filed as, as the app files its
// own person (App.jsx's currentUser): the name they set, else one made from
// their email (as the API names everyone; the app's own fallback is the
// email's first half), and their colour, else the one presence gives them.
export function docAuthor({ profile = null, email = null, userId }) {
  return {
    name: profile?.display_name || emailToName(email) || 'Member',
    color: profile?.color || pickPresenceColor(userId),
  };
}

// Where a reply goes: where its thread is, as the app's reply does
// (CanvasComment's parentAnchor), so a thread stays together when its card
// moves.
export function anchorOf(row) {
  if (row.anchor_kind === 'card') return { kind: 'card', id: row.anchor_id };
  if (row.anchor_kind === 'group') return { kind: 'group', id: row.anchor_id };
  if (row.anchor_kind === 'point') return { kind: 'point', x: row.anchor_x, y: row.anchor_y };
  if (row.anchor_kind === 'board') return { kind: 'board' };
  return { kind: 'card', id: row.anchor_id };
}

// The row the app's addComment writes for that anchor (lib/commentsApi.js).
export function commentRow({ workspaceId, boardId, author, body, anchor, replyTo = null, offset = null }) {
  return {
    workspace_id: workspaceId,
    board_id: boardId,
    author,
    body,
    reply_to: replyTo,
    anchor_kind: anchor.kind,
    anchor_id: anchor.kind === 'card' || anchor.kind === 'group' ? anchor.id : null,
    anchor_x: anchor.kind === 'point' ? Math.round(anchor.x) : null,
    anchor_y: anchor.kind === 'point' ? Math.round(anchor.y) : null,
    doc_page_id: null,
    doc_from: null,
    doc_to: null,
    offset_x: Math.round(offset?.x || 0),
    offset_y: Math.round(offset?.y || 0),
  };
}

// A bubble's size as the app reckons it when placing one (CanvasSurface's
// commentRectFor), and where the canvas draws one on the board as a whole
// (lib/bubbleLayout.js).
const BUBBLE = { w: 240, h: 76 };
const BOARD_SPOT = { x: 100, y: 100 };
// A comment on the board as a whole lands this far right of everything, each
// one after the first this far below the last.
const BESIDE = 48;
const STACK = 96;

const rectOf = (c) => ({ x: Number(c.x) || 0, y: Number(c.y) || 0, w: Number(c.w) || 0, h: Number(c.h) || 0 });

function bounds(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x, y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}

const groupBox = (cards, groupId) => bounds(cards.filter((c) => c.groupId === groupId).map(rectOf));

// Where a bubble already on the board sits, as the app reckons it.
function bubbleRect(row, cards) {
  const ox = row.offset_x || 0;
  const oy = row.offset_y || 0;
  let box = null;
  if (row.anchor_kind === 'card') {
    const c = cards.find((x) => String(x.id) === String(row.anchor_id));
    box = c ? rectOf(c) : null;
  } else if (row.anchor_kind === 'group') {
    box = groupBox(cards, row.anchor_id);
  }
  if (box) return { x: box.x + box.w + 8 + ox, y: box.y - 8 + oy, ...BUBBLE };
  if (row.anchor_kind === 'point') return { x: (row.anchor_x || 0) + ox, y: (row.anchor_y || 0) + oy, ...BUBBLE };
  if (row.anchor_kind === 'board') return { x: BOARD_SPOT.x + ox, y: BOARD_SPOT.y + oy, ...BUBBLE };
  return null;
}

// The offset a new bubble takes: on a card or a group, the side of it that
// covers least, as the app picks it (lib/commentPlacement.js); on the board as
// a whole, a spot beside everything on it, below the board's other comments.
// `comments` are the board's open, shown, top-level rows.
export function placeComment(anchor, { cards = [], comments = [] } = {}) {
  const placed = comments.map((r) => bubbleRect(r, cards)).filter(Boolean);
  if (anchor.kind === 'card' || anchor.kind === 'group') {
    const target = anchor.kind === 'card'
      ? rectOf(cards.find((c) => String(c.id) === String(anchor.id)) || {})
      : groupBox(cards, anchor.id);
    if (!target) return { x: 0, y: 0 };
    const others = cards
      .filter((c) => anchor.kind === 'group' || String(c.id) !== String(anchor.id))
      .map(rectOf);
    const { offsetX, offsetY } = pickCommentOffset({ target, others, placed });
    return { x: offsetX, y: offsetY };
  }
  if (anchor.kind === 'board') {
    const all = bounds(cards.map(rectOf));
    const before = comments.filter((r) => r.anchor_kind === 'board').length;
    const spot = all
      ? { x: all.x + all.w + BESIDE, y: all.y + before * STACK }
      : { x: BOARD_SPOT.x, y: BOARD_SPOT.y + before * STACK };
    return { x: Math.round(spot.x - BOARD_SPOT.x), y: Math.round(spot.y - BOARD_SPOT.y) };
  }
  return { x: 0, y: 0 };
}
