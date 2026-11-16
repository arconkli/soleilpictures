import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  fromCanvasRows, fromDocThread, fromFileRows, personLookup, toMs,
} from './commentModel.js';
import { threadSummary, threadSummaryLine } from './commentTime.js';
import { addCommentThread, addCommentReply, resolveComment, readThread } from './docState.js';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const people = [
  { id: ANA, name: 'Ana Ruiz', avatar_url: 'https://cdn.example/ana.jpg', color: '#e6a57e' },
  { id: BEN, name: 'Ben Shah', avatar_url: 'http://insecure.example/ben.jpg' },
];

test('toMs reads ISO strings, numbers and dates', () => {
  assert.equal(toMs('2026-11-15T10:00:00.000Z'), Date.UTC(2026, 10, 15, 10));
  assert.equal(toMs(1234), 1234);
  assert.equal(toMs(new Date(5)), 5);
  assert.equal(toMs(null), null);
  assert.equal(toMs('not a date'), null);
});

test('personLookup takes a list, a Map, an object or a function', () => {
  assert.equal(personLookup(people)(ANA).name, 'Ana Ruiz');
  assert.equal(personLookup(new Map([[ANA, { name: 'Ana' }]]))(ANA).name, 'Ana');
  assert.equal(personLookup({ [ANA]: { display_name: 'Ana R' } })(ANA).name, 'Ana R');
  assert.equal(personLookup((id) => (id === ANA ? { name: 'Fn Ana' } : null))(ANA).name, 'Fn Ana');
  assert.equal(personLookup(people)('nobody'), null);
  assert.equal(personLookup(null)(ANA), null);
  // only https faces
  assert.equal(personLookup(people)(ANA).avatar, 'https://cdn.example/ana.jpg');
  assert.equal(personLookup(people)(BEN).avatar, null);
});

test('fromCanvasRows: roots with their replies, oldest first', () => {
  const rows = [
    { id: 'r2', board_id: 'b', author: BEN, body: 'second reply', reply_to: 'c1', created_at: '2026-11-15T10:20:00Z' },
    { id: 'c2', board_id: 'b', author: BEN, body: 'later thread', reply_to: null, anchor_kind: 'point', anchor_x: 40, anchor_y: 60, resolved: true, created_at: '2026-11-15T11:00:00Z' },
    { id: 'c1', board_id: 'b', author: ANA, body: 'first\nline two', reply_to: null, anchor_kind: 'card', anchor_id: 'card-1', offset_x: 4, offset_y: 0, hidden: false, resolved: false, created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:30:00Z' },
    { id: 'r1', board_id: 'b', author: null, body: 'first reply', reply_to: 'c1', created_at: '2026-11-15T10:10:00Z' },
    { id: 'orphan', board_id: 'b', author: ANA, body: 'parent is gone', reply_to: 'missing', created_at: '2026-11-15T10:10:00Z' },
  ];
  const threads = fromCanvasRows(rows, people);
  assert.deepEqual(threads.map((t) => t.id), ['c1', 'c2']);
  const [t1, t2] = threads;
  assert.equal(t1.root.authorId, ANA);
  assert.equal(t1.root.authorName, 'Ana Ruiz');
  assert.equal(t1.root.authorAvatar, 'https://cdn.example/ana.jpg');
  assert.equal(t1.root.body, 'first\nline two');
  assert.equal(t1.root.createdAt, Date.parse('2026-11-15T10:00:00Z'));
  // a move writes updated_at; that is not an edit
  assert.equal(t1.root.editedAt, null);
  assert.equal(t1.root.deleted, false);
  assert.deepEqual(t1.root.mentions, []);
  assert.equal(t1.root.meta.anchorKind, 'card');
  assert.equal(t1.root.meta.anchorId, 'card-1');
  assert.equal(t1.root.meta.offsetX, 4);
  assert.deepEqual(t1.replies.map((r) => r.id), ['r1', 'r2']);
  // an author who left
  assert.equal(t1.replies[0].authorId, null);
  assert.equal(t1.replies[0].authorName, 'Member');
  assert.equal(t1.resolved, false);
  assert.equal(t1.lastActivityAt, Date.parse('2026-11-15T10:20:00Z'));
  assert.equal(t2.resolved, true);
  assert.equal(t2.resolvedBy, null);
  assert.equal(t2.resolvedAt, null);
  assert.equal(t2.root.meta.anchorX, 40);
});

test('fromCanvasRows: mentions, edits and who resolved, once the rows carry them', () => {
  const [t] = fromCanvasRows([{
    id: 'c1', author: ANA, body: '@Ben Shah look', reply_to: null, created_at: '2026-11-15T10:00:00Z',
    edited_at: '2026-11-15T10:05:00Z', mentions: [BEN, 'unknown-id', BEN],
    resolved: true, resolved_by: BEN, resolved_at: '2026-11-15T12:00:00Z',
  }], people);
  assert.deepEqual(t.root.mentions, [{ id: BEN, name: 'Ben Shah' }]);
  assert.equal(t.root.editedAt, Date.parse('2026-11-15T10:05:00Z'));
  assert.deepEqual(t.resolvedBy, { id: BEN, name: 'Ben Shah' });
  assert.equal(t.resolvedAt, Date.parse('2026-11-15T12:00:00Z'));
});

test('fromCanvasRows: a deleted row keeps no words; pending and failed pass through', () => {
  const [t] = fromCanvasRows([
    { id: 'c1', author: ANA, body: 'secret', reply_to: null, created_at: '2026-11-15T10:00:00Z', deleted_at: '2026-11-15T10:01:00Z' },
    { id: 'r1', author: ANA, body: 'sending', reply_to: 'c1', created_at: '2026-11-15T10:02:00Z', pending: true },
    { id: 'r2', author: ANA, body: 'failed', reply_to: 'c1', created_at: '2026-11-15T10:03:00Z', failed: true },
  ], people);
  assert.equal(t.root.deleted, true);
  assert.equal(t.root.body, '');
  assert.equal(t.replies[0].pending, true);
  assert.equal(t.replies[1].failed, true);
  assert.equal(fromCanvasRows(null).length, 0);
});

test('fromDocThread: a thread as docState reads it, replies and state filed beside it', () => {
  const ydoc = new Y.Doc();
  const id = addCommentThread(ydoc, { pageId: 'p1', body: 'Is this right? @Ben Shah', author: 'Ana (old name)', authorId: ANA, authorColor: '#123456', mentions: [BEN] });
  const r1 = addCommentReply(ydoc, id, { body: 'Yes.', author: 'Guest Gia', authorId: null, authorColor: '#abcdef', mentions: [] });
  resolveComment(ydoc, id, true, undefined, { by: BEN, byName: 'Benjamin' });
  const t = fromDocThread(readThread(ydoc, id), people);
  assert.equal(t.id, id);
  assert.equal(t.root.id, id);
  assert.equal(t.root.authorId, ANA);
  // the name people know now wins over the one written with the comment
  assert.equal(t.root.authorName, 'Ana Ruiz');
  assert.equal(t.root.authorColor, '#e6a57e');
  assert.deepEqual(t.root.mentions, [{ id: BEN, name: 'Ben Shah' }]);
  assert.equal(t.root.meta.pageId, 'p1');
  assert.equal(typeof t.root.createdAt, 'number');
  assert.equal(t.replies.length, 1);
  assert.equal(t.replies[0].id, r1);
  // nobody to look up: the name and colour written with the reply
  assert.equal(t.replies[0].authorName, 'Guest Gia');
  assert.equal(t.replies[0].authorColor, '#abcdef');
  assert.equal(t.replies[0].authorId, null);
  assert.equal(t.resolved, true);
  assert.deepEqual(t.resolvedBy, { id: BEN, name: 'Ben Shah' });
  assert.equal(typeof t.resolvedAt, 'number');
  assert.ok(t.lastActivityAt >= t.root.createdAt);
});

test('fromDocThread: old-shape threads, reopened threads, and nothing at all', () => {
  const old = fromDocThread({
    id: 'cm_old', pageId: 'p', ts: 1000, author: 'Jo', authorId: 'u-jo', body: 'hi', mentions: [],
    replies: [{ id: 'cr_b', ts: 3000, author: 'Al', body: 'two' }, { ts: 2000, author: 'Al', body: 'one' }],
    resolved: true, resolvedBy: null, resolvedByName: null, resolvedAt: null,
  }, null);
  assert.equal(old.root.authorName, 'Jo');
  assert.deepEqual(old.replies.map((r) => r.body), ['one', 'two']);
  assert.ok(old.replies[0].id, 'a reply without an id still gets a key');
  assert.equal(old.resolved, true);
  assert.equal(old.resolvedBy, null);
  assert.equal(old.lastActivityAt, 3000);
  const open = fromDocThread({ id: 'cm_x', ts: 1, author: '', body: 'x', replies: [], resolved: false, resolvedBy: 'u', resolvedByName: 'N', resolvedAt: 9 });
  assert.equal(open.resolvedBy, null);
  assert.equal(open.resolvedAt, null);
  assert.equal(open.root.authorName, 'Someone');
  assert.equal(fromDocThread(null), null);
  assert.equal(fromDocThread({}), null);
});

test('fromFileRows: flat rows into threads; a deleted row has no name and no face', () => {
  const rows = [
    { id: 'f1', body: 'Hold on the sign.', deleted: false, at_ms: 12000, page: null, reply_to: null, resolved: false, created_at: '2026-11-15T09:00:00Z', edited_at: null, on_current: true, mine: false, author: { name: 'Mara', avatar_url: 'https://cdn.example/m.jpg', color: '#e6a57e' }, can_delete: true, can_resolve: true },
    { id: 'f2', body: null, deleted: true, at_ms: 42000, page: null, reply_to: null, resolved: true, created_at: '2026-11-15T09:05:00Z', edited_at: '2026-11-15T09:06:00Z', on_current: false, mine: true, author: { name: 'Dev Shah', avatar_url: 'https://cdn.example/d.jpg', color: '#8fb8de' }, can_delete: false, can_resolve: false },
    { id: 'f3', body: 'Agreed.', deleted: false, at_ms: null, page: null, reply_to: 'f2', resolved: false, created_at: '2026-11-15T09:10:00Z', edited_at: '2026-11-15T09:11:00Z', on_current: true, mine: true, author: { name: '  ', avatar_url: 'javascript:alert(1)', color: null }, can_delete: true, can_resolve: false },
  ];
  const [a, b] = fromFileRows(rows);
  assert.equal(a.id, 'f1');
  assert.equal(a.root.authorId, null);
  assert.equal(a.root.authorName, 'Mara');
  assert.equal(a.root.authorAvatar, 'https://cdn.example/m.jpg');
  assert.deepEqual(a.root.meta, { atMs: 12000, page: null, onCurrent: true, mine: false, canDelete: true, canResolve: true });
  assert.equal(a.resolved, false);
  // F7: the placeholder says nothing about who wrote it
  assert.equal(b.root.deleted, true);
  assert.equal(b.root.body, '');
  assert.equal(b.root.authorName, '');
  assert.equal(b.root.authorAvatar, null);
  assert.equal(b.root.authorColor, null);
  assert.equal(b.root.editedAt, null);
  assert.equal(b.root.meta.onCurrent, false);
  assert.equal(b.resolved, true);
  assert.equal(b.replies.length, 1);
  assert.equal(b.replies[0].authorName, 'Someone');
  assert.equal(b.replies[0].authorAvatar, null);
  assert.equal(b.replies[0].editedAt, Date.parse('2026-11-15T09:11:00Z'));
  assert.equal(b.replies[0].meta.mine, true);
  assert.equal(b.lastActivityAt, Date.parse('2026-11-15T09:10:00Z'));
  assert.deepEqual(fromFileRows(undefined), []);
});

test('threadSummary: how many replies and when the last thing was said', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const [t] = fromCanvasRows([
    { id: 'c1', author: ANA, body: 'a', reply_to: null, created_at: '2026-11-15T09:00:00Z' },
    { id: 'r1', author: BEN, body: 'b', reply_to: 'c1', created_at: '2026-11-15T10:00:00Z' },
    { id: 'r2', author: BEN, body: 'c', reply_to: 'c1', created_at: '2026-11-15T11:48:00Z' },
    { id: 'r3', author: BEN, body: 'gone', reply_to: 'c1', created_at: '2026-11-15T11:59:00Z', deleted_at: '2026-11-15T11:59:30Z' },
  ], people);
  assert.deepEqual(threadSummary(t, now), { replies: 2, lastAt: Date.parse('2026-11-15T11:48:00Z'), lastWords: '12m' });
  assert.equal(threadSummaryLine(t, now), '2 replies · 12m');
  const [solo] = fromCanvasRows([{ id: 'c9', author: ANA, body: 'a', reply_to: null, created_at: '2026-11-15T11:59:40Z' }], people);
  assert.deepEqual(threadSummary(solo, now), { replies: 0, lastAt: Date.parse('2026-11-15T11:59:40Z'), lastWords: 'now' });
  assert.equal(threadSummaryLine(solo, now), 'No replies yet');
  const one = { ...t, replies: t.replies.slice(0, 1) };
  assert.equal(threadSummaryLine(one, now), '1 reply · 2h');
  assert.deepEqual(threadSummary(null, now), { replies: 0, lastAt: null, lastWords: '' });
  // mid-line, the day word is lower case
  const noon = new Date(2026, 10, 15, 12, 0).getTime();
  const old = { ...t, replies: [{ ...t.replies[0], createdAt: new Date(2026, 10, 14, 9, 0).getTime() }] };
  old.root = { ...t.root, createdAt: new Date(2026, 10, 13, 9, 0).getTime() };
  assert.equal(threadSummary(old, noon).lastWords, 'yesterday');
  assert.equal(threadSummaryLine(old, noon), '1 reply · yesterday');
});
