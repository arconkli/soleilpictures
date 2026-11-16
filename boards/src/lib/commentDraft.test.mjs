import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCommentDraft, writeCommentDraft, clearCommentDraft, commentDraftKey, pruneCommentDrafts,
  COMMENT_DRAFT_MAX_AGE_MS, _resetCommentDraftMemory,
} from './commentDraft.js';

function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
const throwing = {
  get length() { throw new Error('denied'); },
  key() { throw new Error('denied'); },
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
  removeItem() { throw new Error('denied'); },
};

beforeEach(() => _resetCommentDraftMemory());

test('a key per person, surface, place and target', () => {
  const k = commentDraftKey({ userId: 'u1', surface: 'canvas', scope: 'board-1', targetId: 'thread-9' });
  assert.equal(k, 'u1.canvas.board-1.thread-9');
  assert.notEqual(k, commentDraftKey({ userId: 'u2', surface: 'canvas', scope: 'board-1', targetId: 'thread-9' }));
  assert.notEqual(k, commentDraftKey({ userId: 'u1', surface: 'doc', scope: 'board-1', targetId: 'thread-9' }));
  assert.notEqual(k, commentDraftKey({ userId: 'u1', surface: 'canvas', scope: 'board-1', targetId: 'new:card-3' }));
  // parts can't run into each other, and nobody signed in still gets a key
  assert.equal(commentDraftKey({ surface: 'file', scope: 'a.b', targetId: 'c' }), 'anon.file.a%2Eb.c');
  assert.equal(commentDraftKey({ userId: 'u', surface: 'note' }), 'u.note.-.-');
});

test('write, read back, clear', () => {
  const storage = fakeStorage();
  const key = commentDraftKey({ userId: 'u', surface: 'canvas', scope: 'b', targetId: 't' });
  assert.equal(readCommentDraft(key, { storage }), null);
  assert.equal(writeCommentDraft(key, { body: 'Try this at dusk? @Mara Okafor', mentions: [{ id: 'm', name: 'Mara Okafor', extra: 1 }, { id: '', name: 'x' }, null] }, { storage, now: 1000 }), true);
  assert.deepEqual(readCommentDraft(key, { storage, now: 2000 }), { body: 'Try this at dusk? @Mara Okafor', mentions: [{ id: 'm', name: 'Mara Okafor' }] });
  // it is in storage, not only in memory
  _resetCommentDraftMemory();
  assert.equal(readCommentDraft(key, { storage, now: 2000 }).body, 'Try this at dusk? @Mara Okafor');
  clearCommentDraft(key, { storage });
  assert.equal(readCommentDraft(key, { storage, now: 2000 }), null);
  assert.equal(storage.length, 0);
});

test('empty words clear the draft', () => {
  const storage = fakeStorage();
  writeCommentDraft('k', { body: 'words' }, { storage });
  assert.equal(writeCommentDraft('k', { body: '   \n' }, { storage }), false);
  assert.equal(readCommentDraft('k', { storage }), null);
  assert.equal(storage.length, 0);
});

test('a draft is kept for two weeks, then dropped', () => {
  const storage = fakeStorage();
  writeCommentDraft('k', { body: 'old words' }, { storage, now: 0 });
  assert.equal(readCommentDraft('k', { storage, now: COMMENT_DRAFT_MAX_AGE_MS }).body, 'old words');
  assert.equal(readCommentDraft('k', { storage, now: COMMENT_DRAFT_MAX_AGE_MS + 1 }), null);
  assert.equal(storage.length, 0, 'reading an expired draft removes it');
});

test('prune drops the old and the unreadable, and nothing else', () => {
  const storage = fakeStorage();
  const now = COMMENT_DRAFT_MAX_AGE_MS * 3;
  writeCommentDraft('old', { body: 'a' }, { storage, now: 0 });
  writeCommentDraft('fresh', { body: 'b' }, { storage, now: now - 1000 });
  storage.setItem('soleil.boards.comment.draft.junk', '{not json');
  storage.setItem('soleil.boards.msg.draft2.conv', JSON.stringify({ body: 'a message draft' }));
  assert.equal(pruneCommentDrafts({ storage, now }), 3);   // old (memory + storage) and junk
  assert.equal(readCommentDraft('fresh', { storage, now }).body, 'b');
  assert.equal(readCommentDraft('old', { storage, now }), null);
  assert.equal(storage.getItem('soleil.boards.comment.draft.junk'), null);
  assert.ok(storage.getItem('soleil.boards.msg.draft2.conv'), 'other stores are left alone');
});

test('storage that throws, or no storage: memory still keeps the words', () => {
  for (const storage of [throwing, null]) {
    _resetCommentDraftMemory();
    assert.equal(writeCommentDraft('k', { body: 'kept anyway', mentions: [{ id: 'a', name: 'Ana' }] }, { storage, now: 5 }), true);
    assert.deepEqual(readCommentDraft('k', { storage, now: 6 }), { body: 'kept anyway', mentions: [{ id: 'a', name: 'Ana' }] });
    assert.doesNotThrow(() => pruneCommentDrafts({ storage, now: 6 }));
    assert.doesNotThrow(() => clearCommentDraft('k', { storage }));
    assert.equal(readCommentDraft('k', { storage, now: 6 }), null);
  }
});

test('unreadable stored values read as no draft', () => {
  const storage = fakeStorage();
  storage.setItem('soleil.boards.comment.draft.k', 'null');
  assert.equal(readCommentDraft('k', { storage }), null);
  storage.setItem('soleil.boards.comment.draft.k', JSON.stringify({ body: 'no timestamp' }));
  assert.equal(readCommentDraft('k', { storage }), null);
  assert.equal(readCommentDraft('', { storage }), null);
  assert.equal(writeCommentDraft('', { body: 'x' }, { storage }), false);
});

test('very long words are cut, not refused', () => {
  const storage = fakeStorage();
  writeCommentDraft('k', { body: 'x'.repeat(20000) }, { storage });
  assert.equal(readCommentDraft('k', { storage }).body.length, 8000);
});
