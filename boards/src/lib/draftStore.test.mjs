// A conversation's draft — text, staged files, dropped refs, mentions and the
// reply it answers — lives in memory for instant switching and in the browser
// for reloads. Only what can come back is stored.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_DRAFT, getDraft, updateDraft, subscribeDraft, flushDrafts, parseDraft, serializeDraft,
  replyTarget, isEmptyDraft, resetDraftsForTest,
} from './draftStore.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

const V2 = 'soleil.boards.msg.draft2.';
const OLD = 'soleil.boards.msg.draft.';
const img = { kind: 'image', storage_path: 'ws/me/a.jpg', name: 'a.jpg', mime: 'image/jpeg', size: 10 };

beforeEach(() => { resetDraftsForTest(); globalThis.localStorage = fakeStorage(); });

test('a draft round-trips: text, finished files, refs, mentions and the reply', () => {
  const d = {
    body: 'see @Maya',
    items: [{ key: 'k1', status: 'done', att: img }],
    refs: [{ kind: 'board', id: 'b1', title: 'Casting' }],
    mentions: ['maya'],
    replyTo: replyTarget({ id: 'm1', sender_id: 'maya', body: 'can you look?' }),
  };
  const back = parseDraft(serializeDraft(d));
  assert.equal(back.body, 'see @Maya');
  assert.deepEqual(back.items.map((i) => [i.status, i.att]), [['done', img]]);
  assert.deepEqual(back.refs, d.refs);
  assert.deepEqual(back.mentions, ['maya']);
  assert.equal(back.replyTo.id, 'm1');
});

test('a file still uploading, or one that failed, is never stored (it can’t come back)', () => {
  const raw = serializeDraft({
    ...EMPTY_DRAFT,
    body: 'x',
    items: [
      { key: 'a', status: 'uploading', name: 'big.mov', file: {} },
      { key: 'b', status: 'failed', name: 'bad.png', file: {} },
      { key: 'c', status: 'done', att: img },
    ],
  });
  assert.deepEqual(JSON.parse(raw).attachments, [img]);
});

test('an empty draft removes its stored copy', () => {
  updateDraft('c1', (d) => ({ ...d, body: 'hi' }), { now: true });
  assert.ok(localStorage.getItem(V2 + 'c1'));
  updateDraft('c1', (d) => ({ ...d, body: '   ' }), { now: true });
  assert.equal(localStorage.getItem(V2 + 'c1'), null);
  assert.equal(isEmptyDraft(getDraft('c1')), true);
});

test('changes reach the stored copy when flushed, not on every keystroke', () => {
  updateDraft('c1', (d) => ({ ...d, body: 'h' }));
  updateDraft('c1', (d) => ({ ...d, body: 'he' }));
  assert.equal(localStorage.getItem(V2 + 'c1'), null, 'waiting on the debounce');
  flushDrafts();
  assert.equal(JSON.parse(localStorage.getItem(V2 + 'c1')).body, 'he');
});

test('the live copy keeps everything for this page, uploads included, and tells its readers', () => {
  let heard = 0;
  const off = subscribeDraft('c1', () => { heard += 1; });
  updateDraft('c1', (d) => ({ ...d, items: [{ key: 'u', status: 'uploading', name: 'a.jpg', file: {} }] }));
  assert.equal(heard, 1);
  assert.equal(getDraft('c1').items[0].status, 'uploading');
  assert.equal(getDraft('c1'), getDraft('c1'), 'the same object until it changes');
  const before = getDraft('c1');
  updateDraft('c1', (d) => d);
  assert.equal(getDraft('c1'), before, 'returning the draft unchanged is no change');
  assert.equal(heard, 1);
  off();
  assert.deepEqual(getDraft('c2'), EMPTY_DRAFT, 'conversations don’t share drafts');
});

test('a plain-text draft from before is the body, read once and moved over', () => {
  globalThis.localStorage = fakeStorage({ [OLD + 'c1']: 'half a thought' });
  assert.equal(getDraft('c1').body, 'half a thought');
  assert.equal(localStorage.getItem(OLD + 'c1'), null);
  assert.equal(JSON.parse(localStorage.getItem(V2 + 'c1')).body, 'half a thought');
});

test('a draft written in the old reply-thread view is taken in when the conversation’s own is empty', () => {
  globalThis.localStorage = fakeStorage({ [OLD + 'c1:r:m9']: 'replying here', [OLD + 'c2:r:m3']: 'other conversation' });
  assert.equal(getDraft('c1').body, 'replying here');
  assert.equal(localStorage.getItem(OLD + 'c1:r:m9'), null);
  assert.equal(localStorage.getItem(OLD + 'c2:r:m3'), 'other conversation', 'only this conversation’s');
  resetDraftsForTest();
  globalThis.localStorage = fakeStorage({ [OLD + 'c1']: 'mine', [OLD + 'c1:r:m9']: 'old reply' });
  assert.equal(getDraft('c1').body, 'mine', 'the conversation’s own text wins');
});

test('junk in storage reads as an empty draft', () => {
  assert.deepEqual(parseDraft('{not json'), EMPTY_DRAFT);
  assert.deepEqual(parseDraft('{"v":1,"body":"x"}'), EMPTY_DRAFT);
  assert.equal(parseDraft(JSON.stringify({ v: 2, body: 'ok', attachments: [null, 3, img], replyTo: { id: 5 } })).items.length, 1);
});

test('the reply kept in a draft is small and enough to show and send', () => {
  const r = replyTarget({ id: 'm1', sender_id: 'u', body: 'x'.repeat(1000), attachments: [img], reactions: { '👍': ['a'] } });
  assert.deepEqual(Object.keys(r).sort(), ['body', 'id', 'sender_email', 'sender_id', 'sender_name']);
  assert.equal(r.body.length, 280);
  assert.equal(replyTarget(null), null);
});

test('drafts are written when the page is hidden, and when the composer goes away', () => {
  const store = readFileSync(new URL('./draftStore.js', import.meta.url), 'utf8');
  assert.match(store, /window\.addEventListener\('pagehide', \(\) => flushDrafts\(\)\);/);
  assert.match(store, /if \(document\.visibilityState === 'hidden'\) flushDrafts\(\);/);
  const hook = readFileSync(new URL('../hooks/useDraft.js', import.meta.url), 'utf8');
  assert.match(hook, /useEffect\(\(\) => \(\) => flushDrafts\(key\), \[key\]\);/);
});

test('the thread watches only the reply target, so typing doesn’t re-render the conversation', () => {
  const thread = readFileSync(new URL('../components/MessageThread.jsx', import.meta.url), 'utf8');
  assert.match(thread, /const replyTo = useDraftValue\(conversationId \|\| '', \(d\) => d\.replyTo\);/);
  assert.doesNotMatch(thread, /useDraft\(/);
  // Typing keeps the reply target's identity, so that watcher stays quiet.
  updateDraft('c1', (d) => ({ ...d, replyTo: replyTarget({ id: 'm1', body: 'x' }) }));
  const target = getDraft('c1').replyTo;
  updateDraft('c1', (d) => ({ ...d, body: 'typing…' }));
  assert.equal(getDraft('c1').replyTo, target);
});
