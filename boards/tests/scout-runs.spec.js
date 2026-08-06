// Run grouping (src/lib/scoutRuns.js) and reply predicates
// (src/lib/scoutConfirm.js).
//
// These two modules exist for one scenario, and it gets its own test below: a
// user scouts on Monday and sends 14 photos, forgets, then on Thursday sends 6
// of a diner and says "put these in Diner Recce". Moving all 20 is the worst
// thing this feature can do — and because filing sorts by colour, the 14 strays
// end up interleaved by hue rather than in a block you can select and delete.

import { expect, test } from '@playwright/test';
import {
  groupIntoRuns, currentRun, olderRuns, runLabel, countable, RUN_GAP_MS,
} from '../src/lib/scoutRuns.js';
import { parseConfirmation, wantsEverything, isBinQuery } from '../src/lib/scoutConfirm.js';

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-08-03T09:00:00Z');   // Monday morning
const at = (id, ms) => ({ id, kind: 'image', createdAt: new Date(ms).toISOString() });

test('THE scenario: Monday is not part of Thursday', () => {
  const monday = Array.from({ length: 14 }, (_, i) => at(`mon${i}`, T0 + i * 4 * 60_000));
  const thursday = Array.from({ length: 6 }, (_, i) => at(`thu${i}`, T0 + 77 * H + i * 60_000));

  const runs = groupIntoRuns([...monday, ...thursday]);
  expect(runs).toHaveLength(2);

  const cur = currentRun(runs);
  expect(cur.cards).toHaveLength(6);
  expect(cur.cards.every((c) => c.id.startsWith('thu'))).toBe(true);

  const rest = olderRuns(runs);
  expect(rest.flatMap((r) => r.cards)).toHaveLength(14);
});

test('a working day of intermittent photos stays ONE run', () => {
  // 09:00, lunch gap, a two-hour walkthrough, then a late afternoon burst.
  const day = [
    at('a', T0), at('b', T0 + 90 * 60_000),
    at('c', T0 + 4 * H), at('d', T0 + 6 * H), at('e', T0 + 7 * H),
  ];
  expect(groupIntoRuns(day)).toHaveLength(1);
});

test('an overnight gap always splits', () => {
  const two = [at('a', T0), at('b', T0 + 16 * H)];
  expect(groupIntoRuns(two)).toHaveLength(2);
});

test('the boundary is exactly the configured gap', () => {
  expect(groupIntoRuns([at('a', T0), at('b', T0 + RUN_GAP_MS)])).toHaveLength(1);
  expect(groupIntoRuns([at('a', T0), at('b', T0 + RUN_GAP_MS + 1)])).toHaveLength(2);
});

test('cards arrive out of order and still group correctly', () => {
  const shuffled = [
    at('c', T0 + 30 * 60_000), at('a', T0), at('z', T0 + 40 * H), at('b', T0 + 10 * 60_000),
  ];
  const runs = groupIntoRuns(shuffled);
  expect(runs).toHaveLength(2);
  expect(runs[0].cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  expect(currentRun(runs).cards.map((c) => c.id)).toEqual(['z']);
});

test('a card with no timestamp is treated as OLD, never as current', () => {
  // Conservative on purpose: unknown age must not mean "part of what you just
  // sent". A hand-added card riding along on a move is the failure we're
  // guarding against.
  const cards = [{ id: 'mystery', kind: 'image' }, at('new', T0)];
  const runs = groupIntoRuns(cards);
  expect(currentRun(runs).cards.some((c) => c.id === 'mystery')).toBe(false);
});

test('an empty bin produces no runs and no current run', () => {
  expect(groupIntoRuns([])).toEqual([]);
  expect(currentRun([])).toBeNull();
  expect(olderRuns([])).toEqual([]);
  expect(olderRuns(groupIntoRuns([at('a', T0)]))).toEqual([]);
});

test('section headers are excluded from user-facing counts', () => {
  const cards = [at('a', T0), { id: 'sec', sectionHeader: true, createdAt: new Date(T0).toISOString() }, at('b', T0)];
  // Telling someone we'll move 3 things when they can see 2 photos is a small
  // lie that costs trust in a confirmation.
  expect(countable(cards)).toHaveLength(2);
});

test('run labels are elapsed-time, so they are true in every timezone', () => {
  const now = T0 + 100 * H;
  expect(runLabel({ endedAt: now - 30_000 }, now)).toBe('just now');
  expect(runLabel({ endedAt: now - 20 * 60_000 }, now)).toBe('20 min ago');
  expect(runLabel({ endedAt: now - 3 * H }, now)).toBe('3 hours ago');
  expect(runLabel({ endedAt: now - 25 * H }, now)).toBe('yesterday');
  expect(runLabel({ endedAt: now - 3 * 24 * H }, now)).toBe('3 days ago');
  // Past a week the exact day stops mattering and a date reads better.
  expect(runLabel({ endedAt: now - 20 * 24 * H }, now)).toMatch(/\d+ \w{3}/);
  expect(runLabel({ endedAt: null }, now)).toBe('earlier');
});

// ── Reply predicates ─────────────────────────────────────────────────────────

test('a clear yes, no or undo is recognised', () => {
  for (const s of ['yes', 'Yes', 'y', 'ok', 'OK!', 'yep', 'sure', 'do it', 'go ahead', '👍']) {
    expect(parseConfirmation(s), s).toBe('yes');
  }
  for (const s of ['no', 'nope', 'cancel', 'stop', "don't", 'wait', 'not yet']) {
    expect(parseConfirmation(s), s).toBe('no');
  }
  for (const s of ['undo', 'UNDO', 'revert', 'put them back', 'nevermind']) {
    expect(parseConfirmation(s), s).toBe('undo');
  }
});

test('AMBIGUITY IS NOT CONSENT — a sentence that merely starts with "ok" is not a yes', () => {
  // Moving twenty photos because someone texted a sentence containing "sure"
  // is precisely the failure the confirmation step exists to prevent.
  const notAnswers = [
    'okay so the diner is on 3rd',
    'yes but first let me check',
    'sure thing, also here are more photos',
    'no idea where this goes',
    'go to the loading dock',
    'scene 4 diner',
    '',
    null,
  ];
  for (const s of notAnswers) expect(parseConfirmation(s), String(s)).toBeNull();
});

test('"everything" is an explicit opt-in to the whole Bin', () => {
  for (const s of ['put everything in Diner Recce', 'file all of them there',
    'move the whole bin to Locations', 'file the rest in Diner Recce']) {
    expect(wantsEverything(s), s).toBe(true);
  }
  for (const s of ['put these in Diner Recce', 'file that under locations']) {
    expect(wantsEverything(s), s).toBe(false);
  }
});

test('bin queries are recognised in both command and plain-English form', () => {
  for (const s of ['/bin', "what's in my bin", 'what is in the bin', 'show me my bin']) {
    expect(isBinQuery(s), s).toBe(true);
  }
  for (const s of ['put these in the bin board', 'bin', 'scene 4 diner']) {
    expect(isBinQuery(s), s).toBe(false);
  }
});
