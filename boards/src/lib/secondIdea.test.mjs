// secondIdea.test.mjs — the offer waits for a pile from an earlier sitting and
// something new arriving on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secondIdeaDue, stampMs, SECOND_IDEA_GAP_MS, SECOND_IDEA_MIN_PRIOR } from './secondIdea.js';

const NOW = Date.parse('2026-10-19T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const pile = (n, createdAt = hoursAgo(20), kind = 'image') =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind, createdAt }));

test('a pile from yesterday and something new on it: due', () => {
  assert.equal(SECOND_IDEA_MIN_PRIOR, 6);
  assert.equal(secondIdeaDue({ priorCards: pile(6), newCount: 1, now: NOW }), true);
  assert.equal(secondIdeaDue({ priorCards: pile(40), newCount: 12, now: NOW }), true);
});

test('five cards are not a pile yet', () => {
  assert.equal(secondIdeaDue({ priorCards: pile(5), newCount: 3, now: NOW }), false);
});

test('clusters and starter cards are not the pile, but a cluster made today is this sitting', () => {
  const five = pile(5);
  assert.equal(secondIdeaDue({ priorCards: [...five, { id: 'b1', kind: 'board', createdAt: hoursAgo(20) }], newCount: 1, now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: [...five, { id: 'l1', kind: 'boardlink', createdAt: hoursAgo(20) }], newCount: 1, now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: [...five, { id: 'onb-note', kind: 'note' }], newCount: 1, now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: [...five, { id: 'x', kind: 'board', seed: true }], newCount: 1, now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: [...pile(6), { id: 'b2', kind: 'board', createdAt: hoursAgo(1) }], newCount: 1, now: NOW }), false);
});

test('the sitting: three hours since anything was added here', () => {
  assert.equal(SECOND_IDEA_GAP_MS, 3 * 3_600_000);
  const cards = [...pile(6), { id: 'late', kind: 'note', createdAt: hoursAgo(2) }];
  assert.equal(secondIdeaDue({ priorCards: cards, newCount: 1, now: NOW }), false);
  const edge = [...pile(6), { id: 'late', kind: 'note', createdAt: hoursAgo(3) }];
  assert.equal(secondIdeaDue({ priorCards: edge, newCount: 1, now: NOW }), true);
  const ahead = [...pile(6), { id: 'skew', kind: 'note', createdAt: new Date(NOW + 60_000).toISOString() }];
  assert.equal(secondIdeaDue({ priorCards: ahead, newCount: 1, now: NOW }), false, 'stamped ahead of this clock');
});

test('cards from before stamps existed are old', () => {
  const cards = Array.from({ length: 6 }, (_, i) => ({ id: `old${i}`, kind: 'image' }));
  assert.equal(secondIdeaDue({ priorCards: cards, newCount: 1, now: NOW }), true);
  assert.equal(secondIdeaDue({ priorCards: [...cards, { id: 'n', kind: 'note', createdAt: hoursAgo(0.5) }], newCount: 1, now: NOW }), false);
});

test('nothing arriving is nothing to offer', () => {
  assert.equal(secondIdeaDue({ priorCards: pile(10), newCount: 0, now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: pile(10), now: NOW }), false);
  assert.equal(secondIdeaDue({ priorCards: null, newCount: 2, now: NOW }), false);
  assert.equal(secondIdeaDue(), false);
});

test('a null clock reads the real one, not the epoch', () => {
  const recent = pile(6, new Date().toISOString());
  assert.equal(secondIdeaDue({ priorCards: recent, newCount: 1, now: null }), false);
  assert.equal(secondIdeaDue({ priorCards: pile(6, new Date(Date.now() - 4 * 3_600_000).toISOString()), newCount: 1, now: null }), true);
});

test('stampMs reads ISO strings and numbers, and nothing else', () => {
  assert.equal(stampMs('2026-10-19T18:00:00Z'), NOW);
  assert.equal(stampMs(NOW), NOW);
  assert.equal(stampMs(null), null);
  assert.equal(stampMs(''), null);
  assert.equal(stampMs('yesterday'), null);
});
