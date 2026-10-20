// The local write layer over a thread's server rows: what this tab has done
// stays on screen until a read that started after the server acknowledged it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertWrite, patchWrite, removeWrite, ackWrite, updateWrite, dropWrite,
  pruneWrites, applyWrites, sortRows, toggleReactionMap,
} from './messageStore.js';

const at = (s) => new Date(Date.UTC(2026, 9, 1, 9, 0, s)).toISOString();
const row = (id, s, extra = {}) => ({ id, conversation_id: 'c1', sender_id: 'u2', body: id, created_at: at(s), ...extra });
const ids = (rows) => rows.map((m) => m.id);

test('a message being sent shows at once, last, and keeps its id when the server confirms it', () => {
  const rows = [row('a', 1), row('b', 2)];
  const send = upsertWrite({ ...row('mine', 3, { sender_id: 'me' }), sendState: 'sending' });
  let writes = [send];
  assert.deepEqual(ids(applyWrites(rows, writes)), ['a', 'b', 'mine']);
  writes = ackWrite(writes, send.opId, 1, { row: row('mine', 4, { sender_id: 'me' }) });
  const shown = applyWrites(rows, writes);
  assert.deepEqual(ids(shown), ['a', 'b', 'mine'], 'same id, no remount');
  assert.equal(shown[2].sendState, undefined, 'confirmed rows carry no send state');
});

test('a read that started before the confirm cannot take the sent message back (COMMS-23)', () => {
  const send = upsertWrite({ ...row('mine', 3), sendState: 'sending' });
  let writes = [send];
  const issuedAt = 0;                      // the read started here…
  writes = ackWrite(writes, send.opId, 1, { row: row('mine', 3) }); // …the send confirmed after
  const stalePage = [row('a', 1)];         // so its page doesn't have the message
  writes = pruneWrites(writes, issuedAt);
  assert.deepEqual(ids(applyWrites(stalePage, writes)), ['a', 'mine']);
});

test('a read that started after the confirm prunes the write; the server row stands', () => {
  const send = upsertWrite({ ...row('mine', 3), sendState: 'sending' });
  let writes = ackWrite([send], send.opId, 1, { row: row('mine', 3) });
  const page = [row('a', 1), row('mine', 3, { body: 'as stored' })];
  writes = pruneWrites(writes, 1);
  assert.equal(writes.length, 0);
  assert.equal(applyWrites(page, writes)[1].body, 'as stored');
});

test('reads never drop a send still in flight or one that failed', () => {
  const sending = upsertWrite({ ...row('s1', 5), sendState: 'sending' });
  const failed = upsertWrite({ ...row('s2', 6), sendState: 'failed' });
  const writes = pruneWrites([sending, failed], 99);
  assert.equal(writes.length, 2);
  assert.deepEqual(ids(applyWrites([row('a', 1)], writes)), ['a', 's1', 's2']);
});

test('a failed send the server did save shows as sent once a read finds it', () => {
  const failed = upsertWrite({ ...row('lost', 5), sendState: 'failed' });
  const page = [row('a', 1), row('lost', 5)];
  const shown = applyWrites(page, [failed]);
  assert.deepEqual(ids(shown), ['a', 'lost']);
  assert.equal(shown[1].sendState, undefined);
});

test('unsent rows sort after sent ones even when this clock is behind', () => {
  const rows = sortRows([row('late', 50), { ...row('mine', 10), sendState: 'sending' }, row('early', 1)]);
  assert.deepEqual(ids(rows), ['early', 'late', 'mine']);
});

test('an optimistic patch shows over the server row and outlives an older read', () => {
  const p = patchWrite('a', { body: 'edited', edited_at: at(9) });
  let writes = [p];
  assert.equal(applyWrites([row('a', 1)], writes)[0].body, 'edited');
  writes = ackWrite(writes, p.opId, 3);
  writes = pruneWrites(writes, 2);               // a read from before the save
  assert.equal(applyWrites([row('a', 1)], writes)[0].body, 'edited');
  writes = pruneWrites(writes, 3);               // a read from after it
  assert.equal(writes.length, 0);
});

test('the server’s answer replaces the optimistic guess', () => {
  const p = patchWrite('a', { reactions: { '👍': ['me'] } });
  const writes = ackWrite([p], p.opId, 1, { patch: { reactions: { '👍': ['me', 'u3'] } } });
  assert.deepEqual(applyWrites([row('a', 1)], writes)[0].reactions, { '👍': ['me', 'u3'] });
});

test('a rolled-back change leaves the server row as it was', () => {
  const p = patchWrite('a', { is_pinned: true });
  const writes = dropWrite([p], p.opId);
  assert.equal(applyWrites([row('a', 1)], writes)[0].is_pinned, undefined);
  assert.equal(dropWrite(writes, 'nope'), writes, 'same array when nothing matched');
});

test('a delete hides the row until a later read; undo brings it back', () => {
  const del = removeWrite('b');
  let writes = [del];
  assert.deepEqual(ids(applyWrites([row('a', 1), row('b', 2)], writes)), ['a']);
  writes = ackWrite(writes, del.opId, 4);
  assert.deepEqual(ids(applyWrites([row('a', 1), row('b', 2)], pruneWrites(writes, 3))), ['a'], 'an old page still had it');
  assert.deepEqual(ids(applyWrites([row('a', 1), row('b', 2)], dropWrite(writes, del.opId))), ['a', 'b']);
});

test('a row re-read after a peer’s nudge survives a page that started earlier', () => {
  const nudged = upsertWrite(row('b', 2, { body: 'edited by peer' }), { ackedAt: 5 });
  const oldPage = [row('a', 1), row('b', 2, { body: 'original' })];
  const shown = applyWrites(oldPage, pruneWrites([nudged], 4));
  assert.equal(shown[1].body, 'edited by peer');
  assert.equal(pruneWrites([nudged], 5).length, 0, 'a page from after the re-read covers it');
});

test('updateWrite flips a send to failed without touching the others', () => {
  const a = upsertWrite({ ...row('s1', 5), sendState: 'sending' });
  const b = upsertWrite({ ...row('s2', 6), sendState: 'sending' });
  const writes = updateWrite([a, b], a.opId, (w) => ({ ...w, row: { ...w.row, sendState: 'failed' } }));
  assert.equal(writes[0].row.sendState, 'failed');
  assert.equal(writes[1], b);
});

test('no writes: the server rows come back as they are', () => {
  const rows = [row('a', 1)];
  assert.equal(applyWrites(rows, []), rows);
  assert.equal(pruneWrites([], 1).length, 0);
});

test('a reaction toggles like the server does', () => {
  assert.deepEqual(toggleReactionMap({}, '👍', 'me'), { '👍': ['me'] });
  assert.deepEqual(toggleReactionMap({ '👍': ['me', 'u2'] }, '👍', 'me'), { '👍': ['u2'] });
  assert.deepEqual(toggleReactionMap({ '👍': ['me'] }, '👍', 'me'), {});
  const before = { '🔥': ['u2'] };
  toggleReactionMap(before, '🔥', 'me');
  assert.deepEqual(before, { '🔥': ['u2'] }, 'the input is never mutated');
});
