// Canvas comments, how they work: what a pin says aloud, where an unsent
// comment is filed and found again, which conversation a link names, who "@"
// offers, and the request a comment link leaves for the canvas.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pinLabel, draftTargetId, anchorFromDraftTarget, draftThread, findCommentThread,
  threadAnchor, createCommentUi,
} from './commentPins.js';
import { mentionCandidates } from './commentCardPlace.js';
import {
  commentDraftKey, writeCommentDraft, clearCommentDraft, listCommentDraftTargets,
  COMMENT_DRAFT_MAX_AGE_MS, _resetCommentDraftMemory,
} from './commentDraft.js';
import {
  requestOpenComment, peekOpenComment, takeOpenComment, subscribeOpenComment,
  setCommentBoardSynced, openCommentSynced, ackOpenComment, OPEN_COMMENT_MS,
} from './commentOpen.js';

function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
beforeEach(() => { _resetCommentDraftMemory(); takeOpenComment(peekOpenComment()?.boardId); });

test('a pin says who wrote it, how many replies, and whether it is unread', () => {
  assert.equal(pinLabel(null), 'Comment');
  assert.equal(pinLabel({ root: { authorName: 'Ana' }, replies: [] }), 'Comment by Ana');
  assert.equal(pinLabel({ root: { authorName: 'Ana' }, replies: [{}], unread: false }), 'Comment by Ana, 1 reply');
  assert.equal(
    pinLabel({ root: { authorName: 'Ana' }, replies: [{}, {}, { deleted: true }], unread: true }),
    'Comment by Ana, 2 replies, unread',
  );
  // a stand-in is never put into the sentence: no name, and the reader's own
  assert.equal(pinLabel({ root: {}, replies: [], unread: true }), 'Comment, unread');
  assert.equal(pinLabel({ root: { authorName: 'Someone' }, replies: [{}] }), 'Comment, 1 reply');
  assert.equal(pinLabel({ root: { authorName: 'Member' }, replies: [] }), 'Comment');
  assert.equal(pinLabel({ root: { authorName: 'You' }, replies: [] }), 'Your comment');
  assert.equal(pinLabel({ root: { authorName: 'Ana', authorId: 'me' }, replies: [{}, {}], unread: true }, 'me'), 'Your comment, 2 replies, unread');
  assert.equal(pinLabel({ root: { authorName: 'Ana', authorId: 'ana' }, replies: [] }, 'me'), 'Comment by Ana');
});

test('an unsent comment is filed under what it is on, and found again from that', () => {
  const anchors = [
    { kind: 'card', id: 'c-1' },
    { kind: 'group', id: 'g:with:colons' },
    { kind: 'point', x: -120, y: 48 },
    { kind: 'board' },
  ];
  for (const a of anchors) assert.deepEqual(anchorFromDraftTarget(draftTargetId(a)), a);
  // a point is filed to the whole pixel
  assert.equal(draftTargetId({ kind: 'point', x: 10.4, y: -3.6 }), 'new:point:10:-4');
  assert.equal(draftTargetId(null), 'new');
  // a reply's or an edit's words are not a new comment
  for (const t of ['reply:abc', 'edit:abc', 'new', 'new:point:a:b', '', null]) {
    assert.equal(anchorFromDraftTarget(t), null);
  }
});

test('a draft sits on the canvas where a conversation on the same thing would', () => {
  const cardBox = (id) => (id === 'c-1' ? { x: 10, y: 20, w: 100, h: 50 } : null);
  const onCard = threadAnchor(draftThread({ kind: 'card', id: 'c-1' }), { cardBox });
  assert.equal(onCard.kind, 'card');
  assert.equal(threadAnchor(draftThread({ kind: 'card', id: 'gone' }), { cardBox }), null);
  const atPoint = threadAnchor(draftThread({ kind: 'point', x: 5, y: 6 }), {});
  assert.equal(atPoint.kind, 'point');
  assert.equal(draftThread(null), null);
});

test('kept drafts are listed for one person and one cluster only', () => {
  const storage = fakeStorage();
  const now = 1_800_000_000_000;
  const key = (userId, scope, targetId) => commentDraftKey({ userId, surface: 'canvas', scope, targetId });
  writeCommentDraft(key('me', 'b1', 'new:card:c-1'), { body: 'on a card' }, { storage, now });
  writeCommentDraft(key('me', 'b1', 'new:point:4:-9'), { body: 'at a point' }, { storage, now });
  writeCommentDraft(key('me', 'b1', 'reply:t1'), { body: 'a reply' }, { storage, now });
  writeCommentDraft(key('me', 'b2', 'new:board'), { body: 'another cluster' }, { storage, now });
  writeCommentDraft(key('you', 'b1', 'new:board'), { body: 'someone else' }, { storage, now });
  const mine = listCommentDraftTargets({ userId: 'me', surface: 'canvas', scope: 'b1' }, { storage, now });
  assert.deepEqual(mine, ['new:card:c-1', 'new:point:4:-9', 'reply:t1']);
  assert.deepEqual(mine.map(anchorFromDraftTarget).filter(Boolean), [
    { kind: 'card', id: 'c-1' }, { kind: 'point', x: 4, y: -9 },
  ]);
  // sent or discarded: gone from the list
  clearCommentDraft(key('me', 'b1', 'new:card:c-1'), { storage });
  assert.deepEqual(
    listCommentDraftTargets({ userId: 'me', surface: 'canvas', scope: 'b1' }, { storage, now }),
    ['new:point:4:-9', 'reply:t1'],
  );
  // too old to keep: not offered
  assert.deepEqual(
    listCommentDraftTargets({ userId: 'me', surface: 'canvas', scope: 'b1' }, { storage, now: now + COMMENT_DRAFT_MAX_AGE_MS + 1 }),
    [],
  );
  // a reload: memory is empty, storage still has them
  _resetCommentDraftMemory();
  assert.deepEqual(
    listCommentDraftTargets({ userId: 'me', surface: 'canvas', scope: 'b2' }, { storage, now }),
    ['new:board'],
  );
  // storage that refuses is not an error
  const refusing = { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.deepEqual(listCommentDraftTargets({ userId: 'me', surface: 'canvas', scope: 'b9' }, { storage: refusing, now }), []);
});

test('a comment link names a conversation, or a reply inside one', () => {
  const rows = [
    { id: 'AAAA-1', reply_to: null, anchor_kind: 'card' },
    { id: 'r-1', reply_to: 'AAAA-1', anchor_kind: 'card' },
    { id: 'orphan', reply_to: 'deleted-root', anchor_kind: 'card' },
    { id: 'doc-1', reply_to: null, anchor_kind: 'doc_range' },
  ];
  assert.deepEqual(findCommentThread(rows, 'aaaa-1'), { rootId: 'AAAA-1', rowId: null });
  assert.deepEqual(findCommentThread(rows, 'r-1'), { rootId: 'AAAA-1', rowId: 'r-1' });
  assert.equal(findCommentThread(rows, 'orphan'), null);     // its conversation is gone
  assert.equal(findCommentThread(rows, 'doc-1'), null);      // a doc's thread is not on the canvas
  assert.equal(findCommentThread(rows, 'nope'), null);
  assert.equal(findCommentThread(rows, ''), null);
  assert.equal(findCommentThread(null, 'r-1'), null);
});

test('"@" offers the people who can see the cluster, each once, never me', () => {
  const names = { a: { name: 'Ana' }, b: { name: 'Bo', avatar: 'b.png', color: '#123' }, me: { name: 'Me' }, z: { name: 'Zed' } };
  const out = mentionCandidates({
    members: [{ user_id: 'b' }, { user_id: 'me' }, { user_id: 'a' }],
    shares: [{ user_id: 'a', email: 'ana@example.com' }, { user_id: 's', email: 'sam@example.com' }, { user_id: null, email: 'pending@example.com' }],
    authors: ['z', 'b', 'unknown'],
    meId: 'me',
    nameOf: (id) => names[id] || null,
  });
  assert.deepEqual(out.map((p) => p.id), ['a', 'b', 's', 'z']);
  assert.deepEqual(out.find((p) => p.id === 'b'), { id: 'b', name: 'Bo', avatar: 'b.png', color: '#123' });
  assert.equal(out.find((p) => p.id === 's').name, 'sam');   // no profile: the name part of the address
  assert.deepEqual(mentionCandidates(), []);
});

test('the comment state starts with nothing parked and nothing lit', () => {
  const ui = createCommentUi();
  assert.deepEqual(ui.get().parked, []);
  assert.equal(ui.get().flashRowId, null);
  let n = 0;
  const off = ui.subscribe(() => { n += 1; });
  ui.set({ parked: [{ kind: 'board' }], flashRowId: 'r-1' });
  assert.equal(n, 1);
  assert.deepEqual(ui.get().parked, [{ kind: 'board' }]);
  off();
});

test('a comment link leaves one request, taken once by its own cluster', () => {
  let n = 0;
  const off = subscribeOpenComment(() => { n += 1; });
  requestOpenComment({ boardId: 'b1' });               // no comment: nothing
  assert.equal(peekOpenComment(), null);
  requestOpenComment({ boardId: 'b1', commentId: 'c1' });
  assert.equal(n, 1);
  assert.equal(peekOpenComment().commentId, 'c1');
  assert.equal(takeOpenComment('b2'), null);            // another cluster leaves it
  assert.equal(peekOpenComment().commentId, 'c1');
  assert.equal(takeOpenComment('b1').commentId, 'c1');
  assert.equal(n, 2);
  assert.equal(takeOpenComment('b1'), null);            // once
  off();
});

test('a comment link nobody took is dropped after two minutes', () => {
  requestOpenComment({ boardId: 'b1', commentId: 'c1' }, 1000);
  assert.equal(peekOpenComment(1000 + OPEN_COMMENT_MS).commentId, 'c1');
  assert.equal(peekOpenComment(1001 + OPEN_COMMENT_MS), null);
  requestOpenComment({ boardId: 'b1', commentId: 'c1' }, 1000);
  assert.equal(takeOpenComment('b1', 1001 + OPEN_COMMENT_MS), null, 'not opened on a later visit');
});

test('a comment link knows when its cluster has synced and when its doc has it', () => {
  let n = 0;
  const off = subscribeOpenComment(() => { n += 1; });
  requestOpenComment({ boardId: 'b1', cardId: 'd1', commentId: 'c1' });
  const first = peekOpenComment();
  assert.equal(openCommentSynced(first, null), false);
  assert.equal(openCommentSynced(first, { _soleilRoom: { synced: true } }), true, 'a live, synced room');
  setCommentBoardSynced('b2', true);                    // another cluster: not this request
  assert.equal(peekOpenComment(), first);
  setCommentBoardSynced('b1', true);
  assert.notEqual(peekOpenComment(), first, 'a new object, so its readers run again');
  assert.equal(openCommentSynced(peekOpenComment(), null), true);
  assert.equal(n, 2);
  ackOpenComment('other');
  assert.equal(peekOpenComment().opened, false);
  ackOpenComment('d1');
  assert.equal(peekOpenComment().opened, true);
  ackOpenComment('d1');
  assert.equal(n, 3, 'said once');
  // a request made once the cluster is in starts synced
  requestOpenComment({ boardId: 'b1', commentId: 'c2' });
  assert.equal(peekOpenComment().synced, true);
  setCommentBoardSynced('b1', false);
  setCommentBoardSynced('b2', false);
  assert.equal(peekOpenComment().synced, false);
  takeOpenComment('b1');
  off();
});
