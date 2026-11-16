import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentPowers } from './commentRules.js';

const ana = { id: 'ana' };
const ben = { id: 'ben' };
const row = (over = {}) => ({ id: 'r1', authorId: 'ana', authorName: 'Ana', body: 'hi', mentions: [], createdAt: 1, editedAt: null, deleted: false, ...over });
const thread = (over = {}) => ({ id: 't1', root: row({ id: 't1' }), replies: [], resolved: false, resolvedBy: null, resolvedAt: null, lastActivityAt: 1, ...over });

test('only the author edits the words', () => {
  assert.equal(commentPowers({ me: ana, row: row(), thread: thread(), canRead: true }).edit, true);
  // an editor of the cluster still can't change someone else's words
  assert.equal(commentPowers({ me: ben, row: row(), thread: thread(), canRead: true, canWrite: true }).edit, false);
  assert.equal(commentPowers({ me: ana, row: row({ deleted: true }), thread: thread(), canRead: true, canWrite: true }).edit, false);
  assert.equal(commentPowers({ me: ana, row: row({ authorId: null }), thread: thread(), canRead: true }).edit, false);
});

test('the author deletes their own; an editor deletes anyone\'s', () => {
  assert.equal(commentPowers({ me: ana, row: row(), canRead: true }).delete, true);
  assert.equal(commentPowers({ me: ben, row: row(), canRead: true }).delete, false);
  assert.equal(commentPowers({ me: ben, row: row(), canRead: true, canWrite: true }).delete, true);
  assert.equal(commentPowers({ me: ana, row: row({ deleted: true }), canRead: true, canWrite: true }).delete, false);
});

test('resolve and reopen: an editor, or whoever started the conversation', () => {
  const t = thread();
  assert.equal(commentPowers({ me: ana, thread: t, canRead: true }).resolve, true);
  assert.equal(commentPowers({ me: ben, thread: t, canRead: true }).resolve, false);
  assert.equal(commentPowers({ me: ben, thread: t, canRead: true, canWrite: true }).resolve, true);
  assert.equal(commentPowers({ me: ana, thread: t, canRead: true }).reopen, false);
  const done = thread({ resolved: true });
  assert.equal(commentPowers({ me: ana, thread: done, canRead: true }).reopen, true);
  assert.equal(commentPowers({ me: ana, thread: done, canRead: true }).resolve, false);
  assert.equal(commentPowers({ me: ben, thread: done, canRead: true }).reopen, false);
  // a reply's author who didn't start it gets no say over the thread
  const replied = thread({ replies: [row({ id: 'r2', authorId: 'ben' })] });
  assert.equal(commentPowers({ me: ben, row: replied.replies[0], thread: replied, canRead: true }).resolve, false);
  // no thread yet: nothing to resolve
  assert.equal(commentPowers({ me: ana, canRead: true, canWrite: true }).resolve, false);
});

test('people who can only view may start and reply', () => {
  const p = commentPowers({ me: ben, row: row(), thread: thread(), canRead: true, canWrite: false });
  assert.equal(p.reply, true);
  assert.equal(p.start, true);
  const none = commentPowers({ me: ben, row: row(), thread: thread(), canRead: false });
  assert.equal(none.reply, false);
  assert.equal(none.start, false);
  // a new comment has no thread to reply to
  assert.equal(commentPowers({ me: ben, canRead: true }).reply, false);
  assert.equal(commentPowers({ me: ben, canRead: true }).start, true);
});

test('copy link needs a sent row', () => {
  assert.equal(commentPowers({ me: null, row: row() }).copyLink, true);
  assert.equal(commentPowers({ me: ana, row: row({ pending: true }), canRead: true }).copyLink, false);
  assert.equal(commentPowers({ me: ana, row: row({ failed: true }), canRead: true }).copyLink, false);
  assert.equal(commentPowers({ me: ana, row: row({ id: '' }), canRead: true }).copyLink, false);
  assert.equal(commentPowers({ me: ana, canRead: true }).copyLink, false);
  // a deleted row can still be linked to: its replies stand
  assert.equal(commentPowers({ me: ana, row: row({ deleted: true }) }).copyLink, true);
});

test('a row still sending can be neither edited nor deleted', () => {
  const p = commentPowers({ me: ana, row: row({ pending: true }), thread: thread(), canRead: true, canWrite: true });
  assert.equal(p.edit, false);
  assert.equal(p.delete, false);
});

test('a signed-out viewer of a shared file never edits, deletes or resolves', () => {
  const mine = row({ authorId: null, meta: { mine: true } });
  const t = thread({ root: mine });
  const p = commentPowers({ me: null, row: mine, thread: t, canRead: true, canWrite: true });
  assert.deepEqual(p, { edit: false, delete: false, resolve: false, reopen: false, reply: true, start: true, copyLink: true });
  // and replies only if the surface says so
  assert.equal(commentPowers({ me: null, row: mine, thread: t }).reply, false);
  assert.equal(commentPowers({ me: null, thread: t }).start, false);
});

test('a shared file says "mine" instead of sending author ids', () => {
  const mine = row({ authorId: null, meta: { mine: true } });
  const theirs = row({ id: 'r2', authorId: null, meta: { mine: false } });
  const t = thread({ root: mine, replies: [theirs] });
  const me = { id: 'whoever' };
  assert.equal(commentPowers({ me, row: mine, thread: t, canRead: true }).edit, true);
  assert.equal(commentPowers({ me, row: mine, thread: t, canRead: true }).delete, true);
  // the starter resolves their own file thread
  assert.equal(commentPowers({ me, row: mine, thread: t, canRead: true }).resolve, true);
  assert.equal(commentPowers({ me, row: theirs, thread: t, canRead: true }).edit, false);
  assert.equal(commentPowers({ me, row: theirs, thread: t, canRead: true }).delete, false);
  assert.equal(commentPowers({ me, row: theirs, thread: t, canRead: true, canWrite: true }).delete, true);
});

test('a shared file\'s own answers decide delete and resolve', () => {
  const me = { id: 'whoever' };
  const f = (mine, canDelete, canResolve, over = {}) => row({ authorId: null, meta: { mine, canDelete, canResolve }, ...over });
  // the database says no: canWrite does not overrule it
  const theirs = f(false, false, false);
  const t = thread({ root: theirs });
  let p = commentPowers({ me, row: theirs, thread: t, canRead: true, canWrite: true });
  assert.equal(p.delete, false);
  assert.equal(p.resolve, false);
  assert.equal(p.edit, false);
  // the database says yes: offered without canWrite
  const managed = f(false, true, true);
  p = commentPowers({ me, row: managed, thread: thread({ root: managed }), canRead: true });
  assert.equal(p.delete, true);
  assert.equal(p.resolve, true);
  assert.equal(p.reopen, false);
  p = commentPowers({ me, row: managed, thread: thread({ root: managed, resolved: true }), canRead: true });
  assert.equal(p.resolve, false);
  assert.equal(p.reopen, true);
  // my own row the database won't let me delete stays undeletable, but I still change its words
  const stuck = f(true, false, false);
  p = commentPowers({ me, row: stuck, thread: thread({ root: stuck }), canRead: true });
  assert.equal(p.delete, false);
  assert.equal(p.edit, true);
  // I started it: I resolve and reopen it whatever canResolve says
  assert.equal(p.resolve, true);
  assert.equal(commentPowers({ me, row: stuck, thread: thread({ root: stuck, resolved: true }), canRead: true }).reopen, true);
  // a reply of mine on someone else's thread gives no say over the thread
  const reply = f(true, true, false, { id: 'r2' });
  p = commentPowers({ me, row: reply, thread: thread({ root: theirs, replies: [reply] }), canRead: true });
  assert.equal(p.resolve, false);
  assert.equal(p.delete, true);
  // a reply's canResolve is not the thread's: the root's answer counts
  const eager = f(false, false, true, { id: 'r3' });
  assert.equal(commentPowers({ me, row: eager, thread: thread({ root: theirs, replies: [eager] }), canRead: true }).resolve, false);
  // deleted and unsent rows are still never deleted
  assert.equal(commentPowers({ me, row: f(true, true, true, { deleted: true }), canRead: true }).delete, false);
  assert.equal(commentPowers({ me, row: f(true, true, true, { pending: true }), canRead: true }).delete, false);
  // signed out, the starter rule needs someone: only the database's yes counts
  assert.equal(commentPowers({ me: null, row: stuck, thread: thread({ root: stuck }), canRead: true }).resolve, false);
});

test('no arguments: nothing is allowed', () => {
  assert.deepEqual(commentPowers(), { edit: false, delete: false, resolve: false, reopen: false, reply: false, start: false, copyLink: false });
});

// ── replying to a resolved conversation ──────────────────────────────────
test('the reply box promises a reopen only to someone who may reopen', async () => {
  const { replyHint } = await import('./commentRules.js');
  assert.equal(replyHint({ resolved: true, canReopen: true, hint: ' @ to mention' }), 'Reply to reopen…');
  assert.equal(replyHint({ resolved: true, canReopen: false }), 'Reply…');
  assert.equal(replyHint({ resolved: true, canReopen: false, hint: ' @ to mention' }), 'Reply… @ to mention');
  assert.equal(replyHint({ resolved: false, canReopen: false, hint: ' @ to mention' }), 'Reply… @ to mention');
  assert.equal(replyHint(), 'Reply…');
  // a viewer who did not start it may not reopen; its starter and an editor may
  const t = thread({ resolved: true });
  assert.equal(commentPowers({ me: ben, thread: t, canRead: true }).reopen, false);
  assert.equal(commentPowers({ me: ana, thread: t, canRead: true }).reopen, true);
  assert.equal(commentPowers({ me: ben, thread: t, canRead: true, canWrite: true }).reopen, true);
});

test('after such a reply: still resolved or put away is said, reopened or unknown is not', async () => {
  const { stayedResolved, REPLY_NOT_REOPENED } = await import('./commentRules.js');
  assert.equal(stayedResolved({ id: 't1', resolved: true, hidden: false }), true);
  assert.equal(stayedResolved({ id: 't1', resolved: false, hidden: true }), true, 'the old per-comment Hide');
  assert.equal(stayedResolved({ id: 't1', resolved: false, hidden: false }), false, 'the database reopened it');
  assert.equal(stayedResolved(null), false, 'could not be read: nothing is said');
  // a message descriptor (module scope): read as the toast reads it
  const { i18n } = await import('@lingui/core');
  assert.equal(i18n._(REPLY_NOT_REOPENED), 'Sent. Only an editor or the person who started this can reopen it.');
});
