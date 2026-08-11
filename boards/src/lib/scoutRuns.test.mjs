// Runs — what "these" means.
//
// The failure this module exists to prevent: someone scouts on Monday and sends
// 14 photos, forgets, then on Thursday sends 6 of a diner and says "put these in
// Diner Recce". If "these" is the whole Bin, 20 cards move and 14 are wrong —
// and because filing sorts by colour the strays end up interleaved by hue, so
// un-picking them by hand means hunting 14 cards out of 20.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupIntoRuns, currentRun, olderRuns, runLabel, countable, RUN_GAP_MS,
} from './scoutRuns.js';

const HOUR = 60 * 60 * 1000;
const at = (id, msAgo, extra = {}) => ({
  id, createdAt: new Date(Date.now() - msAgo).toISOString(), ...extra,
});

test('a scouting day with long gaps in it is ONE run', () => {
  // Lunch, a drive, a two-hour walkthrough. None of those should split a day.
  const cards = [at('a', 7 * HOUR), at('b', 4 * HOUR), at('c', 30 * 60 * 1000)];
  const runs = groupIntoRuns(cards);
  assert.equal(runs.length, 1);
  assert.equal(currentRun(runs).cards.length, 3);
});

test('an overnight splits it', () => {
  const cards = [at('mon', 72 * HOUR), at('thu-1', 2 * HOUR), at('thu-2', HOUR)];
  const runs = groupIntoRuns(cards);
  assert.equal(runs.length, 2);
  // This is the whole point: "these" is Thursday's two, not Monday's as well.
  assert.deepEqual(currentRun(runs).cards.map((c) => c.id), ['thu-1', 'thu-2']);
  assert.deepEqual(olderRuns(runs).flatMap((r) => r.cards.map((c) => c.id)), ['mon']);
});

test('the gap threshold is 8 hours, either side of it', () => {
  const under = groupIntoRuns([at('x', RUN_GAP_MS + 2 * HOUR), at('y', 2 * HOUR + 1000)]);
  assert.equal(under.length, 1, 'just under 8h apart stays one run');
  const over = groupIntoRuns([at('x', 3 * RUN_GAP_MS), at('y', HOUR)]);
  assert.equal(over.length, 2, 'well over 8h apart splits');
});

test('an undated card can never join "what you just sent"', () => {
  // A card the user made by hand in the app, or anything predating this code.
  // Unknown age means "not what you just sent" — the conservative direction,
  // because the failure we care about is moving something unexpected.
  const runs = groupIntoRuns([{ id: 'hand-made' }, at('texted', 60 * 1000)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(currentRun(runs).cards.map((c) => c.id), ['texted']);
});

test('runs are ordered oldest first, so currentRun is genuinely the newest', () => {
  const runs = groupIntoRuns([at('new', HOUR), at('old', 100 * HOUR), at('mid', 50 * HOUR)]);
  assert.deepEqual(runs.map((r) => r.cards[0].id), ['old', 'mid', 'new']);
});

test('labels are elapsed time, not calendar — we do not know their timezone', () => {
  const now = Date.now();
  const label = (msAgo) => runLabel({ endedAt: now - msAgo }, now);
  assert.equal(label(30 * 1000), 'just now');
  assert.equal(label(20 * 60 * 1000), '20 min ago');
  assert.equal(label(3 * HOUR), '3 hours ago');
  assert.equal(label(1 * HOUR), '1 hour ago');
  assert.equal(label(25 * HOUR), 'yesterday');
  assert.equal(label(3 * 24 * HOUR), '3 days ago');
  // Past a week the exact day stops mattering and a short date reads better.
  assert.match(label(30 * 24 * HOUR), /^\d+ \w{3}$/);
  assert.equal(runLabel({ endedAt: null }), 'earlier');
});

test('a section header is not something the user would call a photo', () => {
  // Telling somebody we are about to move 7 things when they can see 6 photos
  // is the kind of small lie that costs trust in a confirmation.
  const cards = [at('img', HOUR), at('hdr', HOUR, { sectionHeader: true })];
  assert.deepEqual(countable(cards).map((c) => c.id), ['img']);
});

test('empty and junk inputs do not throw', () => {
  assert.deepEqual(groupIntoRuns([]), []);
  assert.deepEqual(groupIntoRuns(null), []);
  assert.equal(currentRun([]), null);
  assert.deepEqual(olderRuns([]), []);
  assert.deepEqual(countable(null), []);
});
