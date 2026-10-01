// trialAwaitingServer — the few seconds between the canvas crossing the trial
// line and the server's card count catching up. Every trial surface holds the
// priced variant while this is true, so it must be true ONLY in that window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialAwaitingServer, TRIAL_MIN_CARDS } from './creatorTrial.js';

const base = { tier: 'demo', cardLimit: 50, trialStartedAt: null };

test('the canvas crossed the line and the server has not: waiting', () => {
  assert.equal(trialAwaitingServer({ ...base, cards: TRIAL_MIN_CARDS, serverCards: TRIAL_MIN_CARDS - 1 }), true);
  // A bulk drop: the server still counts the board as it was before it.
  assert.equal(trialAwaitingServer({ ...base, cards: 49, serverCards: 0 }), true);
});

test('the server agrees (either way): not waiting', () => {
  assert.equal(trialAwaitingServer({ ...base, cards: 20, serverCards: 20 }), false);
  assert.equal(trialAwaitingServer({ ...base, cards: 20, serverCards: 14 }), false, 'server already eligible');
  assert.equal(trialAwaitingServer({ ...base, cards: 5, serverCards: 3 }), false, 'neither side eligible');
});

test('a server AHEAD of the canvas never holds an offer back', () => {
  // Deletes run the optimistic count backwards; that direction is not a wait.
  assert.equal(trialAwaitingServer({ ...base, cards: 10, serverCards: 30 }), false);
});

test('nobody who cannot have the trial is ever "waiting" for it', () => {
  assert.equal(trialAwaitingServer({ ...base, tier: 'paid', cards: 40, serverCards: 0 }), false);
  assert.equal(trialAwaitingServer({ ...base, trialStartedAt: '2026-09-20T00:00:00Z', cards: 40, serverCards: 0 }), false);
  assert.equal(trialAwaitingServer({ ...base, tier: null, cards: 40, serverCards: 0 }), false, 'tier not resolved yet');
});

test('junk inputs answer false rather than throwing', () => {
  assert.equal(trialAwaitingServer({ ...base, cards: NaN, serverCards: 0 }), false);
  assert.equal(trialAwaitingServer({ ...base, cards: 20, serverCards: undefined }), false);
  assert.equal(trialAwaitingServer(null), false);
});
