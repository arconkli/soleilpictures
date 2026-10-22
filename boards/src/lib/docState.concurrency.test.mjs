// A doc's comments with several people in it at once. A reply and a resolve
// are each an entry of their own in docComments (docState.js, "Comments"),
// filed beside the thread instead of rewriting it, so two people writing at
// the same moment both keep what they wrote, on every device, whatever order
// the devices hear each other in. Tabs still on a build from before (`old`
// below: the helpers as those builds run them) neither trip over the new
// entries nor hide them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import * as ds from './docState.js';

const CARD = 'doc-1';
const RAE = { author: 'Rae', authorId: 'u-rae', authorColor: '#e5484d' };
const SAM = { author: 'Sam', authorId: 'u-sam', authorColor: '#2fb67c' };
const TOM = { author: 'Tom', authorId: 'u-tom', authorColor: '#4f8df8' };

// Writes are stamped with Date.now(): make it tick, so "which came last" is
// never a tie and never depends on how fast the machine is.
function tick(t) {
  let now = 1_760_000_000_000;
  t.mock.method(Date, 'now', () => (now += 1000));
}

// n devices on one doc card, in sync, each with a fixed client id so that two
// writes to the same key always break their tie the same way.
function devices(n) {
  const seed = new Y.Doc();
  seed.clientID = 99;
  const card = new Y.Map();
  seed.transact(() => seed.getMap('cards').set(CARD, card));
  ds.initCardDocStore(seed, card);
  const pageId = ds.addPage(seed, { name: 'One', scope: ds.cardScope(card) });
  const base = Y.encodeStateAsUpdate(seed);
  const docs = Array.from({ length: n }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    Y.applyUpdate(d, base);
    return d;
  });
  return { docs, pageId };
}
const scopeOf = (d) => ds.cardScope(d.getMap('cards').get(CARD));
const mapOf = (d) => scopeOf(d).comments;
const thread = (d, id) => ds.readThread(d, id, scopeOf(d));
const bodies = (t) => t.replies.map((r) => r.body);

// Every device hears every other, in the order given.
function sync(...docs) {
  for (const a of docs) {
    for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  }
}

function start(d, pageId, body = 'Is this the opening?') {
  return ds.addCommentThread(d, { pageId, body, ...RAE, scope: scopeOf(d) });
}
const reply = (d, id, body, who, extra = {}) => ds.addCommentReply(d, id, { body, ...who, scope: scopeOf(d), ...extra });
const resolve = (d, id, resolved, who, extra = {}) => ds.resolveComment(d, id, resolved, scopeOf(d), { by: who.authorId, ...extra });
const LOG = { log: true };

// The comment helpers and readers as tabs built before this change run them
// (docState.js, CommentGutter.jsx and CommentInlinePopover.jsx at 2cf313a1).
const old = {
  reply(ydoc, id, { body, author, authorId }) {
    const map = mapOf(ydoc);
    const cur = map?.get(id); if (!cur) return;
    const r = { id: 'cr_' + Math.random().toString(36).slice(2, 8), ts: Date.now(), author, authorId, authorColor: '#4f8df8', body, mentions: [] };
    ydoc.transact(() => { map.set(id, { ...cur, replies: [...(cur.replies || []), r] }); }, ds.DOC_ORIGIN);
  },
  resolve(ydoc, id, resolved = true) {
    const map = mapOf(ydoc);
    const cur = map?.get(id); if (!cur) return;
    ydoc.transact(() => { map.set(id, { ...cur, resolved }); }, ds.DOC_ORIGIN);
  },
  // The threads the gutter draws a dot for.
  dots(ydoc, pageId) {
    const out = [];
    mapOf(ydoc).forEach((v, id) => {
      if (!v) return;
      const get = (k) => v?.get?.(k) ?? v?.[k];
      if (get('pageId') === pageId && !(get('resolved') || false)) out.push(id);
    });
    return out;
  },
  // What the popover shows for a thread.
  popover(ydoc, id) {
    const v = mapOf(ydoc).get(id);
    if (!v) return null;
    const get = (k) => v?.get?.(k) ?? v?.[k];
    const repliesY = get('replies');
    return {
      body: get('body'),
      resolved: get('resolved') || false,
      replies: repliesY?.toArray ? repliesY.toArray() : (Array.isArray(repliesY) ? repliesY : []),
    };
  },
};

test('two people replying at once both keep their reply, on every device', (t) => {
  tick(t);
  const { docs: [a, b, c], pageId } = devices(3);
  const id = start(a, pageId);
  sync(a, b, c);
  reply(a, id, 'Yes, keep it', SAM, LOG);
  reply(b, id, 'Cut it', TOM, LOG);
  reply(c, id, 'Shorter', RAE, LOG);
  // Heard in different orders on different devices.
  sync(c, b);
  sync(b, a);
  sync(a, c);
  for (const d of [a, b, c]) {
    assert.deepEqual(bodies(thread(d, id)), ['Yes, keep it', 'Cut it', 'Shorter'], 'oldest first, all three');
  }
});

test('the old way, one rewrite of the whole thread per reply, loses one of two', (t) => {
  // Why a reply is an entry of its own: this is the bug.
  tick(t);
  const { docs: [a, b], pageId } = devices(2);
  const id = start(a, pageId);
  sync(a, b);
  old.reply(a, id, { body: 'Yes, keep it', ...SAM });
  old.reply(b, id, { body: 'Cut it', ...TOM });
  sync(a, b);
  assert.equal(old.popover(a, id).replies.length, 1);
});

test('a reply racing a resolve keeps both', (t) => {
  tick(t);
  const { docs: [a, b], pageId } = devices(2);
  const id = start(a, pageId);
  sync(a, b);
  reply(a, id, 'Done, see page two', SAM, LOG);
  resolve(b, id, true, RAE, LOG);
  sync(b, a);
  for (const d of [a, b]) {
    const th = thread(d, id);
    assert.deepEqual(bodies(th), ['Done, see page two']);
    assert.equal(th.resolved, true);
  }
});

test('resolving and reopening: the last word counts, and everyone agrees on it', (t) => {
  tick(t);
  const { docs: [a, b], pageId } = devices(2);
  const id = start(a, pageId);
  sync(a, b);
  resolve(a, id, true, RAE, LOG);
  sync(a, b);
  assert.equal(thread(b, id).resolved, true);
  resolve(b, id, false, SAM, LOG);
  sync(a, b);
  assert.equal(thread(a, id).resolved, false, 'reopened');
  // At the same moment, one says resolved and one says open: one answer, everywhere.
  resolve(a, id, true, RAE, LOG);
  resolve(b, id, false, SAM, LOG);
  sync(a, b);
  assert.equal(thread(a, id).resolved, thread(b, id).resolved);
});

test('an old tab’s reply and a new one, to the same thread at once, both show', (t) => {
  tick(t);
  const { docs: [a, o], pageId } = devices(2);
  const id = start(a, pageId);
  sync(a, o);
  reply(a, id, 'From the new tab', SAM, LOG);
  old.reply(o, id, { body: 'From the old tab', ...TOM });
  sync(a, o);
  for (const d of [a, o]) assert.deepEqual(bodies(thread(d, id)), ['From the new tab', 'From the old tab']);
  // The old tab itself can't see a reply filed beside the thread: that is
  // why those are written only once such tabs are made to reload (phase 2).
  assert.deepEqual(old.popover(o, id).replies.map((r) => r.body), ['From the old tab']);
});

test('a resolve or a reopen in an old tab counts after a new one, and the other way round', (t) => {
  tick(t);
  const { docs: [a, o], pageId } = devices(2);
  const id = start(a, pageId);
  sync(a, o);
  old.resolve(o, id, true);
  sync(a, o);
  assert.equal(thread(a, id).resolved, true, 'the old tab resolved it');
  resolve(a, id, false, RAE, LOG);
  sync(a, o);
  assert.equal(thread(a, id).resolved, false, 'a new tab reopened it');
  assert.equal(old.popover(o, id).resolved, true, 'which the old tab can’t see,');
  old.resolve(o, id, false);
  sync(a, o);
  assert.equal(thread(a, id).resolved, false, 'so its reopen agrees');
  resolve(a, id, true, RAE, LOG);
  sync(a, o);
  assert.equal(thread(a, id).resolved, true, 'resolved again in a new tab');
  assert.equal(old.popover(o, id).resolved, false);
  old.resolve(o, id, true);
  sync(a, o);
  assert.equal(thread(a, id).resolved, true);
});

test('a tab that still writes resolves into the thread and one that files them beside it agree', (t) => {
  // Between the two promotes, builds with these readers still write the old
  // way (COMMENT_LOG_WRITES off) while newer ones file entries: a resolve the
  // old way also says so in the entry, once there is one, or the entry would
  // outrank it.
  tick(t);
  const { docs: [p1, p2], pageId } = devices(2);
  const id = start(p1, pageId);
  sync(p1, p2);
  resolve(p1, id, true, RAE, { log: false });
  sync(p1, p2);
  resolve(p2, id, false, SAM, LOG);
  sync(p1, p2);
  assert.equal(thread(p1, id).resolved, false);
  resolve(p1, id, true, RAE, { log: false });
  sync(p1, p2);
  assert.equal(thread(p2, id).resolved, true, 'the old-way resolve counts');
  resolve(p2, id, false, SAM, LOG);
  sync(p1, p2);
  assert.equal(thread(p1, id).resolved, false);
});

test('old tabs draw no extra dots and show the thread as it was started', (t) => {
  tick(t);
  const { docs: [a, o], pageId } = devices(2);
  const id = start(a, pageId);
  reply(a, id, 'One', SAM, LOG);
  reply(a, id, 'Two', TOM, LOG);
  resolve(a, id, false, SAM, LOG);
  sync(a, o);
  assert.deepEqual(old.dots(o, pageId), [id], 'one dot, the thread’s');
  const shown = old.popover(o, id);
  assert.equal(shown.body, 'Is this the opening?');
  assert.deepEqual(shown.replies, []);
});

test('deleting a thread takes every entry with it, and one undo brings all of it back', (t) => {
  tick(t);
  const { docs: [a], pageId } = devices(1);
  const id = start(a, pageId);
  reply(a, id, 'One', SAM, LOG);
  reply(a, id, 'Two', TOM, LOG);
  resolve(a, id, true, RAE, LOG);
  const before = thread(a, id);
  const um = ds.getDocUndoManager(a, scopeOf(a));
  um.stopCapturing();
  ds.deleteCommentThread(a, id, scopeOf(a));
  assert.equal(thread(a, id), null);
  assert.deepEqual([...mapOf(a).keys()], [], 'nothing of it left behind');
  assert.deepEqual(ds.readComments(a, scopeOf(a)), []);
  um.undo();
  assert.deepEqual(thread(a, id), before);
});

test('a reply that landed while its thread was being deleted comes back with the undo', (t) => {
  tick(t);
  const { docs: [a, b], pageId } = devices(2);
  const id = start(a, pageId);
  reply(a, id, 'One', SAM, LOG);
  sync(a, b);
  const um = ds.getDocUndoManager(a, scopeOf(a));
  um.stopCapturing();
  ds.deleteCommentThread(a, id, scopeOf(a));
  reply(b, id, 'Two, written as it went', TOM, LOG);
  sync(a, b);
  for (const d of [a, b]) assert.equal(thread(d, id), null, 'a deleted thread stays deleted');
  um.undo();
  sync(a, b);
  for (const d of [a, b]) assert.deepEqual(bodies(thread(d, id)), ['One', 'Two, written as it went']);
});

test('deleting a page deletes its threads with their replies and state, and the undo restores them', (t) => {
  tick(t);
  const { docs: [a], pageId } = devices(1);
  const p2 = ds.addPage(a, { name: 'Two', scope: scopeOf(a) });
  const keep = start(a, pageId, 'On page one');
  const gone = start(a, p2, 'On page two');
  reply(a, gone, 'A reply', SAM, LOG);
  resolve(a, gone, true, SAM, LOG);
  reply(a, keep, 'Stays', TOM, LOG);
  const before = thread(a, gone);
  const um = ds.getDocUndoManager(a, scopeOf(a));
  um.stopCapturing();
  ds.deletePage(a, p2, scopeOf(a));
  assert.equal(thread(a, gone), null);
  assert.ok([...mapOf(a).keys()].every((k) => !k.startsWith(gone)), 'none of its entries left');
  assert.deepEqual(bodies(thread(a, keep)), ['Stays'], 'the other page’s thread untouched');
  um.undo();
  assert.deepEqual(thread(a, gone), before);
});

test('a note’s thread, which has no undo manager, comes back whole from its snapshot', (t) => {
  tick(t);
  const d = new Y.Doc();
  const note = new Y.Map();
  d.transact(() => { d.getMap('cards').set('note-1', note); note.set('docComments', new Y.Map()); });
  const scope = { comments: note.get('docComments') };
  const id = ds.addCommentThread(d, { pageId: 'note', body: 'Typo here', ...RAE, scope });
  ds.addCommentReply(d, id, { body: 'Fixed', ...SAM, scope, log: true });
  ds.resolveComment(d, id, true, scope, { by: 'u-sam', log: true });
  const before = ds.readThread(d, id, scope);
  const snap = ds.snapshotThread(d, id, scope);
  ds.deleteCommentThread(d, id, scope);
  assert.equal(ds.readThread(d, id, scope), null);
  ds.restoreThread(d, snap, scope);
  assert.deepEqual(ds.readThread(d, id, scope), before);
});

test('the readers keep to real threads and real replies', (t) => {
  tick(t);
  const { docs: [a], pageId } = devices(1);
  const id = start(a, pageId);
  const r1 = reply(a, id, 'Real', SAM, LOG);
  const map = mapOf(a);
  a.transact(() => {
    // Nothing in the app writes a Y type here; a thread made of one is not a thread.
    const forged = new Y.Map();
    map.set('cm_forged', forged);
    forged.set('pageId', pageId);
    forged.set('author', 'Rae');
    forged.set('body', 'not Rae');
    // Filed under one thread but naming another, or not a reply at all.
    map.set(`${id}~r~cr_x`, { kind: 'reply', threadId: 'cm_other', id: 'cr_x', ts: 5, body: 'misfiled' });
    map.set(`${id}~r~cr_y`, { kind: 'state', threadId: id, resolved: true });
    map.set(`${id}~s`, { kind: 'reply', threadId: id, resolved: true });
    // The same reply twice, once in the thread and once beside it.
    const { kind, threadId, ...same } = map.get(`${id}~r~${r1}`);
    map.set(id, { ...map.get(id), replies: [same] });
    // A reply whose thread is gone.
    map.set('cm_gone~r~cr_z', { kind: 'reply', threadId: 'cm_gone', id: 'cr_z', ts: 6, body: 'orphan' });
  });
  const all = ds.readComments(a, scopeOf(a));
  assert.deepEqual(all.map((x) => x.id), [id]);
  assert.deepEqual(bodies(all[0]), ['Real'], 'once');
  assert.equal(all[0].resolved, false);
  assert.equal(ds.readThread(a, 'cm_forged', scopeOf(a)), null);
});

test('until phase 2, replies and resolves are written into the thread, as every open tab reads them', (t) => {
  tick(t);
  const { docs: [a], pageId } = devices(1);
  const id = start(a, pageId);
  ds.addCommentReply(a, id, { body: 'Plain reply', ...SAM, scope: scopeOf(a) });
  ds.resolveComment(a, id, true, scopeOf(a), { by: 'u-sam' });
  if (ds.COMMENT_LOG_WRITES) return;
  assert.deepEqual([...mapOf(a).keys()], [id]);
  assert.deepEqual(old.popover(a, id).replies.map((r) => r.body), ['Plain reply']);
  assert.equal(old.popover(a, id).resolved, true);
});

test('phase 2 also pulls every tab that can’t read the new entries off its build', () => {
  // Builds stamped before this date have no readers for an entry filed beside
  // a thread. Writing those while such a tab is open would hide replies from
  // it, so the flag goes on only with the Worker's floor (worker.js) past it:
  // set it to the day after the production promote that carried the readers.
  const READERS_LANDED = '2026-10-20';
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const floor = /const MIN_CLIENT_BUILD = '(\d{4}-\d{2}-\d{2})'/.exec(worker)?.[1];
  assert.ok(floor, 'MIN_CLIENT_BUILD is where this test looks for it');
  assert.equal(typeof ds.COMMENT_LOG_WRITES, 'boolean');
  if (ds.COMMENT_LOG_WRITES) assert.ok(floor > READERS_LANDED, `MIN_CLIENT_BUILD ${floor} must be after ${READERS_LANDED}`);
});
