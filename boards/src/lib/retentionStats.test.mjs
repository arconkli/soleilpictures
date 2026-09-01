// retentionStats.test.mjs — node --test src/lib/retentionStats.test.mjs
//
// The consistency() cases are the ones that matter. This dashboard has produced
// at least three confident readings that dissolved the moment they were split
// by depth — including one whose plain reading is "shipping errors improves
// retention", which is absurd on its face and was still the number the data
// handed back. That failure mode is reproduced here as a fixture, because a
// guard against it is only worth having if something fails when it is removed.
//
// Deliberately synthetic figures throughout: this repo is public and real
// cohort counts do not belong in it. The SHAPES are the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wilson, intervalWidthPP, sampleSizePerArm, mdePP,
  readableWeeks, readableOn, separated, consistency,
} from './retentionStats.js';

const close = (a, b, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} within ${eps} of ${b}`);

// ── Wilson ────────────────────────────────────────────────────────────────
test('wilson matches the textbook interval', () => {
  const w = wilson(5, 10);
  close(w.p, 0.5);
  close(w.lo, 0.2366);
  close(w.hi, 0.7634);
});

test('wilson never leaves [0,1] at the extremes — the reason it is used', () => {
  const zero = wilson(0, 10);
  assert.equal(zero.p, 0);
  assert.equal(zero.lo, 0, 'the normal approximation goes negative here');
  assert.ok(zero.hi > 0 && zero.hi < 1, 'zero of ten is not proof of zero');

  const all = wilson(10, 10);
  // <= rather than ===: at k === n the analytic bound is exactly 1, but the
  // sqrt lands a few ulps short. Never exceeding 1 is the property that
  // matters — a percentage over 100 on a chart is the visible failure.
  assert.ok(all.hi <= 1, 'must not exceed certainty');
  close(all.hi, 1, 1e-9);
  assert.ok(all.lo > 0 && all.lo < 1, 'ten of ten is not proof of one');
});

test('an unmeasured cell is null with the full range, not a divide by zero', () => {
  const w = wilson(0, 0);
  assert.equal(w.p, null);
  assert.equal(w.lo, 0);
  assert.equal(w.hi, 1);
  assert.equal(intervalWidthPP(0, 0), null);
});

test('more data narrows the interval', () => {
  assert.ok(intervalWidthPP(50, 100) < intervalWidthPP(5, 10));
  assert.ok(intervalWidthPP(500, 1000) < intervalWidthPP(50, 100));
});

// ── Power ─────────────────────────────────────────────────────────────────
test('sample size grows as the effect shrinks', () => {
  const big = sampleSizePerArm(0.3, 20);
  const small = sampleSizePerArm(0.3, 5);
  assert.ok(small > big * 4, 'quartering the effect should cost far more than 4x');
});

test('an impossible or absent lift has no sample size', () => {
  assert.equal(sampleSizePerArm(0.9, 20), null, 'cannot exceed 100%');
  assert.equal(sampleSizePerArm(0.3, 0), null);
  assert.equal(sampleSizePerArm(0.3, -5), null);
});

test('mde inverts sampleSizePerArm', () => {
  for (const baseline of [0.2, 0.35, 0.5]) {
    for (const lift of [5, 10, 20]) {
      const n = sampleSizePerArm(baseline, lift);
      close(mdePP(baseline, n), lift, 0.15);
    }
  }
});

test('an arm too small to detect anything returns null rather than a number', () => {
  assert.equal(mdePP(0.3, 2), null, 'a handful of people cannot detect any lift');
});

test('readableWeeks splits the weekly intake across BOTH arms', () => {
  const perArm = sampleSizePerArm(0.3, 10);
  const weekly = 40;
  assert.equal(readableWeeks(0.3, 10, weekly), Math.ceil((perArm * 2) / weekly));
  // The bug this guards: dividing by the whole intake, which halves the answer.
  assert.notEqual(readableWeeks(0.3, 10, weekly), Math.ceil(perArm / weekly));
});

test('readableOn returns a date that many weeks out, and is pure', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const weeks = readableWeeks(0.3, 10, 40);
  const on = readableOn(0.3, 10, 40, from);
  assert.equal(on.toISOString().slice(0, 10),
    new Date(Date.UTC(2026, 0, 1 + weeks * 7)).toISOString().slice(0, 10));
  assert.equal(from.toISOString(), '2026-01-01T00:00:00.000Z', 'must not mutate its input');
});

// ── Separation ────────────────────────────────────────────────────────────
test('separated is conservative — small cells never separate', () => {
  assert.equal(separated(4, 10, 2, 10), false, 'a 20pp gap on tens of people is nothing');
  assert.equal(separated(400, 1000, 200, 1000), true, 'the same gap on thousands is real');
});

test('an empty side never separates', () => {
  assert.equal(separated(0, 0, 200, 1000), false);
});

// ── The confound guard ────────────────────────────────────────────────────
test('a sign flip across bands is reported as inconsistent, with no effect size', () => {
  // The shape of the day-one-error reading: pooled it looks like a large
  // positive effect, but the sign flips band to band because depth drives both
  // sides. Anything that renders a number here has reproduced the original bug.
  const cells = [
    { band: '0',   withSucc: 12, withN: 30, withoutSucc: 15, withoutN: 100 }, // +25pp
    { band: '1-2', withSucc: 6,  withN: 30, withoutSucc: 20, withoutN: 60 },  // -13pp  <- the flip
    { band: '3-5', withSucc: 10, withN: 30, withoutSucc: 10, withoutN: 40 },  // +8pp
    { band: '6+',  withSucc: 18, withN: 30, withoutSucc: 16, withoutN: 40 },  // +20pp
  ];
  const r = consistency(cells);
  assert.equal(r.verdict, 'inconsistent');
  assert.ok(r.positive > 0 && r.negative > 0, 'both directions must be counted');
});

test('one flat band does not condemn an otherwise consistent signal', () => {
  // The failure this guards was found by looking at the rendered panel: the
  // mobile signal is negative in every band that says anything, but ONE band
  // differed by half a point on a handful of people, which counted as a sign
  // change and got the whole row labelled confounded. Half a point on ten
  // people is a tie.
  const cells = [
    { band: '0',   withSucc: 5, withN: 50, withoutSucc: 22, withoutN: 100 }, // -12pp
    { band: '1-2', withSucc: 6, withN: 20, withoutSucc: 28, withoutN: 94 },  // +0.2pp — flat
    { band: '3-5', withSucc: 2, withN: 14, withoutSucc: 16, withoutN: 50 },  // -18pp
    { band: '6+',  withSucc: 4, withN: 10, withoutSucc: 28, withoutN: 50 },  // -16pp
  ];
  const r = consistency(cells);
  assert.equal(r.verdict, 'directional', 'a flat band is not a sign flip');
  assert.equal(r.positive, 0);
  assert.equal(r.negative, 3);

  // With no dead zone at all it reverts to the over-reading.
  assert.equal(consistency(cells, { minDeltaPP: 0 }).verdict, 'inconsistent');
});

test('a signal flat in every band is unmeasured, not directional', () => {
  const cells = [
    { band: 'a', withSucc: 30, withN: 100, withoutSucc: 31, withoutN: 100 },
    { band: 'b', withSucc: 20, withN: 100, withoutSucc: 21, withoutN: 100 },
  ];
  assert.equal(consistency(cells).verdict, 'unmeasured');
});

test('a consistent but unseparated effect is directional, not supported', () => {
  const cells = [
    { band: 'a', withSucc: 6, withN: 10, withoutSucc: 4, withoutN: 10 },
    { band: 'b', withSucc: 7, withN: 12, withoutSucc: 5, withoutN: 12 },
  ];
  const r = consistency(cells);
  assert.equal(r.verdict, 'directional');
  assert.equal(r.negative, 0);
});

test('a consistent effect that separates in a band is supported', () => {
  const cells = [
    { band: 'a', withSucc: 600, withN: 1000, withoutSucc: 300, withoutN: 1000 },
    { band: 'b', withSucc: 60,  withN: 100,  withoutSucc: 40,  withoutN: 100 },
  ];
  assert.equal(consistency(cells).verdict, 'supported');
});

test('thin bands are dropped, and all-thin reads as unmeasured not as an effect', () => {
  const cells = [
    { band: 'a', withSucc: 2, withN: 2, withoutSucc: 0, withoutN: 3 },
    { band: 'b', withSucc: 1, withN: 1, withoutSucc: 0, withoutN: 4 },
  ];
  const r = consistency(cells);
  assert.equal(r.verdict, 'unmeasured');
  assert.equal(r.bands, 0);
});

test('consistency tolerates junk input rather than throwing on a render path', () => {
  assert.equal(consistency(null).verdict, 'unmeasured');
  assert.equal(consistency([]).verdict, 'unmeasured');
  assert.equal(consistency([{}]).verdict, 'unmeasured');
});
