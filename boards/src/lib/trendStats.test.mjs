// trendStats.test.mjs — node --test src/lib/trendStats.test.mjs
//
// The weekly read prints a sentence a person will act on ("Up 6 of the last 7
// weeks, steady"), so every sentence it can print is pinned here, and every
// number behind one was worked out by hand first: the rank statistic S, its
// tie groups and variance, the one-sided p, the median pairwise slope, the
// noise floor. A worked number is written in a comment directly above the
// assertion that checks it, so a red test says which side of the arithmetic
// moved. None of them was produced by running the module and copying its
// answer back in.
//
// Weeks are consecutive UTC Mondays from 2026-06-01 unless a test says
// otherwise: W(0) = 06-01, W(1) = 06-08, W(2) = 06-15, W(3) = 06-22,
// W(4) = 06-29, W(5) = 07-06, W(6) = 07-13, W(7) = 07-20, ... Every count is
// synthetic, because this repo is public and real figures do not belong in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, breaksFor } from './weeklySeries.js';
import {
  EXACT_MAX_N, Z_90_ONE_SIDED,
  exactTailP, normalCdf, mannKendall, theilSen, weekDelta, weeklyTrend,
} from './trendStats.js';

const close = (actual, expected, eps, what = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what} ${actual} is not within ${eps} of ${expected}`);

// W(i) is the i-th Monday from 2026-06-01; a series of values becomes complete,
// measurable weeks from W(0) on, with null for a week that has no reading.
const W = (i) => addDays('2026-06-01', 7 * i);
const pointsOf = (values, from = 0) => values.map((value, i) => ({
  week: W(from + i), value, measurable: true, complete: true, settling: false,
}));
const read = (values, opts) => weeklyTrend(pointsOf(values), opts);
const dirs = (t) => t.steps.map((st) => st.dir);

// A seeded generator (the Numerical Recipes LCG), so a property runs the same
// series on every machine and every run. Never Math.random.
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

// The brief's vectors, by number (#13 and #21 as amended; their original values
// are kept below as pinned cases of their own).
const V1 = [10, 12, 15, 17, 18, 21, 25, 30];
const V2 = [8, 10, 13, 12, 15, 18, 22, 26];
const V4 = [10, 11, 10, 30, 11, 10, 11, 10];
const V5 = [10, 10, 11, 10, 20, 21, 20, 21];
const V12 = [10, 12, null, 15, 16, 18, null, 22];
const V13 = [0, 1, 1, 1, 3, 3, 3, 5];
const V15 = [300, 310, 290, 305, 700, 300, 310, 295];
const V16 = Array(8).fill(12);
const V18 = [10, 11, 10, 12, 11, 10, 11, 22];

// ── exactTailP: the exact null distribution of S ──────────────────────────
// Untied, S = N - 2I with N = n(n-1)/2 and I the number of inversions, whose
// counts are the Mahonian numbers. The rows used below:
//   n = 4: 1, 3, 5, 6, 5, 3, 1                          (sum 24 = 4!)
//   n = 5: 1, 4, 9, 15, 20, 22, ...                     (of 120)
//   n = 6: 1, 5, 14, 29, ...                            (of 720)
//   n = 7: 1, 6, 20, ...                                (of 5040)
//   n = 8: 1, 7, 27, 76, 174, 343, 602, 961, ...        (of 40320)
// P(S >= s) = (sum of the first floor((N - s)/2) + 1 of them) / n!.
test('exactTailP: the anchors, each a sum of Mahonian numbers over n!', () => {
  // n = 8, N = 28. s = 16 -> I <= 6: 1+7+27+76+174+343+602 = 1230.
  close(exactTailP(8, 16), 1230 / 40320, 1e-12, '(8,16)'); // 0.0305
  // s = 14 -> I <= 7: 1230 + 961 = 2191.
  close(exactTailP(8, 14), 2191 / 40320, 1e-12, '(8,14)'); // 0.0543
  // n = 5, N = 10. s = 8 -> I <= 1: 1 + 4 = 5.
  close(exactTailP(5, 8), 5 / 120, 1e-12, '(5,8)'); // 0.0417
  // n = 4, N = 6. s = 6 -> I = 0 only: the one perfectly ordered permutation.
  close(exactTailP(4, 6), 1 / 24, 1e-12, '(4,6)'); // 0.0417
  // n = 6, N = 15. s = 11 -> I <= 2: 1 + 5 + 14 = 20.
  close(exactTailP(6, 11), 20 / 720, 1e-12, '(6,11)'); // 0.0278
  // n = 8, s = N = 28: only the identity permutation.
  close(exactTailP(8, 28), 1 / 40320, 1e-15, '(8,28)');
});

test('exactTailP: the whole n = 4 distribution, tail by tail', () => {
  // Cumulative Mahonian counts for n = 4: 1, 4, 9, 15, 20, 23, 24.
  const tails = [6, 4, 2, 0, -2, -4, -6].map((s) => exactTailP(4, s) * 24);
  tails.forEach((count, i) => close(count, [1, 4, 9, 15, 20, 23, 24][i], 1e-9, `s=${6 - 2 * i}`));
});

test('exactTailP: every S is at least -N and at most N, and the null is symmetric', () => {
  for (let n = 1; n <= EXACT_MAX_N; n += 1) {
    const N = (n * (n - 1)) / 2;
    close(exactTailP(n, -N), 1, 1e-12, `n=${n} P(S >= -N)`);
    assert.equal(exactTailP(n, N + 1), 0, `n=${n} P(S > N)`);
    // S moves in steps of 2, so P(S >= s) and P(S <= s - 2) = P(S >= 2 - s) partition it.
    for (let s = -N; s <= N; s += 2) {
      close(exactTailP(n, s) + exactTailP(n, 2 - s), 1, 1e-12, `n=${n} s=${s}`);
    }
  }
});

test('exactTailP: outside its domain it says null instead of an approximation', () => {
  // 13! is past the point where the exact table is the right tool; mannKendall
  // switches to the normal there, and a caller asking anyway gets no number.
  assert.equal(exactTailP(EXACT_MAX_N + 1, 0), null);
  for (const n of [-1, 2.5, NaN, '8', null, undefined]) {
    assert.equal(exactTailP(n, 0), null, String(n));
  }
  assert.equal(exactTailP(8, NaN), null);
});

// ── normalCdf: the one distribution function the module needs ────────────
// Abramowitz-Stegun 7.1.26 is good to 1.5e-7 on erf, so 7.5e-8 on Phi; the
// reference values are the textbook ones, and the two quantiles are rounded to
// six places, which moves Phi by under 1e-7 more.
test('normalCdf matches the standard normal where the verdicts are decided', () => {
  close(normalCdf(0), 0.5, 2e-7, 'Phi(0)');
  close(normalCdf(1), 0.8413447, 2e-7, 'Phi(1)');
  close(normalCdf(Z_90_ONE_SIDED), 0.95, 2e-7, 'Phi(1.644854)');
  close(normalCdf(1.959964), 0.975, 2e-7, 'Phi(1.959964)');
  close(normalCdf(-1.959964), 0.025, 2e-7, 'Phi(-1.959964)');
  close(normalCdf(3), 0.9986501, 2e-7, 'Phi(3)');
});

test('normalCdf is symmetric: Phi(-z) = 1 - Phi(z)', () => {
  for (const z of [0.25, 1.1818, 2.3303, 4]) close(normalCdf(-z) + normalCdf(z), 1, 1e-12, `z=${z}`);
});

// ── mannKendall: does later tend to be higher than earlier? ───────────────
// S = sum over pairs i < j of sgn(x_j - x_i). Var = [n(n-1)(2n+5) - sum over tie
// groups of t(t-1)(2t+5)] / 18; for n = 8 the first term is 8*7*21 = 1176.
test('mannKendall, untied and short: the exact null, not the normal', () => {
  // #1: 10,12,15,17,18,21,25,30. All 28 pairs rise: S = 28. Var = 1176/18 = 65.33.
  // Exact P(S >= 28) = 1/8! = 1/40320 = 2.48e-5; the other side, P(S >= -28), is 1.
  const mk = mannKendall([10, 12, 15, 17, 18, 21, 25, 30]);
  assert.equal(mk.n, 8);
  assert.equal(mk.S, 28);
  close(mk.varS, 1176 / 18, 1e-9, 'varS');
  assert.equal(mk.method, 'exact');
  assert.deepEqual(mk.ties, []);
  close(mk.pUp, 1 / 40320, 1e-12, 'pUp');
  close(mk.pDown, 1, 1e-12, 'pDown');
  close(mk.p, 1 / 40320, 1e-4, 'p');
  assert.equal(mk.dir, 'up');
});

test('mannKendall, tied: the tie groups shrink the variance and the normal takes over', () => {
  // #17: 10,10,12,12,12,14,14,15. Tie groups in value order: 10 x2, 12 x3, 14 x2.
  // S by first index (a tie scores 0): i0 +6, i1 +6, i2 +3, i3 +3, i4 +3, i5 +1, i6 +1 = 23.
  // Var = [1176 - (2*1*9 + 3*2*11 + 2*1*9)] / 18 = (1176 - 102) / 18 = 1074/18 = 59.667
  // z = (23 - 1) / sqrt(59.667) = 22 / 7.7244 = 2.8481;  p = 1 - Phi(2.8481) = 0.0022
  const mk = mannKendall([10, 10, 12, 12, 12, 14, 14, 15]);
  assert.equal(mk.method, 'normal');
  assert.deepEqual(mk.ties, [2, 3, 2]);
  assert.equal(mk.S, 23);
  close(mk.varS, 1074 / 18, 1e-9, 'varS');
  close(mk.z, 2.8481, 1e-3, 'z');
  close(mk.p, 0.0022, 0.002, 'p');
  assert.equal(mk.dir, 'up');
});

test('mannKendall: one tie anywhere sends even a four-week series to the normal', () => {
  const mk = mannKendall([10, 12, 12, 15]);
  assert.equal(mk.method, 'normal');
  assert.deepEqual(mk.ties, [2]);
});

test('mannKendall: past EXACT_MAX_N an untied series uses the normal', () => {
  // 1..13: all 78 pairs rise, S = 78. Var = 13*12*31/18 = 4836/18 = 268.67,
  // z = 77 / sqrt(268.67) = 4.698.
  const mk = mannKendall(Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(mk.method, 'normal');
  assert.equal(mk.S, 78);
  close(mk.z, 77 / Math.sqrt(4836 / 18), 1e-9, 'z');
  assert.ok(mk.p < 1e-5, `p ${mk.p}`);
});

test('mannKendall: with nothing to rank it is degenerate, p = 1 and no direction', () => {
  // Twelve every week (#16) is one tie group of 8: 8*7*21 - 8*7*21 = 0, so Var = 0.
  for (const xs of [[], [5], [12, 12, 12, 12, 12, 12, 12, 12]]) {
    const mk = mannKendall(xs);
    assert.equal(mk.method, 'degenerate', JSON.stringify(xs));
    assert.equal(mk.S, 0);
    assert.equal(mk.varS, 0);
    assert.equal(mk.z, 0);
    assert.equal(mk.p, 1);
    assert.equal(mk.dir, 'none');
  }
  assert.deepEqual(mannKendall([12, 12, 12, 12, 12, 12, 12, 12]).ties, [8]);
});

test('mannKendall: S = 0 has no direction, and S = -1 under the normal is z = 0, p = 0.5', () => {
  // #15: 300,310,290,305,700,300,310,295. By first index: i0 +4-2 = +2, i1 +1-4 = -3,
  // i2 +5, i3 +2-2 = 0, i4 -3, i5 +1-1 = 0, i6 -1. S = 0, so z = 0 and p = 0.5.
  const flat = mannKendall([300, 310, 290, 305, 700, 300, 310, 295]);
  assert.equal(flat.S, 0);
  assert.equal(flat.z, 0);
  close(flat.p, 0.5, 1e-7, 'p');
  assert.equal(flat.dir, 'none');
  // #4: 10,11,10,30,11,10,11,10. By first index: +4, -2, +3, -4, -2, +1, -1 = -1.
  // The continuity correction takes S - sgn(S) = 0, so z = 0, pUp = pDown = 0.5;
  // the direction is S's own sign, and at p = 0.5 nothing is ever read into it.
  const dip = mannKendall([10, 11, 10, 30, 11, 10, 11, 10]);
  assert.equal(dip.S, -1);
  assert.equal(dip.z, 0);
  close(dip.p, 0.5, 1e-7, 'p');
  assert.equal(dip.dir, 'down');
});

test('mannKendall: a gap is skipped, never ranked as a zero', () => {
  assert.deepEqual(mannKendall([10, null, 12, undefined, 15, NaN]), mannKendall([10, 12, 15]));
});

test('mannKendall: reversing time negates S, adding a constant changes nothing', () => {
  for (const xs of [[10, 12, 15, 17, 18, 21, 25, 30], [10, 10, 11, 10, 20, 21, 20, 21], [5, 6, 8, 11, 14, 14, 13, 14]]) {
    const mk = mannKendall(xs);
    assert.equal(mannKendall([...xs].reverse()).S, -mk.S, JSON.stringify(xs));
    const lifted = mannKendall(xs.map((x) => x + 100));
    assert.equal(lifted.S, mk.S);
    assert.equal(lifted.p, mk.p);
  }
});

test('at n = 12 the exact tail and the continuity-corrected normal agree within 0.02', () => {
  // N = 66, so S is even. Var = 12*11*29/18 = 3828/18 = 212.67. The largest gap
  // over S = 2..66 is about 0.004 (at S = 12). S = 0 is left out on purpose: the
  // exact P(S >= 0) includes half the central atom P(S = 0) (about 0.053), so it
  // is 0.527 against the normal's 0.5, and both of those mean "no evidence".
  const sd = Math.sqrt(3828 / 18);
  for (let s = 2; s <= 66; s += 2) {
    const normal = 1 - normalCdf((s - 1) / sd);
    close(exactTailP(12, s), normal, 0.02, `S=${s}`);
  }
});

// ── theilSen: how much, robustly ──────────────────────────────────────────
test('theilSen: the median of every pairwise slope, on calendar weeks with holes', () => {
  // #12's usable weeks: x = 10,12,15,16,18,22 at t = 0,1,3,4,5,7 (weeks 2 and 6 missing).
  // The 15 slopes (x_j - x_i) / (t_j - t_i), by first point:
  //   t0: 2, 5/3, 6/4, 8/5, 12/7     t1: 3/2, 4/3, 6/4, 10/6     t3: 1, 3/2, 7/4
  //   t4: 2, 6/3                     t5: 4/2
  // sorted: 1, 4/3, 3/2, 3/2, 3/2, 3/2, 8/5, [5/3], 5/3, 12/7, 7/4, 2, 2, 2, 2
  // perWeek = the 8th = 5/3; rise = 5/3 * (7 - 0) = 35/3 = 11.667.
  const ts = theilSen([10, 12, 15, 16, 18, 22], [0, 1, 3, 4, 5, 7]);
  close(ts.perWeek, 5 / 3, 1e-12, 'perWeek');
  close(ts.rise, 35 / 3, 1e-9, 'rise');
  assert.equal(ts.pairs, 15);
});

test('theilSen: an even count of slopes takes the mean of the middle two; t defaults to 0, 1, 2, ...', () => {
  // 10,12,15,18: slopes 2, 5/2, 8/3 (from t0), 3, 3 (from t1), 3 (from t2).
  // sorted 2, 5/2, [8/3, 3], 3, 3 -> perWeek = (8/3 + 3) / 2 = 17/6; rise = 17/6 * 3 = 8.5.
  const ts = theilSen([10, 12, 15, 18]);
  close(ts.perWeek, 17 / 6, 1e-12, 'perWeek');
  close(ts.rise, 8.5, 1e-9, 'rise');
  assert.equal(ts.pairs, 6);
});

test('theilSen: one enormous week does not drag the slope', () => {
  // 10,11,12,100,14,15: the ten pairs that avoid the 100 all have slope 1; the
  // five through it are 30, 44.5, 88, -86, -42.5. Sorted, the 8th of 15 is still 1.
  const ts = theilSen([10, 11, 12, 100, 14, 15]);
  assert.equal(ts.perWeek, 1);
  close(ts.rise, 5, 1e-12, 'rise');
});

test('theilSen: fewer than two weeks have no slope, and a gap is not a week', () => {
  for (const xs of [[], [7]]) assert.deepEqual(theilSen(xs), { perWeek: null, rise: null, pairs: 0 });
  assert.deepEqual(theilSen([7, null], [0, 1]), { perWeek: null, rise: null, pairs: 0 });
});

// ── weekDelta: one week against the one before, without overclaiming ─────
// For counts, the difference of two Poisson weeks has sd sqrt(cur + prev), so
// z = (cur - prev) / sqrt(cur + prev) and anything inside the one-sided 90%
// line (1.644854) is flat. Text is the signed percentage, rounded.
test('weekDelta: a difference inside the noise reads flat, and keeps its percentage', () => {
  // 40 vs 30: z = 10 / sqrt(70) = 1.195 < 1.644854; 100 * 10 / 30 = 33.3 -> '+33%'.
  assert.deepEqual(weekDelta(40, 30), { dir: 'flat', noise: true, z: 10 / Math.sqrt(70), text: '+33%' });
});

test('weekDelta: a difference past the one-sided 90% line keeps its direction', () => {
  // 25 vs 12: z = 13 / sqrt(37) = 2.137; 100 * 13 / 12 = 108.3 -> '+108%'.
  assert.deepEqual(weekDelta(25, 12), { dir: 'up', z: 13 / Math.sqrt(37), text: '+108%' });
  // 12 vs 25: z = -2.137; 100 * -13 / 25 = -52 -> '-52%'.
  assert.deepEqual(weekDelta(12, 25), { dir: 'down', z: -13 / Math.sqrt(37), text: '-52%' });
});

test('weekDelta: under ten events across the two weeks is too thin to compare', () => {
  assert.deepEqual(weekDelta(3, 1), { dir: 'thin', n: 4, text: '+2' });
  assert.deepEqual(weekDelta(7, 0), { dir: 'thin', n: 7, text: '+7' });
  assert.deepEqual(weekDelta(1, 4), { dir: 'thin', n: 5, text: '-3' });
  assert.deepEqual(weekDelta(0, 0), { dir: 'thin', n: 0, text: '+0' });
});

test('weekDelta: exactly ten events is enough to compare', () => {
  // 6 vs 4: z = 2 / sqrt(10) = 0.63, noise; 100 * 2 / 4 = 50 -> '+50%'.
  assert.deepEqual(weekDelta(6, 4), { dir: 'flat', noise: true, z: 2 / Math.sqrt(10), text: '+50%' });
});

test('weekDelta: from zero to plenty is new, never +Infinity%', () => {
  assert.deepEqual(weekDelta(70, 0), { dir: 'up', text: 'new' });
});

test('weekDelta: no change at all is flat, and not noise', () => {
  assert.deepEqual(weekDelta(30, 30), { dir: 'flat', z: 0, text: '+0%' });
});

test('weekDelta: a side that is missing or not a number is no comparison', () => {
  for (const [cur, prev] of [[null, 5], [5, null], [NaN, 5], [5, undefined], ['5', 4]]) {
    assert.equal(weekDelta(cur, prev), null, `${cur} vs ${prev}`);
  }
});

test("weekDelta kind 'exact': a ledger has no sampling noise, so no gate and no noise key", () => {
  assert.deepEqual(weekDelta(1200, 1000, { kind: 'exact' }), { dir: 'up', text: '+20%' });
  assert.deepEqual(weekDelta(900, 1000, { kind: 'exact' }), { dir: 'down', text: '-10%' });
  assert.deepEqual(weekDelta(1000, 1000, { kind: 'exact' }), { dir: 'flat', text: '+0%' });
  assert.deepEqual(weekDelta(3, 1, { kind: 'exact' }), { dir: 'up', text: '+200%' }); // no thin gate
  assert.deepEqual(weekDelta(500, 0, { kind: 'exact' }), { dir: 'up', text: 'new' });
  // Below a zero base there is no percentage to print, so the difference itself is the text.
  assert.deepEqual(weekDelta(-5, 0, { kind: 'exact' }), { dir: 'down', text: '-5' });
});

// ── weeklyTrend: which weeks are scored ───────────────────────────────────
test('a point that cannot be measured is excluded with its reason, and the window starts after it', () => {
  // #11: five weeks before the counter existed, then 8,10,13,12,15,18,22.
  const before = [0, 1, 2, 3, 4].map((i) => ({ week: W(i), value: null, measurable: false, complete: true, settling: false }));
  const t = weeklyTrend([...before, ...pointsOf([8, 10, 13, 12, 15, 18, 22], 5)]);
  const excluded = [0, 1, 2, 3, 4].map((i) => ({ week: W(i), reason: 'unmeasurable' }));
  // 8 + 10 + 13 + 12 + 15 + 18 + 22 = 98, over W(5) = 07-06 .. W(11) = 08-17.
  assert.deepEqual(t.window, {
    from: '2026-07-06', to: '2026-08-17', n: 7, calendarWeeks: 7, gaps: 0, sum: 98, excluded,
  });
  assert.equal(t.steps.length, 6);
  assert.equal(t.thisWeek, null);
  assert.equal(t.caveat, null);
});

test('a week with no reading stays in the calendar as a gap, and so do the steps either side of it', () => {
  // #12: 10, 12, -, 15, 16, 18, -, 22. Six usable of eight calendar weeks; 10+12+15+16+18+22 = 93.
  const t = read(V12);
  assert.deepEqual(t.window, {
    from: '2026-06-01', to: '2026-07-20', n: 6, calendarWeeks: 8, gaps: 2, sum: 93, excluded: [],
  });
  assert.deepEqual(t.steps, [
    { week: '2026-06-08', from: 10, to: 12, dir: 1, settling: false },
    { week: '2026-06-15', from: 12, to: null, dir: null, settling: false },
    { week: '2026-06-22', from: null, to: 15, dir: null, settling: false },
    { week: '2026-06-29', from: 15, to: 16, dir: 1, settling: false },
    { week: '2026-07-06', from: 16, to: 18, dir: 1, settling: false },
    { week: '2026-07-13', from: 18, to: null, dir: null, settling: false },
    { week: '2026-07-20', from: null, to: 22, dir: null, settling: false },
  ]);
  assert.deepEqual(t.counts, { up: 3, down: 0, flat: 0, gaps: 4, total: 3 });
  // The slope keeps the holes in t: the theilSen case above, rise = 35/3.
  close(t.slope.rise, 35 / 3, 0.01, 'rise');
});

test('a week missing from the rows altogether is the same gap as a week with no reading', () => {
  const t = weeklyTrend(pointsOf(V1).filter((p) => p.week !== '2026-06-22'));
  assert.equal(t.window.calendarWeeks, 8);
  assert.equal(t.window.n, 7);
  assert.equal(t.window.gaps, 1);
  assert.deepEqual(dirs(t), [1, 1, null, null, 1, 1, 1]);
});

test('a step is a literal record dated by its newer week: an exact tie is flat, however small the counts', () => {
  const t = read(V13);
  assert.deepEqual(dirs(t), [1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(t.steps[0], { week: '2026-06-08', from: 0, to: 1, dir: 1, settling: false });
  assert.deepEqual(t.counts, { up: 3, down: 0, flat: 4, gaps: 0, total: 7 });
});

test('the streak is the run at the newest end, and any other step ends it', () => {
  assert.deepEqual(read(V1).streak, { dir: 'up', len: 7 });
  assert.deepEqual(read(V2).streak, { dir: 'up', len: 4 }); // + + - + + + +
  assert.deepEqual(read([30, 27, 24, 26, 19, 16, 14, 11]).streak, { dir: 'down', len: 4 }); // - - + - - - -
  assert.deepEqual(read(V16).streak, { dir: 'flat', len: 7 });
  assert.deepEqual(read([10, 12, 12, 12]).streak, { dir: 'flat', len: 2 });
  assert.deepEqual(read(V12).streak, { dir: 'none', len: 0 }); // the newest step has a gap in it
});

test('weeks before the latest definition break are cut, and the read says how many weeks it has since', () => {
  // #22: #1 with a break at W(6) = 07-13. W(0)..W(5) go; 25 and 30 are all that is left.
  const t = read(V1, { breaks: [{ week: '2026-07-13' }] });
  assert.deepEqual(t.window.excluded, [0, 1, 2, 3, 4, 5].map((i) => ({ week: W(i), reason: 'break' })));
  assert.equal(t.window.n, 2);
  assert.equal(t.caveat, 'Definition changed 2026-07-13; 2 weeks since');
});

test('the caveat names the day the change happened, and only the latest real break cuts', () => {
  const t = read(V1, { breaks: [null, { week: 'soon' }, { week: '2026-07-13', date: '2026-07-09' }, { week: '2026-06-15' }] });
  assert.equal(t.window.excluded.length, 6);
  assert.equal(t.caveat, 'Definition changed 2026-07-09; 2 weeks since');
});

test('the caveat stays while the break is inside the scored history and drops once a full window has passed', () => {
  const rising = Array.from({ length: 12 }, (_, i) => 10 + 2 * i); // W(0)..W(11)
  // A change on Thursday 07-02 cuts at W(5) = 07-06: W(5)..W(11) is 7 usable weeks, under the window of 8.
  const seven = read(rising, { breaks: [{ week: '2026-07-06', date: '2026-07-02' }] });
  assert.equal(seven.caveat, 'Definition changed 2026-07-02; 7 weeks since');
  // A change on 06-25 cuts at W(4) = 06-29: 8 usable weeks since, a whole window, so the
  // timeline marker alone records it. The cut itself still applies.
  const eight = read(rising, { breaks: [{ week: '2026-06-29', date: '2026-06-25' }] });
  assert.equal(eight.caveat, null);
  assert.equal(eight.window.excluded.length, 4);
  assert.equal(eight.window.from, '2026-06-29');
});

test('end to end: the did_work fix cuts at its Monday, and the caveat prints its Thursday', () => {
  // breaksFor('work_users') cuts at 2026-10-05 for a change made on 2026-10-01.
  // W(14) = 09-07 .. W(21) = 10-26: the four weeks before 10-05 go, four remain.
  const t = weeklyTrend(pointsOf([10, 11, 12, 13, 14, 15, 16, 17], 14), { breaks: breaksFor('work_users') });
  assert.deepEqual(t.window.excluded.map((e) => e.reason), ['break', 'break', 'break', 'break']);
  assert.equal(t.window.from, '2026-10-05');
  assert.equal(t.caveat, 'Definition changed 2026-10-01; 4 weeks since');
});

test('a week with no reading after the change is not a week of history since it', () => {
  // Cut at W(5); W(5)..W(11) is seven rows, but W(9) has no reading: six weeks since.
  const rising = Array.from({ length: 12 }, (_, i) => (i === 9 ? null : 10 + 2 * i));
  assert.equal(read(rising, { breaks: [{ week: '2026-07-06' }] }).caveat, 'Definition changed 2026-07-06; 6 weeks since');
});

test('a point that does not say it is complete, or measurable, is not scored', () => {
  // Absent flags read the cautious way (as weeklySeries' rows do): not complete,
  // not measurable. Neither kind of week can be scored as if it had said so.
  const t = weeklyTrend([
    ...pointsOf([10, 12, 15, 17]),
    { week: W(4), value: 18, complete: true },
    { week: W(5), value: 21, measurable: true },
  ]);
  assert.deepEqual(t.window.excluded, [
    { week: '2026-06-29', reason: 'unmeasurable' },
    { week: '2026-07-06', reason: 'incomplete' },
  ]);
  assert.deepEqual(t.thisWeek, { week: '2026-07-06', value: 21 });
  assert.equal(t.window.n, 4);
});

test('the week still in progress is never scored; the latest one is thisWeek', () => {
  // #23: #1 plus this week so far.
  const t = weeklyTrend([...pointsOf(V1), { week: W(8), value: 4, measurable: true, complete: false, settling: true }]);
  const base = read(V1);
  assert.deepEqual(t.thisWeek, { week: '2026-07-27', value: 4 });
  assert.deepEqual(t.window, { ...base.window, excluded: [{ week: '2026-07-27', reason: 'incomplete' }] });
  assert.deepEqual(t.steps, base.steps);
  assert.deepEqual(t.mk, base.mk);
  assert.deepEqual(t.slope, base.slope);
  // Two incomplete weeks (junk, but possible): neither is scored, the later one is reported.
  const two = weeklyTrend([
    ...pointsOf(V1),
    { week: W(8), value: 4, measurable: true, complete: false },
    { week: W(9), value: null, measurable: true, complete: false },
  ]);
  assert.deepEqual(two.thisWeek, { week: '2026-08-03', value: null });
  assert.deepEqual(two.window.excluded.map((e) => e.reason), ['incomplete', 'incomplete']);
  assert.deepEqual(two.steps, base.steps);
});

test('only the last eight calendar weeks are scored', () => {
  // #25: 10, 12, ..., 34 over W(0)..W(12). The window is W(5)..W(12): 20..34, sum 216.
  const t = read(Array.from({ length: 13 }, (_, i) => 10 + 2 * i));
  assert.equal(t.window.calendarWeeks, 8);
  assert.equal(t.window.from, '2026-07-06');
  assert.equal(t.window.to, '2026-08-24');
  assert.equal(t.window.sum, 216);
  assert.equal(t.steps.length, 7);
  assert.equal(t.steps[0].week, '2026-07-13');
});

test('a week with no row still counts as one of the eight calendar weeks', () => {
  // W(0)..W(9) with no row at all for W(5): the window is W(2)..W(9), eight calendar
  // weeks holding seven readings. Counting rows instead would reach back to W(1).
  const t = weeklyTrend(pointsOf([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]).filter((p) => p.week !== W(5)));
  assert.equal(t.window.from, '2026-06-15');
  assert.equal(t.window.calendarWeeks, 8);
  assert.equal(t.window.n, 7);
  assert.equal(t.window.gaps, 1);
});

test('at the oldest edge of the window, a missing row and a row with no reading are the same gap', () => {
  // The reviewer's probe: W(0)..W(9) = 10 + 4i, so the window is W(2)..W(9), and W(2) has no
  // reading: once as a null row, once with no row at all. Either way it is eight calendar weeks
  // holding seven readings, 22..46: S = 21, exact p = 1/5040; every slope is 4, rise =
  // 4 * (7 - 1) = 24; baseline = median(22,26,30) = 26, endLevel = median(38,42,46) = 42,
  // floor = 2 * sqrt(68) = 16.49: clears; one week is missing.
  const rows = pointsOf(Array.from({ length: 10 }, (_, i) => 10 + 4 * i));
  const nulled = rows.map((p) => (p.week === W(2) ? { ...p, value: null } : p));
  const removed = rows.filter((p) => p.week !== W(2));
  for (const t of [weeklyTrend(nulled), weeklyTrend(removed)]) {
    assert.equal(t.window.from, '2026-06-15');
    assert.equal(t.window.calendarWeeks, 8);
    assert.equal(t.window.gaps, 1);
    close(t.slope.rise, 24, 0.01, 'rise');
    assert.equal(t.verdict.label, 'Up 6 of 6 measured weeks, 1 missing');
  }
});

test('only the newest step can be settling, and only when its own week is', () => {
  // #24: #1 with the newest week still settling.
  const pts = pointsOf(V1);
  pts[7] = { ...pts[7], settling: true };
  assert.deepEqual(weeklyTrend(pts).steps.map((st) => st.settling), [false, false, false, false, false, false, true]);
  pts[7] = { ...pts[7], settling: false };
  pts[6] = { ...pts[6], settling: true };
  assert.ok(weeklyTrend(pts).steps.every((st) => st.settling === false));
});

test('the slope, its level and its noise floor', () => {
  // #1. The 28 pairwise slopes, sorted: 1, 3/2, 2 (x6), 11/5, 9/4, 7/3, then 5/2 at
  // positions 12-15, so the 14th and 15th are both 5/2: perWeek = 2.5, rise = 2.5 * 7 = 17.5.
  // level = median of all eight = (17 + 18) / 2 = 17.5; baseline = median(10,12,15,17) = 13.5;
  // endLevel = median(18,21,25,30) = 23; floor = 2 * sqrt(13.5 + 23) = 2 * sqrt(36.5) = 12.083;
  // 17.5 >= 12.083 clears.
  const { slope } = read(V1);
  close(slope.perWeek, 2.5, 1e-12, 'perWeek');
  close(slope.rise, 17.5, 0.01, 'rise');
  assert.equal(slope.level, 17.5);
  close(slope.pctOfLevelPerWeek, (100 * 2.5) / 17.5, 1e-9, 'pct');
  assert.equal(slope.baseline, 13.5);
  assert.equal(slope.endLevel, 23);
  close(slope.floor, 2 * Math.sqrt(36.5), 1e-9, 'floor');
  assert.equal(slope.floorKind, 'poisson');
  assert.equal(slope.clears, true);
  assert.equal(mannKendall(V1).S, read(V1).mk.S);
  assert.deepEqual(Object.keys(read(V1).mk).sort(), ['S', 'dir', 'method', 'p', 'varS', 'z']);
});

test('a near-zero series gets the MIN_BASE floor, and a zero level has no percentage', () => {
  // 0,0,0,0,1,1,1,1: baseline = median(0,0,0,0) = 0 and endLevel = median(1,1,1,1) = 1, each
  // raised to MIN_BASE 2: floor = 2 * sqrt(2 + 2) = 4.
  // level = (0 + 1) / 2 = 0.5. With level 0 (all zeros) there is nothing to be a percentage of.
  close(read([0, 0, 0, 0, 1, 1, 1, 1]).slope.floor, 4, 1e-12, 'floor');
  assert.equal(read(Array(8).fill(0)).slope.pctOfLevelPerWeek, null);
});

test("dispersion 'mad': the floor comes from the week-to-week differences, which one import barely moves", () => {
  // #15 (cards). Differences: 10, -20, 15, 395, -400, 10, -15; their median is 10.
  // |d - 10|: 0, 30, 5, 385, 410, 0, 25 -> sorted 0, 0, 5, [25], 30, 385, 410: MAD = 25.
  // floor = 2 * 1.4826 * 25 = 74.13.
  const { slope } = read(V15, { dispersion: 'mad' });
  close(slope.floor, 2 * 1.4826 * 25, 1e-9, 'floor');
  assert.equal(slope.floorKind, 'mad');
});

test("dispersion 'mad' falls back to Poisson with no spread to measure or too few differences", () => {
  // #16: every difference is 0, so MAD = 0. Poisson, both ends 12: 2 * sqrt(12 + 12) = 9.798.
  const flat = read(V16, { dispersion: 'mad' }).slope;
  assert.equal(flat.floorKind, 'poisson');
  close(flat.floor, 2 * Math.sqrt(24), 1e-9, 'flat floor');
  // Gaps break differences: 10 -> 12 and 14 -> 20 are the only adjacent readings, and
  // two differences are under 3 even though their MAD (|2 - 4| and |6 - 4| -> 2) is not 0.
  // Poisson over the readings 10,12,14,20,16: baseline = median(10, 12) = 11,
  // endLevel = median(20, 16) = 18 (14, the middle one, is in neither half): 2 * sqrt(29) = 10.770.
  const sparse = read([10, 12, null, 14, 20, null, null, 16], { dispersion: 'mad' }).slope;
  assert.equal(sparse.floorKind, 'poisson');
  close(sparse.floor, 2 * Math.sqrt(29), 1e-9, 'sparse floor');
});

test('a spike is an isolated week, well above both of its neighbours', () => {
  // #4: median 10.5, bar 3 * sqrt(10.5) = 9.72; 30 - max(10, 11) = 19 > 9.72.
  assert.deepEqual(read(V4).spikes, [{ week: '2026-06-22', value: 30 }]);
  // #15: median 302.5, bar 3 * sqrt(302.5) = 52.18; 700 - max(305, 300) = 395.
  assert.deepEqual(read(V15).spikes, [{ week: '2026-06-29', value: 700 }]);
  // #18: an endpoint has one neighbour. Median 11, bar 3 * sqrt(11) = 9.95; 22 - 11 = 11.
  assert.deepEqual(read(V18).spikes, [{ week: '2026-07-20', value: 22 }]);
  // A neighbour is the nearest week WITH a reading: 30's are the 10s two weeks either side.
  // Usable 10,30,10,11,10,11: median 10.5, bar 9.72; 30 - 10 = 20.
  assert.deepEqual(read([10, null, 30, null, 10, 11, 10, 11]).spikes, [{ week: '2026-06-15', value: 30 }]);
});

test('the top of a clean rise is not a spike, and neither is a step change', () => {
  // #2: 26 against the median (14) would clear 14 + 3 * sqrt(14) = 25.22, which is why
  // the rule is neighbours: 26 - 22 = 4 < 3 * sqrt(14) = 11.22.
  assert.deepEqual(read(V2).spikes, []);
  // #5: 20 sits next to 21; a level that holds is a shift, not a spike.
  assert.deepEqual(read(V5).spikes, []);
});

test('nothing usable is an empty read, not an error', () => {
  for (const junk of [null, undefined, [], [{}], [null, 7, 'x'], 'weeks']) {
    const t = weeklyTrend(junk);
    assert.equal(t.window.n, 0, JSON.stringify(junk));
    assert.deepEqual(t.steps, []);
    assert.equal(t.thisWeek, null);
    assert.deepEqual(t.window.excluded, []);
  }
});

// ── weeklyTrend: the verdict ──────────────────────────────────────────────
// Each case lists what decides it, in the order the tree asks: usable weeks, the
// window total, the one-sided p, the rise against the floor, then the shape
// checks (one step carrying the move, rose-then-flat), then the counts.
// rise is perWeek * (t_last - t_first), perWeek the median pairwise slope;
// floor = 2 * sqrt(max(baseline, 2) + max(endLevel, 2)), with baseline and endLevel
// the medians of the first and of the last floor(n/2) usable weeks.

test('#1 rising clean: up every week, certain, and well clear of the floor', () => {
  // S = 28, untied: exact p = 1/40320 = 2.48e-5. rise 17.5 >= floor 12.08 (the slope
  // test above); sum 148 >= 10: solid. No shift: the largest rise, 25 -> 30, is
  // 5 of the 20. No plateau: the last four (18,21,25,30) still rise.
  // u = 7 >= 0.7 * 7 = 4.9 and d = 0: steady.
  const t = read(V1);
  assert.deepEqual(dirs(t), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(t.streak, { dir: 'up', len: 7 });
  assert.equal(t.mk.S, 28);
  assert.equal(t.mk.method, 'exact');
  close(t.mk.p, 1 / 40320, 1e-4, 'p');
  close(t.slope.rise, 17.5, 0.01, 'rise');
  assert.equal(t.slope.clears, true);
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 7 of the last 7 weeks, steady', confidence: 'solid', detail: null,
  });
});

test('#2 rising with one dip: still steady, and its newest week is not a spike', () => {
  // 8,10,13,12,15,18,22,26. Only (13,12) falls: S = 27 - 1 = 26, untied:
  // exact p = P(I <= 1) = (1 + 7)/40320 = 1.98e-4.
  // The 28 slopes sorted: -1, 1, 1, 4/3, 5/3, 5/3, 7/4, 2, 2, 2, 9/4, 7/3, 12/5,
  // [5/2, 18/7], 13/5, 8/3, 3 (x4), 10/3, 7/2, 7/2, 11/3, 4, 4, 4.
  // perWeek = (5/2 + 18/7)/2 = 71/28; rise = 71/28 * 7 = 17.75.
  // baseline = median(8,10,13,12) = 11, endLevel = median(15,18,22,26) = 20,
  // floor = 2 * sqrt(11 + 20) = 11.14: clears; sum 124.
  // Steps + + - + + + +: u = 6 >= 4.9, d = 1 <= 1: steady. No shift (4 of 19), no plateau.
  const t = read(V2);
  assert.deepEqual(dirs(t), [1, 1, -1, 1, 1, 1, 1]);
  assert.deepEqual(t.streak, { dir: 'up', len: 4 });
  assert.equal(t.mk.S, 26);
  close(t.mk.p, 8 / 40320, 1e-4, 'p');
  close(t.slope.rise, 17.75, 0.01, 'rise');
  assert.equal(t.slope.clears, true);
  assert.deepEqual(t.spikes, []);
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 6 of the last 7 weeks, steady', confidence: 'solid', detail: null,
  });
});

test('#3 alternating: half the weeks rise, and it is flat', () => {
  // 10,14,10,14,10,14,10,14. Tie groups: four 10s, four 14s -> [4, 4].
  // S: a 10 before a 14 scores +1, 4+3+2+1 = 10 such pairs; a 14 before a 10 scores
  // -1, 3+2+1 = 6 pairs. S = 4. Var = (1176 - 2 * 4*3*13)/18 = (1176 - 312)/18 = 48.
  // z = (4 - 1)/sqrt(48) = 0.433; p = 1 - Phi(0.433) = 0.3325: none.
  // Slopes: same-value pairs (even distance) are 0, twelve of them; 10 rise, 6 fall.
  // Sorted, positions 7-18 are 0: perWeek 0, rise 0.
  // The last step 10 -> 14 rises, but weekDelta(14, 10): z = 4/sqrt(24) = 0.82 is noise.
  const t = read([10, 14, 10, 14, 10, 14, 10, 14]);
  assert.equal(t.mk.method, 'normal');
  assert.equal(t.mk.S, 4);
  close(t.mk.p, 0.3325, 0.002, 'p');
  assert.equal(t.slope.perWeek, 0);
  close(t.slope.rise, 0, 0.01, 'rise');
  assert.deepEqual(t.verdict, { code: 'flat', label: 'Flat over 8 weeks', confidence: 'none', detail: null });
});

test('#4 a viral week in a flat series: flat, and the spike is named, not believed', () => {
  // 10,11,10,30,11,10,11,10. Tie groups: four 10s, three 11s -> [4, 3].
  // S = -1 (the mannKendall case above). Var = (1176 - (4*3*13 + 3*2*11))/18 =
  // (1176 - 222)/18 = 53. z = (-1 + 1)/sqrt(53) = 0: p = 0.5, none.
  // Slopes: 10 negative, 9 zero, 9 positive; the 14th and 15th are zeros: rise 0.
  // Last step 11 -> 10: weekDelta(10, 11), z = -1/sqrt(21) = -0.22, is noise.
  const t = read(V4);
  assert.equal(t.mk.S, -1);
  close(t.mk.p, 0.5, 0.002, 'p');
  assert.equal(t.slope.perWeek, 0);
  close(t.slope.rise, 0, 0.01, 'rise');
  assert.deepEqual(t.spikes, [{ week: '2026-06-22', value: 30 }]);
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Flat over 8 weeks', confidence: 'none', detail: 'one spike week (2026-06-22)',
  });
});

test('#5 a step change: one week carried the rise, and the read says which', () => {
  // 10,10,11,10,20,21,20,21. Tie groups: three 10s, two 20s, two 21s -> [3, 2, 2].
  // S by first index: +5, +5, +3, +4, +2, -1, +1 = 19.
  // Var = (1176 - (3*2*11 + 2*1*9 + 2*1*9))/18 = (1176 - 102)/18 = 59.667
  // z = 18/sqrt(59.667) = 2.3303; p = 1 - Phi(2.3303) = 0.0099.
  // Slopes sorted: -1, -1, 0 (x5), 1/3, 1/2, 1, 1, 1, 11/7, [5/3, 11/6], 2, 2, ...
  // perWeek = (5/3 + 11/6)/2 = 7/4; rise = 7/4 * 7 = 12.25.
  // baseline = median(10,10,11,10) = 10, endLevel = median(20,21,20,21) = 20.5,
  // floor = 2 * sqrt(30.5) = 11.05: 12.25 clears; sum 123: solid.
  // Rising steps: +1, +10, +1, +1 = 13; the +10 into W(4) is 77% >= 60%, and
  // weekDelta(20, 10): z = 10/sqrt(30) = 1.83 >= 1.645 is up, like mk.
  const t = read(V5);
  assert.equal(t.mk.method, 'normal');
  assert.equal(t.mk.S, 19);
  close(t.mk.p, 0.0099, 0.002, 'p');
  close(t.slope.rise, 12.25, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'shift_up', label: 'Stepped up (week of 06-29 carried most of the rise)', confidence: 'solid', detail: null,
  });
});

test('#6 all zeros: nothing yet, and the rank test has nothing to rank', () => {
  // One tie group of 8: Var = 0, degenerate. Eight usable weeks, sum 0 < 3.
  const t = read(Array(8).fill(0));
  assert.equal(t.mk.method, 'degenerate');
  assert.deepEqual(t.verdict, {
    code: 'zero', label: 'Nothing yet (0 in 8 weeks)', confidence: 'none', detail: null,
  });
});

test('#7 three weeks are too few to say anything', () => {
  assert.deepEqual(read([10, 12, 15]).verdict, {
    code: 'too_few', label: 'Too few weeks (3 of 4)', confidence: 'none', detail: null,
  });
});

test('a read that was not made carries no detail, even with a week still settling', () => {
  for (const values of [[10, 12, 15], [0, 0, 0, 0, 0, 0, 1, 1]]) {
    const pts = pointsOf(values);
    pts[pts.length - 1] = { ...pts[pts.length - 1], settling: true };
    assert.equal(weeklyTrend(pts).verdict.detail, null, JSON.stringify(values));
  }
});

test('#8 decline clean: down every week, the mirror of #1', () => {
  // 30,27,24,22,19,16,14,11: every pair falls, S = -28, exact p = 1/40320.
  // Steps -3,-3,-2,-3,-3,-2,-3. Slopes sorted: -3 (x7), -2.8, -2.75 (x3), -19/7,
  // then -8/3 at positions 13-19: perWeek = -8/3, rise = -56/3 = -18.67.
  // baseline = median(30,27,24,22) = 25.5, endLevel = median(19,16,14,11) = 15,
  // floor = 2 * sqrt(40.5) = 12.73: clears; sum 163.
  const t = read([30, 27, 24, 22, 19, 16, 14, 11]);
  assert.equal(t.mk.S, -28);
  assert.equal(t.mk.method, 'exact');
  close(t.mk.p, 1 / 40320, 1e-4, 'p');
  close(t.slope.rise, -56 / 3, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'falling', label: 'Down 7 of the last 7 weeks, steady', confidence: 'solid', detail: null,
  });
});

test('#9 decline with one rise: still steady', () => {
  // 30,27,24,26,19,16,14,11. Only (24,26) rises: S = 1 - 27 = -26, exact p = 8/40320.
  // Slopes sorted: -7, -5, -4, -3.75, -3 (x5), -2.8, -2.75 (x2), -19/7, then -8/3 at
  // positions 14-18: perWeek = -8/3, rise = -56/3 = -18.67.
  // baseline = median(30,27,24,26) = 26.5, endLevel = median(19,16,14,11) = 15,
  // floor = 2 * sqrt(41.5) = 12.88: clears; sum 167.
  // d = 6 >= 4.9, u = 1 <= 1: steady. No shift: the -7 is 7 of the 21 fallen.
  const t = read([30, 27, 24, 26, 19, 16, 14, 11]);
  assert.equal(t.mk.S, -26);
  close(t.mk.p, 8 / 40320, 1e-4, 'p');
  close(t.slope.rise, -56 / 3, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'falling', label: 'Down 6 of the last 7 weeks, steady', confidence: 'solid', detail: null,
  });
});

test('#10 rose, then held: a plateau, not a rise', () => {
  // 5,6,8,11,14,14,13,14. Tie group: three 14s -> [3].
  // S by first index: +7, +6, +5, +4, -1, -1, +1 = 21.
  // Var = (1176 - 3*2*11)/18 = 1110/18 = 61.667; z = 20/sqrt(61.667) = 2.5469; p = 0.0054.
  // Slopes sorted: -1, -1/2, 0, 0, 0, 2/3, 3/4, 1, 1, 6/5, 5/4, 9/7, 4/3, [4/3, 7/5], ...
  // perWeek = (4/3 + 7/5)/2 = 41/30; rise = 41/30 * 7 = 9.567.
  // baseline = median(5,6,8,11) = 7, endLevel = median(14,14,13,14) = 14,
  // floor = 2 * sqrt(21) = 9.17: 9.567 clears; sum 85: solid.
  // No shift (3 of 10). The last four, 14,14,13,14: S = -1 <= 0, and their median 14
  // is at least the level, median(5,6,8,11,13,14,14,14) = 12.
  const t = read([5, 6, 8, 11, 14, 14, 13, 14]);
  assert.equal(t.mk.S, 21);
  close(t.mk.p, 0.0054, 0.002, 'p');
  close(t.slope.rise, 287 / 30, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'plateau', label: 'Rose, then flat for 4 weeks', confidence: 'solid', detail: null,
  });
});

test('#11 an unmeasured prefix: only the measured weeks are read', () => {
  // 8,10,13,12,15,18,22 after five unmeasurable weeks. Only (13,12) falls:
  // S = 21 - 2 = 19, n = 7: exact p = P(I <= 1) = (1 + 6)/5040 = 1.39e-3.
  // Slopes sorted (21): -1, 1, 1, 4/3, 5/3, 5/3, 7/4, 2, 2, 2, [9/4], 7/3, 12/5, 5/2, 3 (x4), ...
  // perWeek = 9/4; rise = 9/4 * 6 = 13.5.
  // n = 7, so each half is three weeks and the middle one (12) is in neither:
  // baseline = median(8,10,13) = 10, endLevel = median(15,18,22) = 18,
  // floor = 2 * sqrt(28) = 10.58: clears; sum 98.
  // n = 7 >= 6; u = 5 >= 0.7 * 6 = 4.2 and d = 1: steady.
  const before = [0, 1, 2, 3, 4].map((i) => ({ week: W(i), value: null, measurable: false, complete: true, settling: false }));
  const t = weeklyTrend([...before, ...pointsOf([8, 10, 13, 12, 15, 18, 22], 5)]);
  assert.equal(t.window.n, 7);
  assert.equal(t.mk.S, 19);
  close(t.mk.p, 7 / 5040, 1e-4, 'p');
  close(t.slope.rise, 13.5, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 5 of the last 6 weeks, steady', confidence: 'solid', detail: null,
  });
});

test('#12 missing weeks are counted as missing, not as flat', () => {
  // 10,12,-,15,16,18,-,22. Usable 10,12,15,16,18,22 all rise: S = 15, exact p = 1/720.
  // rise = 35/3 = 11.67 (the theilSen case); baseline = median(10,12,15) = 12,
  // endLevel = median(16,18,22) = 18, floor = 2 * sqrt(30) = 10.95: clears; sum 93.
  // Only 3 steps are defined, so no shift. Two WEEKS have no reading (four steps touch them).
  const t = read(V12);
  assert.equal(t.mk.S, 15);
  close(t.mk.p, 1 / 720, 1e-4, 'p');
  assert.deepEqual(t.counts, { up: 3, down: 0, flat: 0, gaps: 4, total: 3 });
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 3 of 3 measured weeks, 2 missing', confidence: 'solid', detail: null,
  });
});

test('one week is a week: the two sentences that can count exactly one say so', () => {
  // The caveat: a break at W(7) = 07-20 leaves one reading after it; a break after the newest
  // week leaves none.
  assert.equal(read(V1, { breaks: [{ week: '2026-07-20' }] }).caveat, 'Definition changed 2026-07-20; 1 week since');
  assert.equal(read(V1, { breaks: [{ week: '2026-07-27' }] }).caveat, 'Definition changed 2026-07-27; 0 weeks since');
  // The gap label: 10,-,14,-,18,-,22,26 has one defined step (22 -> 26) and three weeks with
  // no reading. S = 10 (n = 5, all rising), exact p = 1/120. The six slopes among 10,14,18,22
  // (t = 0,2,4,6) are 2; with 26 (t = 7) they are 16/7, 12/5, 8/3, 4. Sorted, the 5th and 6th
  // of the ten are both 2: perWeek 2, rise = 2 * 7 = 14. baseline = median(10,14) = 12,
  // endLevel = median(22,26) = 24, floor = 2 * sqrt(36) = 12: clears; sum 90: solid.
  // One defined step is under 4, so no shift; n = 5, so no plateau.
  const t = read([10, null, 14, null, 18, null, 22, 26]);
  close(t.mk.p, 1 / 120, 1e-4, 'p');
  close(t.slope.rise, 14, 0.01, 'rise');
  close(t.slope.floor, 12, 1e-9, 'floor');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 1 of 1 measured week, 3 missing', confidence: 'solid', detail: null,
  });
});

// #13 comes as a pair. 0,1,1,1,3,3,3,5 reaches the "flats dominate" sentence; the
// brief's original 0,1,1,2,2,3,3,3 has a significant rank test and a rise that
// stops just short of its floor, which is exactly what must stay "Leaning up".
test('#13 tiny counts where flat weeks dominate: up, said with the flats', () => {
  // Tie groups: three 1s, three 3s -> [3, 3]. S by first index: +7, +4, +4, +4, +1, +1, +1 = 22.
  // Var = (1176 - 2 * 3*2*11)/18 = 1044/18 = 58; z = 21/sqrt(58) = 2.7574; p = 0.0029.
  // Slopes sorted: 0 (x6), 1/3, 2/5, 1/2 (x4), 3/5, then 2/3 at positions 14-18:
  // perWeek = 2/3, rise = 14/3 = 4.67. baseline = median(0,1,1,1) = 1, raised to
  // MIN_BASE 2; endLevel = median(3,3,3,5) = 3: floor = 2 * sqrt(2 + 3) = 4.47.
  // 4.67 clears; sum 17 >= 10: solid.
  // No shift (2 of 5); the last four 3,3,3,5 still rise. u = 3 < 4.9; f = 4 > 3.
  const t = read(V13);
  assert.equal(t.mk.method, 'normal');
  assert.equal(t.mk.S, 22);
  close(t.mk.p, 0.0029, 0.002, 'p');
  close(t.slope.rise, 14 / 3, 0.01, 'rise');
  close(t.slope.floor, 2 * Math.sqrt(5), 1e-9, 'floor');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 3, flat 4 of the last 7 weeks', confidence: 'solid', detail: null,
  });
});

test('#13 original: significant, but the rise is under the floor, so it only leans', () => {
  // 0,1,1,2,2,3,3,3. Tie groups [2, 2, 3]. S = 7 + 5 + 5 + 3 + 3 = 23.
  // Var = (1176 - (2*1*9 + 2*1*9 + 3*2*11))/18 = 1074/18 = 59.667; z = 22/7.7244 = 2.8481;
  // p = 0.0022. Slopes sorted: 0 (x5), 1/4, 1/3 (x4), 2/5 (x2), 3/7, then 1/2 at positions
  // 14-22: perWeek 1/2, rise 3.5 < floor 2 * sqrt(2 + 3) = 4.47 (baseline median(0,1,1,2) = 1,
  // raised to MIN_BASE 2; endLevel median(2,3,3,3) = 3).
  const t = read([0, 1, 1, 2, 2, 3, 3, 3]);
  assert.equal(t.mk.S, 23);
  close(t.mk.p, 0.0022, 0.002, 'p');
  close(t.slope.rise, 3.5, 0.01, 'rise');
  assert.equal(t.slope.clears, false);
  assert.deepEqual(t.verdict, {
    code: 'leaning_up', label: 'Leaning up, 3 of 7 weeks', confidence: 'directional', detail: null,
  });
});

test('#14 a rise of four events is never solid, and the read says how few there were', () => {
  // 0,0,0,0,1,1,1,1. Tie groups [4, 4]; S = 4 * 4 = 16; Var = (1176 - 312)/18 = 48;
  // z = 15/sqrt(48) = 2.1651; p = 1 - Phi(2.1651) = 0.0152 <= 0.05.
  // Slopes: 12 zeros, then 1/7, 1/6, 1/6, ...: perWeek = (1/6 + 1/6)/2 = 1/6, rise 7/6 = 1.17.
  // baseline 0 and endLevel 1 are both raised to MIN_BASE: floor = 2 * sqrt(4) = 4, not
  // cleared. sum 4 < 10: and that alone would stop it.
  // p <= 0.10: directional. No shift: the one rising step, 0 -> 1, is 'thin'.
  // The last four 1,1,1,1: S = 0 <= 0, median 1 >= level 0.5: plateau.
  // p <= 0.05 with sum < 10 is what "capped by the events" means: the detail says so.
  const t = read([0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(t.mk.S, 16);
  close(t.mk.p, 0.0152, 0.002, 'p');
  close(t.slope.rise, 7 / 6, 0.01, 'rise');
  assert.notEqual(t.verdict.confidence, 'solid');
  assert.deepEqual(t.verdict, {
    code: 'plateau', label: 'Rose, then flat for 4 weeks', confidence: 'directional', detail: '4 events in 8 weeks',
  });
});

test('#15 one bulk import among flat card weeks: flat, never up', () => {
  // 300,310,290,305,700,300,310,295 (dispersion 'mad'). Tie groups [2, 2]; S = 0
  // (the mannKendall case above), so p = 0.5. Slopes: 13 negative, 2 zero, 13
  // positive: rise 0. Last step 310 -> 295: z = -15/sqrt(605) = -0.61, noise.
  const t = read(V15, { dispersion: 'mad' });
  assert.equal(t.mk.S, 0);
  close(t.mk.p, 0.5, 0.002, 'p');
  close(t.slope.rise, 0, 0.01, 'rise');
  assert.equal(t.mk.dir, 'none');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Flat over 8 weeks', confidence: 'none', detail: 'one spike week (2026-06-29)',
  });
});

test('#16 exactly the same every week: flat', () => {
  // One tie group of 8: degenerate, p = 1. sum 96 is not "nothing". Last step 0.
  const t = read(V16);
  assert.equal(t.mk.method, 'degenerate');
  assert.deepEqual(t.verdict, { code: 'flat', label: 'Flat over 8 weeks', confidence: 'none', detail: null });
});

test('#17 a drift inside the noise: significant, but only leaning', () => {
  // 10,10,12,12,12,14,14,15: S = 23, p = 0.0022 (the tied mannKendall case).
  // Slopes sorted: 0 (x5), 1/2 (x3), 3/5, 2/3 (x5), 5/7, 3/4, ...: the 14th is 2/3 and
  // the 15th 5/7, perWeek = 29/42, rise = 29/6 = 4.83.
  // baseline = median(10,10,12,12) = 11, endLevel = median(12,14,14,15) = 14,
  // floor = 2 * sqrt(25) = 10: not cleared.
  // No shift (2 of 5); the last four 12,14,14,15 still rise.
  const t = read([10, 10, 12, 12, 12, 14, 14, 15]);
  close(t.mk.p, 0.0022, 0.002, 'p');
  close(t.slope.rise, 29 / 6, 0.01, 'rise');
  close(t.slope.floor, 10, 1e-9, 'floor');
  assert.equal(t.slope.clears, false);
  assert.deepEqual(t.verdict, {
    code: 'leaning_up', label: 'Leaning up, 3 of 7 weeks', confidence: 'directional', detail: null,
  });
});

test('#18 up this week, flat over the window: the week is named, the trend is not claimed', () => {
  // 10,11,10,12,11,10,11,22. Tie groups: three 10s, three 11s -> [3, 3].
  // S by first index: +5, 0, +4, -2, 0, +2, +1 = 10. Var = (1176 - 66 - 66)/18 = 58.
  // z = 9/sqrt(58) = 1.1818; p = 1 - Phi(1.1818) = 0.1187 > 0.10: none.
  // Slopes: 6 negative, 6 zero, then 1/6, [1/4, 1/4], ...: perWeek 1/4, rise 1.75.
  // Last step 11 -> 22: weekDelta(22, 11), z = 11/sqrt(33) = 1.91, is a real rise.
  const t = read(V18);
  assert.equal(t.mk.S, 10);
  close(t.mk.p, 0.1187, 0.002, 'p');
  close(t.slope.rise, 1.75, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Up this week, flat over 8', confidence: 'none', detail: 'one spike week (2026-07-20)',
  });
});

test('#19 five weeks, all up: solid, without the steady wording it has not earned', () => {
  // 10,12,15,18,22: S = 10, exact p = 1/5! = 1/120.
  // Slopes sorted: 2, 5/2, 8/3, [3, 3], 3, 3, 10/3, 7/2, 4: perWeek 3, rise 12.
  // n = 5: baseline = median(10,12) = 11, endLevel = median(18,22) = 20 (15 is in
  // neither half), floor = 2 * sqrt(31) = 11.14: 12 clears; sum 77. n = 5 < 6.
  const t = read([10, 12, 15, 18, 22]);
  close(t.mk.p, 1 / 120, 1e-4, 'p');
  close(t.slope.rise, 12, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 4 of the last 4 weeks', confidence: 'solid', detail: null,
  });
});

test('#20 four weeks with a dip: too short to call flat, so no clear direction', () => {
  // 10,12,11,15: S = 5 - 1 = 4, exact p = P(I <= 1) = (1 + 3)/24 = 1/6: none.
  // Slopes sorted: -1, 1/2, [3/2, 5/3], 2, 4: perWeek 19/12, rise 4.75.
  // Last step 11 -> 15: z = 4/sqrt(26) = 0.78, noise.
  // Up 50% end to end, and four untied weeks out of perfect order can do no better than
  // 1/6. n = 4 is under STEADY_WEEKS: the read cannot see a direction, which is not the
  // same as seeing that there is none. The code is still 'flat'.
  const t = read([10, 12, 11, 15]);
  close(t.mk.p, 1 / 6, 1e-4, 'p');
  close(t.slope.rise, 4.75, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'No clear direction over 4 weeks', confidence: 'none', detail: null,
  });
});

// ── Short windows: no clear direction, never "flat" ───────────────────────
// Under STEADY_WEEKS (6) readings a read with no direction says it cannot see
// one; from six on, it says flat. Each of the three short sentences has a case.
test('five weeks with no direction: no clear direction, and so is a window holding five readings', () => {
  // 10,12,11,15,14: untied; inversions (12,11) and (15,14): I = 2, S = 10 - 4 = 6.
  // Exact p = P(I <= 2) = (1 + 4 + 9)/120 = 14/120 = 0.1167 > 0.10: none, on a 40% rise.
  // Last step 15 -> 14: weekDelta(14, 15), z = -1/sqrt(29) = -0.19, noise.
  const five = read([10, 12, 11, 15, 14]);
  assert.equal(five.mk.S, 6);
  close(five.mk.p, 14 / 120, 1e-12, 'p');
  assert.deepEqual(five.verdict, {
    code: 'flat', label: 'No clear direction over 5 weeks', confidence: 'none', detail: null,
  });
  // n counts readings, not calendar weeks: the same five values spread over eight weeks,
  // three of them missing, rank the same (S = 6, p = 14/120), and the newest step has a
  // gap in it, so it names no week.
  const spread = read([10, null, 12, 11, null, 15, null, 14]);
  assert.equal(spread.window.calendarWeeks, 8);
  assert.equal(spread.window.n, 5);
  assert.equal(spread.mk.S, 6);
  assert.deepEqual(spread.verdict, five.verdict);
});

test('at STEADY_WEEKS readings a read with no direction is flat again', () => {
  // 10,12,11,15,14,13: untied; inversions (12,11), (15,14), (15,13), (14,13): I = 4,
  // S = 15 - 8 = 7. Exact p = P(I <= 4) = (1 + 5 + 14 + 29 + 49)/720 = 98/720 = 0.136: none.
  // Last step 14 -> 13: z = -1/sqrt(27) = -0.19, noise. n = 6.
  const t = read([10, 12, 11, 15, 14, 13]);
  assert.equal(t.mk.S, 7);
  close(t.mk.p, 98 / 720, 1e-12, 'p');
  assert.deepEqual(t.verdict, { code: 'flat', label: 'Flat over 6 weeks', confidence: 'none', detail: null });
});

test('up this week, no clear direction over a short window', () => {
  // 20,14,20,14,25. Tie groups: two 14s, two 20s -> [2, 2].
  // S by first index: -1 + 0 - 1 + 1 = -1, +1 + 0 + 1 = +2, -1 + 1 = 0, +1: S = 2.
  // Var = (5*4*15 - 2 * 2*1*9)/18 = (300 - 36)/18 = 14.667;
  // z = (2 - 1)/sqrt(14.667) = 0.2611; p = 1 - Phi(0.2611) = 0.397: none.
  // Last step 14 -> 25: weekDelta(25, 14), z = 11/sqrt(39) = 1.76, a real rise. Not a
  // spike: 25 - 14 = 11 is under 3 * sqrt(20) = 13.42, 20 being the median.
  const t = read([20, 14, 20, 14, 25]);
  assert.equal(t.mk.method, 'normal');
  assert.equal(t.mk.S, 2);
  close(t.mk.p, 0.397, 0.002, 'p');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Up this week, no clear direction over 5', confidence: 'none', detail: null,
  });
});

test('down this week, no clear direction over a short window', () => {
  // 19,25,19,25,14 is 39 - x of the case above: S = -2, ties [2, 2], Var 14.667,
  // z = -0.2611, p = 0.397: none. Last step 25 -> 14: weekDelta(14, 25),
  // z = -11/sqrt(39) = -1.76, a real fall. A drop is never a spike.
  const t = read([19, 25, 19, 25, 14]);
  assert.equal(t.mk.S, -2);
  close(t.mk.p, 0.397, 0.002, 'p');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Down this week, no clear direction over 5', confidence: 'none', detail: null,
  });
});

// #21 comes as a pair too. 10,14,18,22 is four perfect weeks that clear their
// floor; the brief's original 10,12,15,18 is four perfect weeks whose rise (8.5)
// does not, and the exact p of 1/24 alone must not make that solid.
test('#21 four weeks, all up and clear of the floor: solid', () => {
  // S = 6, exact p = 1/4! = 1/24 = 0.0417. Every slope is 4: perWeek 4, rise 12.
  // baseline = median(10,14) = 12, endLevel = median(18,22) = 20,
  // floor = 2 * sqrt(32) = 11.31: 12 clears; sum 64.
  const t = read([10, 14, 18, 22]);
  close(t.mk.p, 1 / 24, 1e-4, 'p');
  close(t.slope.rise, 12, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 3 of the last 3 weeks', confidence: 'solid', detail: null,
  });
});

test('#21 original: four weeks up, but by less than the floor, only leans', () => {
  // 10,12,15,18: exact p = 1/24; rise 8.5 (the theilSen case); baseline = median(10,12) = 11,
  // endLevel = median(15,18) = 16.5, floor = 2 * sqrt(27.5) = 10.49 > 8.5.
  const t = read([10, 12, 15, 18]);
  close(t.mk.p, 1 / 24, 1e-4, 'p');
  close(t.slope.rise, 8.5, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'leaning_up', label: 'Leaning up, 3 of 3 weeks', confidence: 'directional', detail: null,
  });
});

test('#22 a definition break leaves too few weeks to read, and says why', () => {
  const t = read(V1, { breaks: [{ week: '2026-07-13' }] });
  assert.deepEqual(t.verdict, {
    code: 'too_few', label: 'Too few weeks (2 of 4)', confidence: 'none', detail: null,
  });
  assert.equal(t.caveat, 'Definition changed 2026-07-13; 2 weeks since');
});

test('#23 the partial week changes nothing about the verdict', () => {
  const t = weeklyTrend([...pointsOf(V1), { week: W(8), value: 4, measurable: true, complete: false, settling: true }]);
  assert.deepEqual(t.verdict, read(V1).verdict);
});

test('#24 a settling newest week keeps the verdict and says it may still move', () => {
  const pts = pointsOf(V1);
  pts[7] = { ...pts[7], settling: true };
  const t = weeklyTrend(pts);
  assert.equal(t.steps.at(-1).settling, true);
  assert.deepEqual(t.verdict, { ...read(V1).verdict, detail: 'newest week still settling' });
});

// ── The falling and uneven sentences ──────────────────────────────────────
// The brief's vectors never reach these branches, and every sentence the read
// can print is a string another component shows verbatim, so each has a case.
test('up more often than not, with real dips: uneven', () => {
  // 10,15,14,19,18,23,22,27 is 10 + 2t, plus 3 on odd weeks. Untied.
  // Same-parity pairs (12) rise with slope exactly 2; even-to-odd pairs (10) rise
  // with slope 2 + 3/d; odd-to-even pairs (6) have slope 2 - 3/d, falling only at
  // d = 1 (3 pairs). S = 25 - 3 = 22: exact p = P(I <= 3) = (1+7+27+76)/40320 = 111/40320.
  // Sorted slopes: 6 below 2, 12 at 2 (positions 7-18), 10 above: perWeek 2, rise 14.
  // baseline = median(10,15,14,19) = 14.5, endLevel = median(18,23,22,27) = 22.5,
  // floor = 2 * sqrt(37) = 12.17: 14 clears; sum 148.
  // No shift (every rise is +5); the last four 18,23,22,27 rise. u = 4 < 4.9, f = 0.
  const t = read([10, 15, 14, 19, 18, 23, 22, 27]);
  assert.equal(t.mk.S, 22);
  close(t.mk.p, 111 / 40320, 1e-4, 'p');
  close(t.slope.rise, 14, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 4 of the last 7 weeks, uneven', confidence: 'solid', detail: null,
  });
});

test('steady allows one down week, not two', () => {
  // 10,15,14,19,18,23,28,33: steps +5,-1,+5,-1,+5,+5,+5. Untied; (15,14) and (19,18)
  // fall: S = 26 - 2 = 24, exact p = P(I <= 2) = (1+7+27)/40320 = 35/40320.
  // Slopes sorted: -1, -1, 1, 2 (x6), 13/5, 13/5, then 3 at positions 12-16, ...:
  // perWeek 3, rise 21. baseline = median(10,15,14,19) = 14.5, endLevel = median(18,23,28,33)
  // = 25.5, floor = 2 * sqrt(40) = 12.65.
  // u = 5 >= 4.9, but d = 2 > 1: not steady, and with no flats it is uneven.
  const t = read([10, 15, 14, 19, 18, 23, 28, 33]);
  assert.equal(t.mk.S, 24);
  close(t.mk.p, 35 / 40320, 1e-4, 'p');
  close(t.slope.rise, 21, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'rising', label: 'Up 5 of the last 7 weeks, uneven', confidence: 'solid', detail: null,
  });
});

test('reversing time mirrors the verdict: rising becomes falling, with the counts swapped', () => {
  // Reversal negates S and every pairwise slope, and swaps baseline with endLevel,
  // which leaves the floor where it was: 12.08, 11.14 and 12.17 for both directions.
  for (const xs of [V1, V2, [10, 15, 14, 19, 18, 23, 22, 27]]) {
    const up = read(xs);
    const down = read([...xs].reverse());
    assert.equal(down.mk.S, -up.mk.S);
    assert.equal(up.verdict.code, 'rising');
    assert.equal(down.verdict.code, 'falling');
    assert.equal(down.verdict.confidence, up.verdict.confidence);
    assert.equal(down.verdict.label, up.verdict.label.replace('Up ', 'Down '));
    assert.deepEqual(down.counts, { ...up.counts, up: up.counts.down, down: up.counts.up });
  }
});

test('down, with flat weeks dominating', () => {
  // 10,8,8,8,4,4,4,0 is 10 - 2x of #13's 0,1,1,1,3,3,3,5: S = -22, ties [3, 3], Var 58,
  // z = -21/sqrt(58) = -2.7574, p = 0.0029; slopes times -2: perWeek -4/3, rise -28/3 = -9.33.
  // baseline = median(10,8,8,8) = 8, endLevel = median(4,4,4,0) = 4,
  // floor = 2 * sqrt(12) = 6.93: 9.33 clears; sum 46.
  // No shift (4 of 10); the last four 4,4,4,0 still fall. d = 3 < 4.9; f = 4 > 3.
  const t = read([10, 8, 8, 8, 4, 4, 4, 0]);
  assert.equal(t.mk.S, -22);
  close(t.mk.p, 0.0029, 0.002, 'p');
  close(t.slope.rise, -28 / 3, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'falling', label: 'Down 3, flat 4 of the last 7 weeks', confidence: 'solid', detail: null,
  });
});

test('down, with weeks missing', () => {
  // 30,27,-,21,18,15,-,9 is 30 - 3t on every week with a reading: all 15 slopes are -3,
  // rise -21. S = -15, exact p = 1/720. baseline = median(30,27,21) = 27,
  // endLevel = median(18,15,9) = 15, floor = 2 * sqrt(42) = 12.96: clears; sum 120.
  // Two weeks have no reading.
  const t = read([30, 27, null, 21, 18, 15, null, 9]);
  close(t.mk.p, 1 / 720, 1e-4, 'p');
  close(t.slope.rise, -21, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'falling', label: 'Down 3 of 3 measured weeks, 2 missing', confidence: 'solid', detail: null,
  });
});

test('down over five weeks', () => {
  // 30,25,20,16,12: S = -10, exact p = 1/120. Slopes sorted: -5, -5, -5, -14/3,
  // [-9/2, -9/2], -13/3, -4, -4, -4: rise = -9/2 * 4 = -18.
  // baseline = median(30,25) = 27.5, endLevel = median(16,12) = 14,
  // floor = 2 * sqrt(41.5) = 12.88: clears; sum 103.
  const t = read([30, 25, 20, 16, 12]);
  close(t.mk.p, 1 / 120, 1e-4, 'p');
  close(t.slope.rise, -18, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'falling', label: 'Down 4 of the last 4 weeks', confidence: 'solid', detail: null,
  });
});

test('down this week, flat over the window', () => {
  // 22,21,22,20,21,22,21,10 is 32 - x of #18: S = -10, ties [3, 3], Var 58,
  // z = -9/sqrt(58) = -1.1818, p = 0.1187: none. Last step 21 -> 10:
  // weekDelta(10, 21), z = -11/sqrt(31) = -1.98, is a real fall. A drop is never a spike.
  const t = read([22, 21, 22, 20, 21, 22, 21, 10]);
  close(t.mk.p, 0.1187, 0.002, 'p');
  assert.deepEqual(t.verdict, {
    code: 'flat', label: 'Down this week, flat over 8', confidence: 'none', detail: null,
  });
});

test('a jump of two events in the newest week is not "up this week"', () => {
  // 1,2,1,2,1,2,1,3. Tie groups: four 1s, three 2s -> [4, 3].
  // S by first index: +4, -2, +3, -1, +2, 0, +1 = 7. Var = (1176 - 156 - 66)/18 = 53.
  // z = 6/sqrt(53) = 0.824, p = 0.205: none. Last step 1 -> 3: 4 events, 'thin'.
  const t = read([1, 2, 1, 2, 1, 2, 1, 3]);
  close(t.mk.p, 0.205, 0.002, 'p');
  assert.deepEqual(t.verdict, { code: 'flat', label: 'Flat over 8 weeks', confidence: 'none', detail: null });
});

test('leaning down', () => {
  // 15,14,14,12,12,12,10,10 is #17 reversed: S = -23, ties [2, 3, 2], z = -2.8481,
  // p = 0.0022; rise = -29/6 = -4.83. baseline = median(15,14,14,12) = 14,
  // endLevel = median(12,12,10,10) = 11, floor = 2 * sqrt(25) = 10: not cleared,
  // exactly as for #17. No shift (2 of 5); the last four 12,12,10,10 still fall.
  const t = read([15, 14, 14, 12, 12, 12, 10, 10]);
  close(t.mk.p, 0.0022, 0.002, 'p');
  close(t.slope.rise, -29 / 6, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'leaning_down', label: 'Leaning down, 3 of 7 weeks', confidence: 'directional', detail: null,
  });
});

test('stepped down: #5 read backwards is the same step, and just as sure', () => {
  // 21,20,21,20,10,11,10,10 is #5 reversed: S = -19, p = 0.0099, rise -12.25. baseline
  // = median(21,20,21,20) = 20.5, endLevel = median(10,11,10,10) = 10, floor = 2 * sqrt(30.5)
  // = 11.05, the same as #5's: 12.25 clears, so solid, as #5 is. (A floor read from the
  // first half alone gave 12.81 here and called the fall 'directional'.)
  // Falling steps: 1, 1, 10, 1 = 13; the 10 into W(4) is 77%, and weekDelta(10, 20) is down.
  const t = read([21, 20, 21, 20, 10, 11, 10, 10]);
  close(t.mk.p, 0.0099, 0.002, 'p');
  close(t.slope.rise, -12.25, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'shift_down', label: 'Stepped down (week of 06-29 carried most of the drop)', confidence: 'solid', detail: null,
  });
});

test('fell, then held: a trough', () => {
  // 28,26,22,16,10,10,12,10 is 38 - 2x of #10: S = -21, ties [3], z = -2.5469,
  // p = 0.0054; slopes times -2: perWeek -41/15, rise -287/15 = -19.13.
  // baseline = median(28,26,22,16) = 24, endLevel = median(10,10,12,10) = 10,
  // floor = 2 * sqrt(34) = 11.66: clears; sum 134.
  // No shift (6 of 20). The last four 10,10,12,10: S = +1 >= 0, and their median 10
  // is at most the level, median(10,10,10,12,16,22,26,28) = 14.
  const t = read([28, 26, 22, 16, 10, 10, 12, 10]);
  close(t.mk.p, 0.0054, 0.002, 'p');
  close(t.slope.rise, -287 / 15, 0.01, 'rise');
  assert.deepEqual(t.verdict, {
    code: 'trough', label: 'Fell, then flat for 4 weeks', confidence: 'solid', detail: null,
  });
});

// ── Thin data, details and properties ─────────────────────────────────────
test('two events in eight weeks is nothing yet, however significant the ranks look', () => {
  // 0,0,0,0,0,0,1,1: S = 12, ties [6, 2], Var = (1176 - 510 - 18)/18 = 36,
  // z = 11/6 = 1.83, p = 0.033 <= 0.05. But sum 2 < 3: zero comes first.
  assert.deepEqual(read([0, 0, 0, 0, 0, 0, 1, 1]).verdict, {
    code: 'zero', label: 'Nothing yet (2 in 8 weeks)', confidence: 'none', detail: null,
  });
  // 0,0,0,0,0,1,1,1: sum 3 is something. S = 15, ties [5, 3],
  // Var = (1176 - 300 - 66)/18 = 45, z = 14/sqrt(45) = 2.087, p = 0.018. sum < 10: directional.
  const three = read([0, 0, 0, 0, 0, 1, 1, 1]).verdict;
  assert.equal(three.code, 'leaning_up');
  assert.equal(three.detail, '3 events in 8 weeks');
});

test('details join: several spikes are counted, and a settling week is added on', () => {
  // 10,30,10,11,10,30,10,11: median 10.5, bar 9.72; each 30 is 20 above its neighbours.
  // S = +4 -5 +3 -1 +2 -2 +1 = 2, ties [4, 2, 2]: p = 0.45, flat.
  const pts = pointsOf([10, 30, 10, 11, 10, 30, 10, 11]);
  pts[7] = { ...pts[7], settling: true };
  assert.equal(weeklyTrend(pts).verdict.detail, '2 spike weeks · newest week still settling');
  const one = pointsOf(V4);
  one[7] = { ...one[7], settling: true };
  assert.equal(weeklyTrend(one).verdict.detail, 'one spike week (2026-06-22) · newest week still settling');
});

test('adding a constant leaves S, the steps and p where they were', () => {
  const base = read(V1);
  const lifted = read(V1.map((x) => x + 100));
  assert.equal(lifted.mk.S, base.mk.S);
  assert.equal(lifted.mk.p, base.mk.p);
  assert.deepEqual(dirs(lifted), dirs(base));
});

test('#17 at ten times the counts clears its floor: the floor scales with the square root, the rise linearly', () => {
  // rise 4.83 * 10 = 48.3; baseline 110, endLevel 140, floor = 2 * sqrt(250) = 31.62.
  // Unscaled the floor was 10 against a rise of 4.83.
  assert.equal(read([10, 10, 12, 12, 12, 14, 14, 15]).slope.clears, false);
  const t = read([100, 100, 120, 120, 120, 140, 140, 150]);
  close(t.slope.rise, 290 / 6, 0.01, 'rise');
  assert.equal(t.slope.clears, true);
});

test('reading the weeks backwards mirrors the verdict, with the same confidence', () => {
  // 300 seeded count series, n 4..8, values 0..40. Reversal negates S and every pairwise
  // slope and swaps the halves the floor is read from, so the confidence cannot change and
  // the direction must flip. Plateau and trough are the one exception to an exact mirror of
  // the code: they describe the NEWEST four weeks, which reversal moves to the other end
  // ("rose, then flat" read backwards is "flat, then fell"), so where either side is one of
  // them only the direction is asserted.
  const MIRROR = {
    rising: 'falling', falling: 'rising', leaning_up: 'leaning_down', leaning_down: 'leaning_up',
    shift_up: 'shift_down', shift_down: 'shift_up', plateau: 'trough', trough: 'plateau',
    flat: 'flat', zero: 'zero', too_few: 'too_few',
  };
  const SIDE = {
    rising: 'up', leaning_up: 'up', shift_up: 'up', plateau: 'up',
    falling: 'down', leaning_down: 'down', shift_down: 'down', trough: 'down',
    flat: 'flat', zero: 'zero', too_few: 'too_few',
  };
  const shaped = (code) => code === 'plateau' || code === 'trough';
  const next = lcg(20261007);
  let directed = 0;
  for (let k = 0; k < 300; k += 1) {
    const n = 4 + Math.floor(next() * 5);
    const xs = Array.from({ length: n }, () => Math.floor(next() * 41));
    const fwd = read(xs).verdict;
    const back = read([...xs].reverse()).verdict;
    const what = JSON.stringify(xs);
    assert.ok(fwd.code in MIRROR && back.code in MIRROR, what);
    assert.equal(back.confidence, fwd.confidence, what);
    assert.equal(SIDE[back.code], SIDE[MIRROR[fwd.code]], what);
    if (!shaped(fwd.code) && !shaped(back.code)) assert.equal(back.code, MIRROR[fwd.code], what);
    if (fwd.confidence !== 'none') directed += 1;
  }
  // Not a vacuous pass: this seed gives dozens of reads with a direction.
  assert.ok(directed >= 30, `only ${directed} of 300 reads had a direction`);
});

test('junk in is too few weeks out, never an exception', () => {
  for (const junk of [null, undefined, [], [{}]]) {
    assert.deepEqual(weeklyTrend(junk).verdict, {
      code: 'too_few', label: 'Too few weeks (0 of 4)', confidence: 'none', detail: null,
    });
  }
  assert.equal(read([10, 12, 15, 18], { minWeeks: 5 }).verdict.label, 'Too few weeks (4 of 5)');
});
