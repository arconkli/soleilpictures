import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentSeenKey, readCommentSeen, openCommentSeen, markCommentSeen, threadUnread, threadNewest, _resetCommentSeenMemory,
} from './commentSeen.js';

const store = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k), m };
};
const refusing = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
const T0 = Date.parse('2026-11-15T10:00:00Z');
const row = (id, authorId, at, extra) => ({ id, authorId, createdAt: at, deleted: false, ...extra });
const thread = (root, ...replies) => ({ id: root.id, root, replies });

test('the key names the person, the cluster and the card', () => {
  assert.equal(commentSeenKey({ userId: 'u1', boardId: 'b1', cardId: 'c1' }), 'cmt-seen:u1:b1:c1');
  assert.equal(commentSeenKey({ userId: null, boardId: 'b1', cardId: 'c1' }), null);
  assert.equal(commentSeenKey({ userId: 'u1', cardId: null }), null);
});

test('nothing is new on a first visit; what others write after it is', () => {
  _resetCommentSeenMemory();
  const storage = store();
  const key = commentSeenKey({ userId: 'me', boardId: 'b', cardId: 'c' });
  assert.equal(readCommentSeen(key, { storage }), null);
  const old = thread(row('t1', 'rae', T0 - 60000));
  assert.equal(threadUnread(old, readCommentSeen(key, { storage }), 'me'), false, 'no record: nothing is new');
  const rec = openCommentSeen(key, { storage, now: T0 });
  assert.equal(rec.base, new Date(T0).toISOString());
  assert.equal(threadUnread(old, rec, 'me'), false, 'from before the first visit');
  assert.equal(threadUnread(thread(row('t2', 'rae', T0 + 1000)), rec, 'me'), true);
  assert.equal(threadUnread(thread(row('t3', 'me', T0 + 1000)), rec, 'me'), false, 'my own');
  assert.equal(threadUnread(thread(row('t4', 'me', T0 - 5), row('r', 'rae', T0 + 5)), rec, 'me'), true, 'a reply by someone else');
  assert.equal(threadUnread(thread(row('t5', 'rae', T0 + 5, { deleted: true })), rec, 'me'), false, 'a deleted comment');
  // the base is kept, not moved by a later open
  assert.equal(openCommentSeen(key, { storage, now: T0 + 999999 }).base, rec.base);
});

test('opening a thread reads it; a later reply by someone else is new again', () => {
  _resetCommentSeenMemory();
  const storage = store();
  const key = commentSeenKey({ userId: 'me', boardId: 'b', cardId: 'c' });
  openCommentSeen(key, { storage, now: T0 });
  const t = thread(row('t1', 'rae', T0 + 1000));
  let rec = markCommentSeen(key, 't1', { storage, now: T0 + 2000, at: threadNewest(t) });
  assert.equal(threadUnread(t, rec, 'me'), false);
  const more = thread(t.root, row('r1', 'sam', T0 + 3000));
  assert.equal(threadUnread(more, rec, 'me'), true);
  rec = markCommentSeen(key, 't1', { storage, now: T0 + 3500, at: threadNewest(more) });
  assert.equal(threadUnread(more, rec, 'me'), false);
  // never moved back
  const again = markCommentSeen(key, 't1', { storage, now: T0 + 100 });
  assert.equal(again.seen.t1, rec.seen.t1);
  // a slow clock here: read no earlier than the thread's newest row
  const ahead = thread(row('t9', 'rae', T0 + 900000));
  rec = markCommentSeen(key, 't9', { storage, now: T0 + 4000, at: threadNewest(ahead) });
  assert.equal(threadUnread(ahead, rec, 'me'), false);
  assert.deepEqual(JSON.parse(storage.m.get(key)).seen.t9, new Date(T0 + 900000).toISOString());
});

test('storage that refuses falls back to memory; junk in storage reads as nothing', () => {
  _resetCommentSeenMemory();
  const key = commentSeenKey({ userId: 'me', boardId: 'b', cardId: 'c' });
  openCommentSeen(key, { storage: refusing, now: T0 });
  const rec = markCommentSeen(key, 't1', { storage: refusing, now: T0 + 10 });
  assert.ok(rec.seen.t1);
  assert.equal(readCommentSeen(key, { storage: refusing }).seen.t1, rec.seen.t1);
  _resetCommentSeenMemory();
  const storage = store();
  storage.setItem(key, '{not json');
  assert.equal(readCommentSeen(key, { storage }), null);
  storage.setItem(key, JSON.stringify({ base: 'never', seen: { a: 'x' } }));
  assert.equal(readCommentSeen(key, { storage }), null);
});
