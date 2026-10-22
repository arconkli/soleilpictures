// How a thread's rows lay out: runs, day dividers, the "New" line, and when
// a DM says "Seen".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedItems, selectSeenMessageId, typingLabel, dayLabel, RUN_WINDOW_MS, PAUSE_MS, messageThings, hasBubble } from './messageFeed.js';

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);
const at = (min) => new Date(T0 + min * 60 * 1000).toISOString();
const m = (id, sender, min, extra = {}) => ({ id, sender_id: sender, created_at: at(min), kind: 'user', ...extra });
const msgs = (items) => items.filter((i) => i.kind === 'msg');
const NOW = new Date(T0 + 60 * 60 * 1000);

test('a run continues while each message is within the window of the one before it', () => {
  const items = msgs(buildFeedItems([m('a', 'u2', 0), m('b', 'u2', 4), m('c', 'u2', 8), m('d', 'u2', 14)], { now: NOW }));
  assert.deepEqual(items.map((i) => i.isContinuation), [false, true, true, false]);
  assert.ok(RUN_WINDOW_MS === 5 * 60 * 1000);
});

test('another sender, a reply, a system row or a pin starts a new run', () => {
  const rows = [
    m('a', 'u2', 0), m('b', 'me', 1), m('c', 'me', 2, { parent_id: 'a' }),
    m('s', null, 3, { kind: 'system' }), m('d', 'me', 3), m('e', 'me', 4, { is_pinned: true }),
  ];
  const items = msgs(buildFeedItems(rows, { now: NOW }));
  assert.deepEqual(items.map((i) => i.isContinuation), [false, false, false, false, false, false]);
  const kept = msgs(buildFeedItems(rows, { now: NOW, breakOnPin: false }));
  assert.equal(kept[5].isContinuation, true, 'a look that shows the pin inline keeps the run');
});

test('runEnd marks the last message of each run', () => {
  const items = msgs(buildFeedItems([m('a', 'u2', 0), m('b', 'u2', 1), m('c', 'me', 2)], { now: NOW }));
  assert.deepEqual(items.map((i) => i.runEnd), [false, true, true]);
});

test('a day change draws a divider and ends the run', () => {
  const rows = [m('a', 'u2', -24 * 60), m('b', 'u2', -24 * 60 + 1), m('c', 'u2', 0)];
  const items = buildFeedItems(rows, { now: NOW });
  assert.deepEqual(items.map((i) => i.kind), ['divider', 'msg', 'msg', 'divider', 'msg']);
  assert.equal(items[0].label, 'Yesterday');
  assert.equal(items[3].label, 'Today');
  assert.equal(items[4].isContinuation, false);
});

test('a message still sending lays out like the confirmed one it becomes', () => {
  const rows = [m('a', 'me', 0), { ...m('b', 'me', 1), sendState: 'sending' }];
  const [, b] = msgs(buildFeedItems(rows, { now: NOW }));
  assert.equal(b.isContinuation, true, 'no header that collapses on confirm');
});

test('the "New" line goes above the first newer message from someone else', () => {
  const rows = [m('a', 'u2', 0), m('b', 'me', 5), m('c', 'u2', 10), m('d', 'u2', 11)];
  const items = buildFeedItems(rows, { selfId: 'me', newAfter: at(6), now: NOW });
  const i = items.findIndex((x) => x.kind === 'new');
  assert.equal(items[i + 1].msg.id, 'c');
  assert.equal(items[i + 1].isContinuation, false, 'the line ends the run above it');
  assert.equal(items.filter((x) => x.kind === 'new').length, 1);
});

test('your own newer messages never draw the "New" line', () => {
  const rows = [m('a', 'u2', 0), m('b', 'me', 10)];
  assert.ok(!buildFeedItems(rows, { selfId: 'me', newAfter: at(5), now: NOW }).some((x) => x.kind === 'new'));
  assert.ok(!buildFeedItems(rows, { selfId: 'me', now: NOW }).some((x) => x.kind === 'new'), 'nothing unread, no line');
});

test('Seen: only in a DM, only under your newest message, once they have read it', () => {
  const rows = [m('a', 'u2', 0), m('b', 'me', 5)];
  const base = { selfId: 'me', isDm: true, peerId: 'u2' };
  assert.equal(selectSeenMessageId(rows, { ...base, peerLastReadAt: at(6) }), 'b');
  assert.equal(selectSeenMessageId(rows, { ...base, peerLastReadAt: at(4) }), null, 'not read yet');
  assert.equal(selectSeenMessageId(rows, { ...base, isDm: false, peerLastReadAt: at(6) }), null, 'never in a group');
});

test('Seen: their reply hides it; writing back counts as reading', () => {
  assert.equal(selectSeenMessageId([m('a', 'me', 0), m('b', 'u2', 5)],
    { selfId: 'me', isDm: true, peerId: 'u2', peerLastReadAt: at(6) }), null);
  const rows = [m('a', 'me', 0), m('b', 'u2', 5), m('c', 'me', 5)];
  assert.equal(selectSeenMessageId(rows, { selfId: 'me', isDm: true, peerId: 'u2', peerLastReadAt: null }), 'c',
    'their message at the same moment as yours means they saw it');
});

test('Seen: a message still sending or kept after a failure never shows it', () => {
  const rows = [m('a', 'me', 0), { ...m('b', 'me', 5), sendState: 'failed' }];
  assert.equal(selectSeenMessageId(rows, { selfId: 'me', isDm: true, peerId: 'u2', peerLastReadAt: at(9) }), 'a');
});

test('typing, in words', () => {
  assert.equal(typingLabel([]), '');
  assert.equal(typingLabel(['Jon']), 'Jon is typing');
  assert.equal(typingLabel(['Jon', 'Lena']), 'Jon and Lena are typing');
  assert.equal(typingLabel(['Jon', 'Lena', 'Sam']), 'Several people are typing');
});

test('day labels: today, yesterday, then weekday, then date', () => {
  assert.equal(dayLabel(at(0), NOW), 'Today');
  assert.equal(dayLabel(at(-24 * 60), NOW), 'Yesterday');
  assert.equal(dayLabel('', NOW), '');
});

test('the card look keeps a reply in the run (its quote sits inside the bubble)', () => {
  const rows = [m('a', 'u2', 0), m('b', 'me', 1), m('c', 'me', 2, { parent_id: 'a', body: 'yes' })];
  const items = msgs(buildFeedItems(rows, { now: NOW, breakOnReply: false }));
  assert.deepEqual(items.map((i) => i.isContinuation), [false, false, true]);
  assert.deepEqual(items.map((i) => i.runStart), [true, true, false]);
});

test('bubbles of a run join corners unless something is drawn between them', () => {
  const pic = { kind: 'image', storage_path: 'x.jpg' };
  const rows = [
    m('a', 'u2', 0, { body: 'one' }), m('b', 'u2', 1, { body: 'two' }),
    m('c', 'u2', 2, { body: 'three', attachments: [pic] }), m('d', 'u2', 3, { body: 'four' }),
    m('e', 'u2', 4, { body: 'five', reactions: { '👍': ['me'] } }), m('f', 'u2', 4, { body: 'six', edited_at: at(4) }),
    m('g', 'u2', 4, { body: '', attachments: [pic] }),
  ];
  const items = msgs(buildFeedItems(rows, { now: NOW }));
  assert.deepEqual(items.map((i) => [i.joinUp, i.joinDown]), [
    [false, true], [true, true], [true, false], [false, true], [true, false], [false, false], [false, false],
  ]);
});

test('a time goes under a run after a pause, a break, and under the newest run', () => {
  const rows = [
    m('a', 'u2', 0), m('b', 'me', 10), m('c', 'u2', 12),
    m('d', 'me', 12 + PAUSE_MS / 60000), m('e', 'u2', 50),
    m('s', null, 51, { kind: 'system' }), m('f', 'me', 52), m('g', 'u2', 53), m('h', 'u2', 54),
  ];
  const items = msgs(buildFeedItems(rows, { now: NOW })).filter((i) => i.msg.kind !== 'system');
  const shown = items.filter((i) => i.showTime).map((i) => i.msg.id);
  assert.deepEqual(shown, ['a', 'd', 'f', 'h'], 'the first run of the day, after 30 minutes, after a system row, the newest');
  assert.equal(items.find((i) => i.msg.id === 'g').showTime, false, 'only the run’s last message carries it');
});

test('things are pictures, files, links and clusters; a bubble needs words or a quote', () => {
  const row = { attachments: [{ kind: 'image' }, { kind: 'board' }, { kind: 'tag' }, null, { kind: 'url' }] };
  assert.deepEqual(messageThings(row).map((a) => a.kind), ['image', 'board', 'url']);
  assert.equal(hasBubble({ body: '  ' }), false);
  assert.equal(hasBubble({ body: '', parent_id: 'x' }), true);
  assert.equal(hasBubble({ body: 'hi' }), true);
});
