// apiComments — a board's comment threads as the API lists and writes them.
// The threads inside docs and notes are read from what the editor writes:
// marks put there by y-prosemirror's own writer against the doc editor's REAL
// schema (lib/r2.js stubbed, as in docWrite.test.mjs), threads filed by
// docState's own functions. Then: the board's own rows grouped as the canvas
// groups them, new comments checked and placed as the app places them, and a
// list paged liveliest first.
//
// Run: node --test src/lib/apiComments.test.mjs

import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

registerHooks({
  resolve(specifier, context, next) {
    if (/\/lib\/r2\.js$/.test(specifier)) {
      return { url: 'data:text/javascript,export const resolveSrc=(s)=>s;export const getSignedUrl=async()=>null;', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { getSchema } = await import('@tiptap/core');
const { prosemirrorJSONToYXmlFragment } = await import('y-prosemirror');
const { baseDocExtensions } = await import('../components/docExtensions/baseExtensions.js');
const {
  COMMENTS, boardThreads, cardThreads, collectQuotes, namesFrom, authorIds, pageThreads, publicThread,
  readNewComment, anchorOf, commentRow, placeComment, isBoardCommentId, readResolveMany, findCardThread, docAuthor,
} = await import('./apiComments.js');
const { pickPresenceColor } = await import('./presenceColor.js');
const {
  cardScope, initCardDocStore, addPage, pageContentMap, addCommentThread, addCommentReply, resolveComment,
} = await import('./docState.js');
const { pickCommentOffset } = await import('./commentPlacement.js');
const { emailToName } = await import('./personName.js');
const { readCards, cardToYMap } = await import('./yhelpers.js');
const { TOOLS } = await import('./mcpTools.js');

const schema = getSchema(baseDocExtensions);
const commented = (text, ...ids) => ({ type: 'text', text, marks: ids.map((id) => ({ type: 'comment', attrs: { id } })) });

// A board with a doc whose first page carries two threads (one spanning two
// paragraphs, one overlapping it), and a note with one of its own.
function board() {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  ydoc.transact(() => {
    cards.set('d1', cardToYMap({ id: 'd1', kind: 'doc', title: 'Treatment', x: 0, y: 0, w: 320, h: 240 }));
    cards.set('n1', cardToYMap({ id: 'n1', kind: 'note', title: '', x: 400, y: 0, w: 200, h: 120 }));
  });
  const doc = cards.get('d1');
  initCardDocStore(ydoc, doc);
  const scope = cardScope(doc);
  const p1 = addPage(ydoc, { name: 'Opening', scope });
  addPage(ydoc, { name: 'Close', scope });
  const t1 = addCommentThread(ydoc, { pageId: p1, body: 'Too slow?', author: 'Sam Park', authorId: 'u2', scope });
  const t2 = addCommentThread(ydoc, { pageId: p1, body: 'Love this', author: 'Ana', authorId: 'u1', scope });
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A diner ' }, commented('at night,', t1), commented(' rain', t1, t2)] },
      { type: 'paragraph', content: [commented('on the glass.', t1)] },
    ],
  }, pageContentMap(ydoc, scope).get(p1));
  addCommentReply(ydoc, t1, { body: 'Cut the first beat', author: 'Ana', authorId: 'u1', scope });
  resolveComment(ydoc, t2, true, scope, { by: 'u1' });

  const note = cards.get('n1');
  const frag = new Y.XmlFragment();
  const comments = new Y.Map();
  ydoc.transact(() => { note.set('noteFragment', frag); note.set('docComments', comments); });
  const t3 = addCommentThread(ydoc, { body: 'Which rooftop?', author: 'Sam Park', authorId: 'u2', scope: { comments } });
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scout ' }, commented('the rooftops', t3)] }],
  }, frag);
  return { ydoc, p1, t1, t2, t3 };
}

test('threads inside docs and notes: the text they are on, their replies, and whether resolved', () => {
  const { ydoc, p1, t1, t2, t3 } = board();
  const threads = cardThreads(readCards(ydoc));
  const by = new Map(threads.map((t) => [t.id, t]));
  assert.equal(threads.length, 3);

  const a = by.get(t1);
  assert.equal(a.on, 'doc');
  assert.equal(a.card_id, 'd1');
  assert.equal(a.page_id, p1);
  assert.equal(a.page_title, 'Opening');
  assert.equal(a.quote, 'at night, rain on the glass.', 'runs in one block join as written; blocks a space apart');
  assert.equal(a.author_id, 'u2');
  assert.equal(a.author_name, 'Sam Park');
  assert.equal(a.resolved, false);
  assert.deepEqual(a.replies.map((r) => [r.body, r.author_id]), [['Cut the first beat', 'u1']]);
  assert.match(a.created_at, /^\d{4}-\d\d-\d\dT/);

  assert.equal(by.get(t2).quote, ' rain', 'an overlapping comment mark is read under its own id');
  assert.equal(by.get(t2).resolved, true, 'resolved as filed beside the thread');

  const n = by.get(t3);
  assert.equal(n.on, 'note');
  assert.equal(n.card_id, 'n1');
  assert.equal(n.page_id, null);
  assert.equal(n.quote, 'the rooftops');
});

test('quotes come from y-prosemirror\'s own marks, hashed names and all', () => {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('f');
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc', content: [{ type: 'paragraph', content: [commented('both', 'cm_a', 'cm_b'), commented(' one', 'cm_a')] }],
  }, frag);
  const keys = Object.keys(frag.get(0).get(0).toDelta()[0].attributes);
  assert.ok(keys.every((k) => /^comment--/.test(k)), `overlapping marks are stored hashed: ${keys}`);
  assert.deepEqual([...collectQuotes(frag)], [['cm_a', 'both one'], ['cm_b', 'both']]);
  assert.deepEqual([...collectQuotes(null)], []);
});

test('a doc comment is cut where the API stops taking one', () => {
  const ydoc = new Y.Doc();
  const comments = ydoc.getMap('c');
  const id = addCommentThread(ydoc, { body: 'x'.repeat(COMMENTS.maxBody + 500), scope: { comments } });
  assert.equal(comments.get(id).body.length, COMMENTS.maxBody, 'docState.addCommentThread and COMMENTS.maxBody agree');
  assert.match(readNewComment({ body: 'x'.repeat(COMMENTS.maxBody + 1) }).problem, /at most/);
  assert.equal(readNewComment({ body: 'x'.repeat(COMMENTS.maxBody) }).body.length, COMMENTS.maxBody);
});

test('the board\'s own rows: threads with their replies, a reply without its thread dropped', () => {
  const rows = [
    { id: 'r1', anchor_kind: 'card', anchor_id: 'c1', author: 'u1', body: 'Too dark', created_at: '2026-10-20T10:00:00Z' },
    { id: 'r2', reply_to: 'r1', author: 'u2', body: 'Agreed', created_at: '2026-10-21T10:00:00Z' },
    { id: 'r3', anchor_kind: 'point', anchor_x: 40, anchor_y: -8, author: 'u2', body: 'Space for titles', resolved: true, hidden: true, created_at: '2026-10-19T10:00:00Z' },
    { id: 'r4', reply_to: 'gone', author: 'u2', body: 'orphan', created_at: '2026-10-22T10:00:00Z' },
    { id: 'r5', anchor_kind: 'doc_range', anchor_id: 'd1', doc_page_id: 'p1', author: null, body: 'old', created_at: '2026-01-01T00:00:00Z' },
  ];
  const [a, b, c] = boardThreads(rows);
  assert.equal(a.on, 'card');
  assert.equal(a.card_id, 'c1');
  assert.deepEqual(a.replies.map((r) => r.id), ['r2']);
  assert.deepEqual([b.on, b.x, b.y, b.resolved, b.hidden], ['point', 40, -8, true, true]);
  assert.deepEqual([c.on, c.card_id, c.page_id], ['doc', 'd1', 'p1'], 'a row from before doc comments moved reads as the doc\'s');
  assert.equal(boardThreads(rows).length, 3);
  assert.deepEqual(authorIds([{ author_id: '11111111-1111-4111-8111-111111111111', replies: [{ author_id: 'not-a-uuid' }] }]),
    ['11111111-1111-4111-8111-111111111111'], 'only real ids go to the lookup');
});

test('a list: liveliest first, by status, paged, counted', () => {
  const t = (id, created, { resolved = false, replies = [] } = {}) => ({
    id, created_at: created, resolved, replies: replies.map((r) => ({ created_at: r })),
  });
  const all = [
    t('old-but-busy', '2026-10-01T00:00:00Z', { replies: ['2026-10-24T00:00:00Z'] }),
    t('new', '2026-10-23T00:00:00Z'),
    t('done', '2026-10-25T00:00:00Z', { resolved: true }),
    t('older', '2026-10-02T00:00:00Z'),
  ];
  const open = pageThreads(all);
  assert.deepEqual(open.page.map((x) => x.id), ['old-but-busy', 'new', 'older'], 'a new reply brings a thread up');
  assert.deepEqual(open.counts, { open: 3, resolved: 1 });
  assert.deepEqual(pageThreads(all, { status: 'resolved' }).page.map((x) => x.id), ['done']);
  const first = pageThreads(all, { status: 'all', limit: 2 });
  assert.deepEqual([first.page.map((x) => x.id), first.hasMore], [['done', 'old-but-busy'], true]);
  const rest = pageThreads(all, { status: 'all', limit: 2, offset: 2 });
  assert.deepEqual([rest.page.map((x) => x.id), rest.hasMore], [['new', 'older'], false]);
});

test('a thread handed out: only the fields where it is, names as the app shows them', () => {
  const names = namesFrom(
    [{ user_id: 'u1', display_name: 'Ana Ruiz' }, { user_id: 'u3', display_name: '' }],
    [{ user_id: 'u1', email: 'ana@x.com' }, { user_id: 'u2', email: 'sam.park42@x.com' }, { user_id: 'u3', email: 'jo@x.com' }],
  );
  assert.deepEqual([...names], [['u1', 'Ana Ruiz'], ['u2', 'Sam Park'], ['u3', 'Jo']]);
  assert.equal(emailToName('sam.park42@x.com'), 'Sam Park');

  const [row] = boardThreads([{ id: 'r1', anchor_kind: 'card', anchor_id: 'c1', author: 'u1', body: 'Too dark', created_at: 'x' },
    { id: 'r2', reply_to: 'r1', author: 'u9', body: 'Who am I', created_at: 'y' }]);
  const out = publicThread(row, { names, userId: 'u1', cards: new Map([['c1', { kind: 'image', title: 'Hero' }]]), url: 'https://l' });
  assert.deepEqual(out, {
    id: 'r1', on: 'card', card_id: 'c1', card_kind: 'image', card_title: 'Hero',
    body: 'Too dark', author_id: 'u1', author_name: 'Ana Ruiz', by_you: true, created_at: 'x', resolved: false,
    replies: [{ id: 'r2', body: 'Who am I', author_id: 'u9', author_name: 'Member', by_you: false, created_at: 'y' }],
    url: 'https://l',
  });
  const doc = publicThread({ id: 'cm_1', on: 'doc', card_id: 'd1', page_id: 'p1', page_title: 'Opening',
    quote: 'q'.repeat(COMMENTS.maxQuote + 9), body: 'b', author_id: null, author_name: 'Sam (old build)',
    created_at: null, resolved: false, hidden: false, replies: [] });
  assert.equal(doc.quote.length, COMMENTS.maxQuote + 1, 'a long quote is cut, and says so');
  assert.equal(doc.author_name, 'Sam (old build)', 'a thread\'s own name when nobody can be looked up');
  assert.ok(!('x' in doc) && !('group_id' in doc) && !('hidden' in doc));
  const pt = publicThread({ ...boardThreads([{ id: 'p', anchor_kind: 'point', anchor_x: 1, anchor_y: 2, hidden: true, body: '' }])[0] });
  assert.deepEqual([pt.x, pt.y, pt.hidden, 'card_id' in pt], [1, 2, true, false]);
});

test('a new comment: checked, and where it goes', () => {
  const problem = (b) => readNewComment(b).problem;
  assert.match(problem(null), /JSON object/);
  assert.match(problem({ body: '   ' }), /body is required/);
  assert.match(problem({ body: 'hi', card_id: 'c1', x: 1, y: 2 }), /one of card_id/);
  assert.match(problem({ body: 'hi', x: 1 }), /x and y go together/);
  assert.match(problem({ body: 'hi', x: 2e9, y: 0 }), /within/);
  assert.match(problem({ body: 'hi', reply_to: 'r1', card_id: 'c1' }), /a reply sits with its thread/);
  assert.match(problem({ body: 'hi', card_id: 7 }), /card_id must be an id/);
  assert.deepEqual(readNewComment({ body: ' hi ' }), { body: 'hi', anchor: { kind: 'board' } });
  assert.deepEqual(readNewComment({ body: 'hi', x: 10.4, y: -3.6 }).anchor, { kind: 'point', x: 10, y: -4 });
  assert.deepEqual(readNewComment({ body: 'hi', reply_to: 'r1' }), { body: 'hi', replyTo: 'r1' });

  // On words in a doc: the doc's card, the words, and the page if need be.
  assert.deepEqual(readNewComment({ body: 'hi', card_id: 'd1', quote: 'at night', page_id: 'p1' }).anchor,
    { kind: 'doc', id: 'd1', quote: 'at night', pageId: 'p1' });
  assert.deepEqual(readNewComment({ body: 'hi', card_id: 'd1', quote: 'at night' }).anchor,
    { kind: 'doc', id: 'd1', quote: 'at night', pageId: null });
  assert.match(problem({ body: 'hi', quote: 'at night' }), /quote goes with card_id/);
  assert.match(problem({ body: 'hi', group_id: 'g1', quote: 'at night' }), /quote goes with card_id/);
  assert.match(problem({ body: 'hi', card_id: 'd1', page_id: 'p1' }), /page_id goes with quote/);
  assert.match(problem({ body: 'hi', card_id: 'd1', quote: '  ' }), /quote must be the words/);
  assert.match(problem({ body: 'hi', card_id: 'd1', quote: 'x'.repeat(COMMENTS.maxAnchor + 1) }), /at most/);
  assert.match(problem({ body: 'hi', reply_to: 'cm_1', quote: 'x' }), /a reply sits with its thread/);

  // A reply goes where its thread is, as CanvasComment's parentAnchor has it.
  assert.deepEqual(anchorOf({ anchor_kind: 'point', anchor_x: 5, anchor_y: 6 }), { kind: 'point', x: 5, y: 6 });
  assert.deepEqual(anchorOf({ anchor_kind: 'doc_range', anchor_id: 'd1' }), { kind: 'card', id: 'd1' });
  assert.deepEqual(commentRow({ workspaceId: 'w', boardId: 'b', author: 'u1', body: 'hi',
    anchor: { kind: 'group', id: 'g1' }, offset: { x: 12.6, y: -4 } }), {
    workspace_id: 'w', board_id: 'b', author: 'u1', body: 'hi', reply_to: null, anchor_kind: 'group',
    anchor_id: 'g1', anchor_x: null, anchor_y: null, doc_page_id: null, doc_from: null, doc_to: null,
    offset_x: 13, offset_y: -4,
  });
  assert.ok(isBoardCommentId('11111111-1111-4111-8111-111111111111') && !isBoardCommentId('cm_abc'));
});

test('placed as the app places one: beside its card where it covers least; on the board, beside it all', () => {
  const cards = [
    { id: 'c1', x: 0, y: 0, w: 200, h: 200, groupId: 'g1' },
    { id: 'c2', x: 212, y: -20, w: 300, h: 300, groupId: 'g1' },
    { id: 'c3', x: 0, y: 600, w: 100, h: 100 },
  ];
  const off = placeComment({ kind: 'card', id: 'c1' }, { cards });
  const want = pickCommentOffset({ target: { x: 0, y: 0, w: 200, h: 200 }, others: cards.slice(1).map(({ x, y, w, h }) => ({ x, y, w, h })), placed: [] });
  assert.deepEqual(off, { x: want.offsetX, y: want.offsetY });
  assert.notDeepEqual(off, { x: 0, y: 0 }, 'its neighbour on the right is avoided');
  const group = placeComment({ kind: 'group', id: 'g1' }, { cards });
  const wantGroup = pickCommentOffset({ target: { x: 0, y: -20, w: 512, h: 300 },
    others: cards.map(({ x, y, w, h }) => ({ x, y, w, h })), placed: [] });
  assert.deepEqual(group, { x: wantGroup.offsetX, y: wantGroup.offsetY }, 'a group by the box round its cards');
  assert.deepEqual(placeComment({ kind: 'group', id: 'nobody' }, { cards }), { x: 0, y: 0 });
  assert.deepEqual(placeComment({ kind: 'point', x: 5, y: 5 }, { cards }), { x: 0, y: 0 });

  // The canvas draws a board-wide comment at (100, 100) plus its offset.
  const first = placeComment({ kind: 'board' }, { cards });
  assert.deepEqual([100 + first.x, 100 + first.y], [512 + 48, -20]);
  const second = placeComment({ kind: 'board' }, { cards, comments: [{ anchor_kind: 'board', offset_x: first.x, offset_y: first.y }] });
  assert.deepEqual([100 + second.x, 100 + second.y], [560, -20 + 96], 'the next one goes below');
  assert.deepEqual(placeComment({ kind: 'board' }, {}), { x: 0, y: 0 }, 'an empty board: where the canvas puts it');
});

test('resolving several: checked before anything is touched', () => {
  const problem = (b) => readResolveMany(b).problem;
  assert.deepEqual(readResolveMany({ comment_ids: ['a', 'b', 'a'], resolved: false }), { ids: ['a', 'b'], resolved: false });
  assert.match(problem({ comment_ids: ['a'] }), /resolved must be/);
  assert.match(problem({ comment_ids: [], resolved: true }), /comment_ids must list/);
  assert.match(problem({ comment_ids: ['a', 7], resolved: true }), /must be comment ids/);
  assert.match(problem({ comment_ids: Array(COMMENTS.maxResolve + 1).fill('a'), resolved: true }), /at most/);
  assert.match(problem({ comment_ids: ['a'], resolved: true, body: 'x' }), /body isn't taken/);
});

test('a thread inside a doc or a note, found by its id or a reply\'s', () => {
  const { ydoc, t1, t3 } = board();
  const cards = ydoc.getMap('cards');
  const a = findCardThread(cards, t1);
  assert.deepEqual([a.cardId, a.kind, a.thread.id, a.replyId], ['d1', 'doc', t1, undefined]);
  const replyId = a.thread.replies[0].id;
  const r = findCardThread(cards, replyId);
  assert.deepEqual([r.cardId, r.thread.id, r.replyId], ['d1', t1, replyId]);
  assert.equal(findCardThread(cards, t3).kind, 'note');
  assert.equal(findCardThread(cards, 'cm_nope'), null);
  assert.equal(findCardThread(cards, `${t1}~s`), null, 'an entry\'s key is no thread');
  assert.equal(findCardThread(cards, '11111111-1111-4111-8111-111111111111'), null);
});

test('who a comment written in a doc is filed as: as the app files its person', () => {
  assert.deepEqual(docAuthor({ profile: { display_name: 'Ana Ruiz', color: '#123456' }, email: 'ana@x.com', userId: 'u1' }),
    { name: 'Ana Ruiz', color: '#123456' });
  assert.deepEqual(docAuthor({ profile: null, email: 'sam.park@x.com', userId: 'u2' }),
    { name: 'Sam Park', color: pickPresenceColor('u2') });
  assert.equal(docAuthor({ userId: 'u3' }).name, 'Member');
});

test('the MCP tools\' limits are the API\'s', () => {
  const tool = (n) => TOOLS.find((t) => t.name === n).inputSchema.properties;
  assert.equal(tool('add_comment').body.maxLength, COMMENTS.maxBody);
  assert.equal(tool('add_comment').quote.maxLength, COMMENTS.maxAnchor);
  assert.equal(tool('list_comments').limit.maximum, COMMENTS.maxLimit);
  assert.equal(tool('resolve_comments').comment_ids.maxItems, COMMENTS.maxResolve);
});
