// COMMS-06: a thread shows its newest messages, not its first 200.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeNewestPage, prependOlder, lastMessageId, MESSAGE_PAGE } from './messagePaging.js';

const C = 'conv-a';
const msg = (n, conv = C) => ({
  id: `m${n}`, conversation_id: conv,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
});
const range = (from, to, conv) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i, conv));

test('the thread is fetched newest-first and reversed, so message 201 is on screen', () => {
  const src = readFileSync(new URL('./messages.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function fetchConversationMessages'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /\.order\('created_at', \{ ascending: false \}\)/);
  assert.match(body, /\.reverse\(\)/);
  assert.match(body, /\.lt\('created_at', before\)/, 'load older pages strictly before the oldest shown');
});

test('a short page is the whole conversation and replaces the list', () => {
  const prev = range(1, 5);
  const fresh = range(1, 4); // m5 was deleted
  assert.deepEqual(mergeNewestPage(prev, fresh, { conversationId: C, pageSize: 10 }).map(m => m.id),
    ['m1', 'm2', 'm3', 'm4']);
});

test('a full newest page keeps the older history the reader paged back to', () => {
  const pageSize = 3;
  const prev = range(1, 6);            // m1-m3 came from "load older"
  const fresh = range(5, 7);           // m7 just arrived
  const merged = mergeNewestPage(prev, fresh, { conversationId: C, pageSize });
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
});

test('a conversation switch never leaks the previous thread into the merge', () => {
  const prev = range(1, 3, 'conv-b');
  const fresh = range(10, 12);
  const merged = mergeNewestPage(prev, fresh, { conversationId: C, pageSize: 3 });
  assert.deepEqual(merged.map(m => m.id), ['m10', 'm11', 'm12']);
});

test('rows sharing the boundary timestamp are not duplicated', () => {
  const a = msg(5); const b = { ...msg(5), id: 'm5b' };
  const merged = mergeNewestPage([msg(4), a, b], [b, msg(6), msg(7)], { conversationId: C, pageSize: 3 });
  assert.deepEqual(merged.map(m => m.id), ['m4', 'm5', 'm5b', 'm6', 'm7']);
});

test('loading older prepends, without repeating what is already shown', () => {
  const merged = prependOlder(range(3, 5), range(1, 3));
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(prependOlder(range(3, 5), []).length, 3);
});

test('"something new arrived" keys on the last id, which moves even at a full page', () => {
  const before = range(1, MESSAGE_PAGE);
  const after = range(2, MESSAGE_PAGE + 1);
  assert.equal(before.length, after.length);
  assert.notEqual(lastMessageId(before), lastMessageId(after));
  // ...and does not move when history is prepended.
  assert.equal(lastMessageId(prependOlder(range(5, 9), range(1, 4))), 'm9');
  assert.equal(lastMessageId([]), null);
});

// History the reader paged back to is re-read on every refetch: a delete, an
// undo, an edit or a reaction to an old message used to change nothing on
// screen, because the merge kept the paged-back rows exactly as they were.
test('a re-read of paged-back history replaces it: deletes drop, edits and reactions show', () => {
  const pageSize = 3;
  const prev = range(1, 6);                               // m1-m3 paged back
  const fresh = range(4, 6);
  const history = [msg(1), { ...msg(3), body: 'edited', reactions: { '👍': ['u2'] } }]; // m2 deleted
  const merged = mergeNewestPage(prev, fresh, { conversationId: C, pageSize, history, historyFrom: msg(1).created_at });
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm3', 'm4', 'm5', 'm6']);
  assert.equal(merged[1].body, 'edited');
  assert.deepEqual(merged[1].reactions, { '👍': ['u2'] });
});

test('an undo brings a paged-back message back', () => {
  const prev = [msg(1), msg(3), msg(4), msg(5), msg(6)];  // m2 was deleted
  const merged = mergeNewestPage(prev, range(4, 6), { conversationId: C, pageSize: 3, history: range(1, 3), historyFrom: msg(1).created_at });
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});

test('the re-read is held to this conversation and to before the page, without repeats', () => {
  const history = [msg(1, 'conv-b'), msg(2), msg(4), msg(9)];
  const merged = mergeNewestPage(range(1, 6), range(4, 6), { conversationId: C, pageSize: 3, history });
  assert.deepEqual(merged.map(m => m.id), ['m2', 'm4', 'm5', 'm6']);
});

test('without a re-read (none held, or it failed) the paged-back rows stay as they were', () => {
  const merged = mergeNewestPage(range(1, 6), range(4, 6), { conversationId: C, pageSize: 3, history: null });
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});

test('the hook re-reads the paged-back range from the oldest loaded page, up to the page', () => {
  const src = readFileSync(new URL('../hooks/useMessageThread.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('const refetch = useCallback'), src.indexOf('useEffect(() => { refetch(); }'));
  assert.match(fn, /fetchConversationRange\(/);
  assert.match(fn, /history/);
  const lib = readFileSync(new URL('./messages.js', import.meta.url), 'utf8');
  const range = lib.slice(lib.indexOf('export async function fetchConversationRange'));
  const body = range.slice(0, range.indexOf('\n}\n'));
  assert.match(body, /\.gte\('created_at', from\)/);
  assert.match(body, /\.lte\('created_at', to\)/);
  assert.match(body, /\.is\('deleted_at', null\)/);
  assert.match(body, /if \(error\)/);
});

test('a page loaded while the re-read was in flight is kept, not dropped', () => {
  const prev = range(1, 6);                               // m1-m2 landed mid re-read
  const merged = mergeNewestPage(prev, range(4, 6), {
    conversationId: C, pageSize: 3, history: [msg(3)], historyFrom: msg(3).created_at,
  });
  assert.deepEqual(merged.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});
