// Changing and deleting one comment in a doc's or a note's thread
// (docState.js editComment, deleteCommentReply, undoThreadChange), as
// the shared comment card does it (components/comments/docThreadOps.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as ds from './docState.js';
import { fromDocThread } from './commentModel.js';

const RAE = { author: 'Rae', authorId: 'u-rae' };
const SAM = { author: 'Sam', authorId: 'u-sam' };

function doc() {
  const ydoc = new Y.Doc();
  const scope = { comments: ydoc.getMap('c') };
  const id = ds.addCommentThread(ydoc, { pageId: 'p1', body: 'First', ...RAE, scope });
  return { ydoc, scope, id };
}

test('editing the first comment changes its words and says it was edited', () => {
  const { ydoc, scope, id } = doc();
  assert.equal(ds.editComment(ydoc, id, id, { body: 'First, again', mentions: ['u-sam'] }, scope), true);
  const t = ds.readThread(ydoc, id, scope);
  assert.equal(t.body, 'First, again');
  assert.deepEqual(t.mentions, ['u-sam']);
  assert.equal(t.edited, true);
  assert.ok(Number.isFinite(t.editedAt));
  assert.ok(fromDocThread(t).root.editedAt);
  assert.equal(t.pageId, 'p1', 'the rest of the thread is as it was');
});

test('an edit is filed beside the thread: neither the thread nor a reply is rewritten', () => {
  const { ydoc, scope, id } = doc();
  const r = ds.addCommentReply(ydoc, id, { body: 'one', ...SAM, scope });
  const head = JSON.stringify(scope.comments.get(id));
  const reply = JSON.stringify(scope.comments.get(`${id}~r~${r}`));
  ds.editComment(ydoc, id, id, { body: 'First!', by: 'u-rae' }, scope);
  ds.editComment(ydoc, id, r, { body: 'one!', by: 'u-sam' }, scope);
  ds.editComment(ydoc, id, r, { body: 'one!!', by: 'u-sam' }, scope);
  assert.equal(JSON.stringify(scope.comments.get(id)), head);
  assert.equal(JSON.stringify(scope.comments.get(`${id}~r~${r}`)), reply);
  const t = ds.readThread(ydoc, id, scope);
  assert.equal(t.body, 'First!');
  assert.equal(t.replies[0].body, 'one!!');
  // the reply goes, and the change to its words with it
  ds.deleteCommentReply(ydoc, id, r, scope);
  assert.deepEqual([...scope.comments.keys()].sort(), [id, `${id}~e~${id}`].sort());
});

test('an edit that meets a delete of its thread brings nothing back', () => {
  const a = doc();
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
  const bScope = { comments: b.getMap('c') };
  ds.editComment(a.ydoc, a.id, a.id, { body: 'changed' }, a.scope);
  ds.deleteCommentThread(b, a.id, bScope);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b));
  assert.equal(ds.readThread(a.ydoc, a.id, a.scope), null);
  assert.equal(ds.readThread(b, a.id, bScope), null);
  assert.deepEqual(ds.readComments(b, bScope), []);
});

test('a change to someone else’s words, in another name, is not read', () => {
  const { ydoc, scope, id } = doc();
  scope.comments.set(`${id}~e~${id}`, { kind: 'edit', threadId: id, rowId: id, body: 'not mine', mentions: [], editedAt: 1, by: 'u-sam' });
  assert.equal(ds.readThread(ydoc, id, scope).body, 'First');
});

test('editing a reply filed beside the thread rewrites only that reply', () => {
  const { ydoc, scope, id } = doc();
  const r1 = ds.addCommentReply(ydoc, id, { body: 'one', ...SAM, scope });
  const r2 = ds.addCommentReply(ydoc, id, { body: 'two', ...RAE, scope });
  assert.equal(ds.editComment(ydoc, id, r1, { body: 'one!' }, scope), true);
  const t = ds.readThread(ydoc, id, scope);
  assert.deepEqual(t.replies.map((r) => r.body).sort(), ['one!', 'two']);
  assert.equal(t.replies.find((r) => r.id === r1).edited, true);
  assert.equal(t.replies.find((r) => r.id === r2).edited, undefined);
  assert.equal(t.body, 'First');
});

test('editing a reply written into the thread the old way', () => {
  const { ydoc, scope, id } = doc();
  const r = ds.addCommentReply(ydoc, id, { body: 'old', ...SAM, scope, log: false });
  assert.equal(ds.editComment(ydoc, id, r, { body: 'new' }, scope), true);
  assert.equal(ds.readThread(ydoc, id, scope).replies[0].body, 'new');
});

test('an edit with no words, or of a comment that is not there, does nothing', () => {
  const { ydoc, scope, id } = doc();
  assert.equal(ds.editComment(ydoc, id, id, { body: '   ' }, scope), false);
  assert.equal(ds.editComment(ydoc, id, 'cr_nope', { body: 'x' }, scope), false);
  assert.equal(ds.editComment(ydoc, 'cm_nope', 'cm_nope', { body: 'x' }, scope), false);
  assert.equal(ds.readThread(ydoc, id, scope).body, 'First');
});

test('deleting a reply leaves the rest; Undo puts it back', () => {
  const { ydoc, scope, id } = doc();
  const r1 = ds.addCommentReply(ydoc, id, { body: 'one', ...SAM, scope });
  ds.addCommentReply(ydoc, id, { body: 'two', ...RAE, scope });
  const saved = ds.snapshotThread(ydoc, id, scope);
  assert.equal(ds.deleteCommentReply(ydoc, id, r1, scope), 'reply');
  assert.deepEqual(ds.readThread(ydoc, id, scope).replies.map((r) => r.body), ['two']);
  ds.undoThreadChange(ydoc, saved, ds.snapshotThread(ydoc, id, scope), scope);
  assert.deepEqual(ds.readThread(ydoc, id, scope).replies.map((r) => r.body).sort(), ['one', 'two']);
});

test('Undo takes back only what the undone action did, where nobody wrote since', () => {
  const { ydoc, scope, id } = doc();
  const r1 = ds.addCommentReply(ydoc, id, { body: 'one', ...SAM, scope });
  // a reply is deleted; before Undo someone else replies and resolves
  let before = ds.snapshotThread(ydoc, id, scope);
  ds.deleteCommentReply(ydoc, id, r1, scope);
  let after = ds.snapshotThread(ydoc, id, scope);
  ds.addCommentReply(ydoc, id, { body: 'two', ...RAE, scope });
  ds.resolveComment(ydoc, id, true, scope, { by: 'u-rae' });
  ds.undoThreadChange(ydoc, before, after, scope);
  let t = ds.readThread(ydoc, id, scope);
  assert.deepEqual(t.replies.map((r) => r.body).sort(), ['one', 'two']);
  assert.equal(t.resolved, true, 'their resolve stays');

  // the first comment's words are taken out; someone else then deletes the
  // whole thread: Undo of the first brings nothing back
  before = ds.snapshotThread(ydoc, id, scope);
  assert.equal(ds.deleteCommentReply(ydoc, id, id, scope), 'emptied');
  after = ds.snapshotThread(ydoc, id, scope);
  ds.undoThreadChange(ydoc, before, after, scope);
  assert.equal(ds.readThread(ydoc, id, scope).body, 'First', 'undone while nothing else changed');
  ds.deleteCommentReply(ydoc, id, id, scope);
  after = ds.snapshotThread(ydoc, id, scope);
  ds.editComment(ydoc, id, r1, { body: 'one, edited' }, scope);
  ds.undoThreadChange(ydoc, before, after, scope);
  t = ds.readThread(ydoc, id, scope);
  assert.equal(t.body, 'First');
  assert.equal(t.replies.find((r) => r.id === r1).body, 'one, edited', 'an edit made meanwhile stays');

  // a thread is deleted; someone replied to it just before the Undo
  before = ds.snapshotThread(ydoc, id, scope);
  ds.deleteCommentThread(ydoc, id, scope);
  after = ds.snapshotThread(ydoc, id, scope);
  scope.comments.set(`${id}~r~cr_late`, { kind: 'reply', threadId: id, id: 'cr_late', ts: 5, ...SAM, body: 'late', mentions: [] });
  ds.undoThreadChange(ydoc, before, after, scope);
  t = ds.readThread(ydoc, id, scope);
  assert.equal(t.replies.length, 3);
});

test('deleting the first comment with replies under it keeps its place, without its words', () => {
  const { ydoc, scope, id } = doc();
  const r = ds.addCommentReply(ydoc, id, { body: 'one', ...SAM, scope });
  const saved = ds.snapshotThread(ydoc, id, scope);
  const head = JSON.stringify(scope.comments.get(id));
  assert.equal(ds.deleteCommentReply(ydoc, id, id, scope), 'emptied');
  assert.equal(JSON.stringify(scope.comments.get(id)), head, 'the thread itself is not rewritten');
  const t = ds.readThread(ydoc, id, scope);
  assert.equal(t.deleted, true);
  assert.equal(t.body, '');
  const shaped = fromDocThread(t);
  assert.equal(shaped.root.deleted, true);
  assert.equal(shaped.replies.length, 1);
  assert.equal(ds.editComment(ydoc, id, id, { body: 'back?' }, scope), false, 'a deleted comment is not edited');
  // the last reply goes: nothing is left, so the thread goes
  assert.equal(ds.deleteCommentReply(ydoc, id, r, scope), 'thread');
  assert.equal(ds.readThread(ydoc, id, scope), null);
  // the thread is put back from what was kept
  ds.restoreThread(ydoc, saved, scope);
  const back = ds.readThread(ydoc, id, scope);
  assert.equal(back.body, 'First');
  assert.equal(back.deleted, undefined);
  assert.equal(back.replies.length, 1);
});

test('deleting the first comment of a thread with nothing else deletes the thread', () => {
  const { ydoc, scope, id } = doc();
  ds.resolveComment(ydoc, id, true, scope, { by: 'u-rae' });
  assert.equal(ds.deleteCommentReply(ydoc, id, id, scope), 'thread');
  assert.equal(scope.comments.size, 0, 'its resolved state goes with it');
});

test('deleting an old-way reply rewrites the thread without it', () => {
  const { ydoc, scope, id } = doc();
  const r = ds.addCommentReply(ydoc, id, { body: 'old', ...SAM, scope, log: false });
  assert.equal(ds.deleteCommentReply(ydoc, id, r, scope), 'reply');
  assert.equal(ds.readThread(ydoc, id, scope).replies.length, 0);
  assert.equal(ds.deleteCommentReply(ydoc, id, r, scope), null);
});
