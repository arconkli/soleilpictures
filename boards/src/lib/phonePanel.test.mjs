// phonePanel.test.mjs — the admin phone panel's view model (phonePanel.js).
//
//   node --test src/lib/phonePanel.test.mjs
//
// What this guards:
//   * "today" is the local calendar day: signupsToday counts from local midnight,
//     and flags a possibly short count when every fetched row is from today;
//   * usualDay averages only complete, settled weeks (the last four), and says
//     null rather than guess from fewer than two;
//   * delta words the week-on-week change (percent for counts, points for
//     rates) and says nothing when either side is missing;
//   * the spark line puts the highest value at the top, a flat series in the
//     middle, and the last point at the right edge;
//   * small formatters (ago, initials, formatCount, dayLabel, slideUrl) and the
//     signup row wording;
//   * the "At 72 h: …" note parses into posts with views and ratios (1.3k is
//     1300), anything else is null, and the bars scale against the best post;
//   * the Posts badge counts today's posts not yet marked posted, found by
//     local date.
//
// All dates are built from fixed local-time parts; the real clock is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfDay, signupsToday, usualDay, delta, sparkRuns, dayPair, formatCount,
  MEASURES, ago, initials, signupRow, parseNote, noteBars,
  localDate, unpostedCount, dayLabel, slideUrl,
} from './phonePanel.js';

const NOW = new Date(2026, 10, 1, 15, 0); // Sun Nov 1 2026, 15:00 local

test('startOfDay is local midnight and leaves its input alone', () => {
  const d = startOfDay(NOW);
  assert.equal(d.getTime(), new Date(2026, 10, 1, 0, 0, 0, 0).getTime());
  assert.equal(NOW.getHours(), 15);
});

test('signupsToday counts rows from local midnight on', () => {
  const rows = [
    { created_at: new Date(2026, 10, 1, 14, 0).toISOString() },
    { created_at: new Date(2026, 10, 1, 0, 0).toISOString() },
    { created_at: new Date(2026, 9, 31, 23, 59).toISOString() },
    { created_at: new Date(2026, 9, 30, 12, 0).toISOString() },
  ];
  assert.deepEqual(signupsToday(rows, NOW), { n: 2, capped: false });
});

test('signupsToday is capped when every row is today, never for an empty list', () => {
  const rows = [
    { created_at: new Date(2026, 10, 1, 9, 0).toISOString() },
    { created_at: new Date(2026, 10, 1, 1, 0).toISOString() },
  ];
  assert.deepEqual(signupsToday(rows, NOW), { n: 2, capped: true });
  assert.deepEqual(signupsToday([], NOW), { n: 0, capped: false });
  assert.deepEqual(signupsToday(null, NOW), { n: 0, capped: false });
});

test('usualDay averages the last four complete weeks over 7, rounded', () => {
  const weeks = [
    { complete: true, signups: 100 },   // too old: only the last four count
    { complete: true, signups: 14 },
    { complete: true, signups: 21 },
    { complete: true, signups: 28 },
    { complete: true, signups: 30 },
  ];
  // (14 + 21 + 28 + 30) / 28 = 3.32 -> 3
  assert.equal(usualDay(weeks), 3);
});

test('usualDay ignores incomplete and settling weeks', () => {
  const weeks = [
    { complete: true, signups: 14 },
    { complete: true, signups: 28 },
    { complete: true, settling: true, signups: 500 },
    { complete: false, signups: 500 },
  ];
  // (14 + 28) / 14 = 3
  assert.equal(usualDay(weeks), 3);
});

test('usualDay is null with fewer than two complete weeks', () => {
  assert.equal(usualDay([]), null);
  assert.equal(usualDay(null), null);
  assert.equal(usualDay([{ complete: true, signups: 14 }]), null);
  assert.equal(usualDay([{ complete: true, signups: 14 }, { complete: false, signups: 14 }]), null);
});

test('delta words a count change as a percent', () => {
  assert.deepEqual(delta(10, 8), { text: '▲ 25%', dir: 'up' });
  assert.deepEqual(delta(6, 8), { text: '▼ 25%', dir: 'down' });
  assert.deepEqual(delta(8, 8), { text: 'same', dir: 'flat' });
});

test('delta from a previous 0 reads as new', () => {
  assert.deepEqual(delta(5, 0), { text: '▲ 5 new', dir: 'up' });
  assert.deepEqual(delta(0, 0), { text: 'same', dir: 'flat' });
});

test('delta of a rate is in points, including same', () => {
  assert.deepEqual(delta(0.5, 0.4, 'rate'), { text: '▲ 10 pts', dir: 'up' });
  assert.deepEqual(delta(0.3, 0.5, 'rate'), { text: '▼ 20 pts', dir: 'down' });
  assert.deepEqual(delta(0.5, 0.5, 'rate'), { text: 'same', dir: 'flat' });
});

test('delta with a missing side has no text', () => {
  assert.deepEqual(delta(null, 5), { text: '', dir: 'flat' });
  assert.deepEqual(delta(5, undefined), { text: '', dir: 'flat' });
  assert.deepEqual(delta(null, null, 'rate'), { text: '', dir: 'flat' });
});

test('sparkRuns: leading nulls are trimmed, one run, last on the final value', () => {
  assert.deepEqual(sparkRuns([null, null, 2, 3, 4]), { vals: [2, 3, 4], runs: [[0, 1, 2]], last: 2 });
});

test('sparkRuns: a middle null splits into two runs', () => {
  assert.deepEqual(sparkRuns([1, 2, null, 4, 5]), { vals: [1, 2, null, 4, 5], runs: [[0, 1], [3, 4]], last: 4 });
  assert.deepEqual(sparkRuns([1, null, 3]).runs, [[0], [2]]);
});

test('sparkRuns: a trailing null leaves last on the last real value', () => {
  assert.deepEqual(sparkRuns([1, 2, 3, null]), { vals: [1, 2, 3, null], runs: [[0, 1, 2]], last: 2 });
});

test('sparkRuns: nothing real, or not an array, is empty', () => {
  assert.deepEqual(sparkRuns([null, null]), { vals: [], runs: [], last: -1 });
  assert.deepEqual(sparkRuns([]), { vals: [], runs: [], last: -1 });
  assert.deepEqual(sparkRuns(null), { vals: [], runs: [], last: -1 });
  assert.deepEqual(sparkRuns('abc'), { vals: [], runs: [], last: -1 });
});

test('sparkRuns: keeps the last 12 of 14, and the last max when asked', () => {
  const v = Array.from({ length: 14 }, (_, i) => i + 1);
  const r = sparkRuns(v);
  assert.equal(r.vals.length, 12);
  assert.equal(r.vals[0], 3);
  assert.equal(r.vals[11], 14);
  assert.deepEqual(r.runs, [Array.from({ length: 12 }, (_, i) => i)]);
  assert.equal(r.last, 11);
  assert.deepEqual(sparkRuns(v, 3).vals, [12, 13, 14]);
  // a null that falls out of the window is not a gap
  assert.deepEqual(sparkRuns([null, 1, 2, 3], 3), { vals: [1, 2, 3], runs: [[0, 1, 2]], last: 2 });
});

test('sparkRuns: numeric strings count the way num does, junk is a gap', () => {
  assert.deepEqual(sparkRuns(['3', 4, 'x', '', '5']), { vals: [3, 4, null, null, 5], runs: [[0, 1], [4]], last: 4 });
});

test('dayPair: whole numbers, unless two different values would read the same', () => {
  assert.deepEqual(dayPair(9, 8.857), ['9.0', '8.9']);
  assert.deepEqual(dayPair(12.4, 9.6), ['12', '10']);
  assert.deepEqual(dayPair(9, 9), ['9', '9']);
  assert.deepEqual(dayPair(1234.4, 1234.2), ['1,234.4', '1,234.2']);
});

test('dayPair: a missing side is a dash, a real zero stays 0', () => {
  assert.deepEqual(dayPair(null, 3), ['—', '3']);
  assert.deepEqual(dayPair(3, undefined), ['3', '—']);
  assert.deepEqual(dayPair(NaN, Infinity), ['—', '—']);
  assert.deepEqual(dayPair(0, 0), ['0', '0']);
  assert.deepEqual(dayPair(0, null), ['0', '—']);
});

test('formatCount', () => {
  assert.equal(formatCount(null), '–');
  assert.equal(formatCount(undefined), '–');
  assert.equal(formatCount(3410), '3,410');
  assert.equal(formatCount(0), '0');
});

test('ago', () => {
  const at = (ms) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(ago(at(20 * 1000), NOW), 'now');
  assert.equal(ago(at(12 * 60 * 1000), NOW), '12 min');
  assert.equal(ago(at(3 * 3600 * 1000), NOW), '3 h');
  assert.equal(ago(at(2 * 86400 * 1000), NOW), '2 d');
  assert.equal(ago(new Date(NOW.getTime() + 60000).toISOString(), NOW), 'now');
});

test('ago of bad input is empty', () => {
  assert.equal(ago('not a date', NOW), '');
  assert.equal(ago(undefined, NOW), '');
});

test('initials', () => {
  assert.equal(initials('maya.reyes@x.co'), 'MR');
  assert.equal(initials('jo@x.co'), 'JO');
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
});

test('signupRow words what the person made', () => {
  const created_at = new Date(NOW.getTime() - 12 * 60 * 1000).toISOString();
  const base = { user_id: 'u1', email: 'maya.reyes@x.co', acquisition_source: 'tok', created_at };

  const cluster = signupRow({ ...base, clusters_made: 2, first_card_at: '2026-11-01T10:00:00Z' }, NOW, (t) => `via ${t}`);
  assert.equal(cluster.made, 'made a cluster');
  assert.equal(cluster.started, true);
  assert.equal(cluster.from, 'via tok');
  assert.equal(cluster.id, 'u1');
  assert.equal(cluster.initials, 'MR');
  assert.equal(cluster.name, 'maya.reyes@x.co');
  assert.equal(cluster.when, '12 min');

  const card = signupRow({ ...base, clusters_made: 0, first_card_at: '2026-11-01T10:00:00Z' }, NOW);
  assert.equal(card.made, 'made a card');
  assert.equal(card.started, true);

  const none = signupRow({ ...base, clusters_made: 0, first_card_at: null }, NOW);
  assert.equal(none.made, 'hasn’t made anything yet');
  assert.equal(none.started, false);
});

test('signupRow defaults: Direct source and "someone" without an email', () => {
  const r = signupRow({ user_id: 'u2', created_at: NOW.toISOString() }, NOW);
  assert.equal(r.from, 'Direct');
  assert.equal(r.name, 'someone');
});

test('parseNote reads the 72 h note', () => {
  const p = parseNote('At 72 h: #4 490 (0.6×), #5 929 (1.2×), #7 1.3k (1.7×), #9 1k (1.3×).');
  assert.equal(p.hours, 72);
  assert.deepEqual(p.posts.map((x) => x.n), [4, 5, 7, 9]);
  assert.deepEqual(p.posts.map((x) => x.views), [490, 929, 1300, 1000]);
  assert.deepEqual(p.posts.map((x) => x.ratio), [0.6, 1.2, 1.7, 1.3]);
  assert.deepEqual(p.posts.map((x) => x.shown), ['490', '929', '1.3k', '1k']);
});

test('parseNote of anything else is null', () => {
  assert.equal(parseNote(''), null);
  assert.equal(parseNote(null), null);
  assert.equal(parseNote('something else'), null);
  assert.equal(parseNote('At 72 h: nothing readable here'), null);
});

test('noteBars scale against the best post; up means ratio >= 1', () => {
  const bars = noteBars(parseNote('At 72 h: #4 500 (0.6×), #5 1k (1×), #7 250 (1.7×).'));
  assert.deepEqual(bars.map((b) => b.width), [0.5, 1, 0.25]);
  assert.deepEqual(bars.map((b) => b.up), [false, true, true]);
  assert.deepEqual(noteBars(null), []);
});

test('localDate is the local YYYY-MM-DD, zero-padded', () => {
  assert.equal(localDate(NOW), '2026-11-01');
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localDate(new Date(2026, 10, 1, 0, 0)), '2026-11-01');
});

test('unpostedCount counts today\'s posts not marked posted', () => {
  const days = [
    { date: '2026-10-31', posts: [{ n: 1 }, { n: 2 }] },
    { date: '2026-11-01', posts: [{ n: 10 }, { n: 11 }, { n: 12 }] },
  ];
  assert.equal(unpostedCount(days, [], NOW), 3);
  assert.equal(unpostedCount(days, [10], NOW), 2);
  assert.equal(unpostedCount(days, new Set([10, 12]), NOW), 1);
  assert.equal(unpostedCount(days, undefined, NOW), 3);
  assert.equal(unpostedCount(days, [10, 11, 12], NOW), 0);
});

test('unpostedCount compares post numbers as numbers', () => {
  const days = [{ date: '2026-11-01', posts: [{ n: '10' }, { n: '11' }] }];
  assert.equal(unpostedCount(days, [10], NOW), 1);
  assert.equal(unpostedCount(days, new Set([10, 11]), NOW), 0);
});

test('unpostedCount is 0 when there is no day for today', () => {
  assert.equal(unpostedCount([{ date: '2026-10-31', posts: [{ n: 1 }] }], [], NOW), 0);
  assert.equal(unpostedCount([], [], NOW), 0);
  assert.equal(unpostedCount(null, [], NOW), 0);
});

test('dayLabel', () => {
  assert.equal(dayLabel('2026-11-01'), 'Sunday, Nov 1');
  assert.equal(dayLabel('garbage'), 'garbage');
});

test('slideUrl', () => {
  assert.equal(slideUrl('2026-11-01', 'slide-1.png'), '/api/admin/posts/2026-11-01/slide-1.png');
});
