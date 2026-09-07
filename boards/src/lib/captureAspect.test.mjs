// captureAspect.test.mjs — the shapes, and the crop solve behind the Shot button.
//
// cropRectFor has to agree with what the on-screen guide draws, because the
// whole promise of the Shot button is "the file arrives at the ratio you were
// composing for". A crop that is a few pixels off, or off-centre, produces
// assets that don't line up with each other — the kind of thing you only notice
// once six of them are side by side in a deck.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASPECTS, aspectSpec, cropRectFor } from './captureAspect.js';

// ── The list ───────────────────────────────────────────────────────────────

test('every aspect is complete, and Off really means off', () => {
  assert.ok(ASPECTS.length >= 4);
  const off = ASPECTS[0];
  assert.equal(off.id, null, 'the first entry must be the no-guide state');
  assert.equal(off.ratio, null);
  for (const a of ASPECTS.slice(1)) {
    assert.ok(a.id && a.label, `${a.id} is missing its copy`);
    assert.ok(a.ratio > 0, `${a.id} has no ratio`);
    assert.ok(a.cardsAcross > 0, `${a.id} has no cardsAcross, so the reframe can't size to it`);
  }
});

test('the ratios are the ones the labels claim', () => {
  const by = Object.fromEntries(ASPECTS.filter(a => a.id).map(a => [a.id, a.ratio]));
  assert.ok(Math.abs(by['9:16'] - 9 / 16) < 1e-9);
  assert.ok(Math.abs(by['4:5'] - 4 / 5) < 1e-9);
  assert.equal(by['1:1'], 1);
  assert.ok(Math.abs(by['16:9'] - 16 / 9) < 1e-9);
});

test('a taller frame wants fewer cards across than a wider one', () => {
  const by = Object.fromEntries(ASPECTS.filter(a => a.id).map(a => [a.id, a.cardsAcross]));
  assert.ok(by['9:16'] < by['1:1']);
  assert.ok(by['1:1'] < by['16:9']);
});

test('aspectSpec falls back to Off rather than throwing', () => {
  assert.equal(aspectSpec('nope').id, null);
  assert.equal(aspectSpec(null).id, null);
  assert.equal(aspectSpec('9:16').id, '9:16');
});

// ── The crop ───────────────────────────────────────────────────────────────

test('no ratio means no crop — the whole frame, not a square', () => {
  assert.deepEqual(cropRectFor(1920, 1080, null), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(cropRectFor(1920, 1080, 0), { x: 0, y: 0, w: 1920, h: 1080 });
});

test('a portrait crop out of a landscape frame is limited by height and centred', () => {
  // 2880×1800 is a 1440×900 tab on a 2× display — the real case.
  const r = cropRectFor(2880, 1800, 9 / 16);
  assert.equal(r.h, 1800, 'should use the full height');
  assert.equal(r.w, Math.round(1800 * 9 / 16));
  assert.equal(r.y, 0);
  assert.equal(r.x, Math.round((2880 - r.w) / 2), 'not centred horizontally');
});

test('a landscape crop out of a portrait frame is limited by width and centred', () => {
  const r = cropRectFor(1170, 2532, 16 / 9);   // an iPhone frame
  assert.equal(r.w, 1170);
  assert.equal(r.h, Math.round(1170 * 9 / 16));
  assert.equal(r.x, 0);
  assert.equal(r.y, Math.round((2532 - r.h) / 2));
});

test('the crop never leaves the frame, at any ratio or size', () => {
  const sizes = [[1920, 1080], [1170, 2532], [900, 900], [2880, 1800], [390, 664], [1, 1]];
  for (const [w, h] of sizes) {
    for (const a of ASPECTS) {
      const r = cropRectFor(w, h, a.ratio);
      assert.ok(r.x >= 0 && r.y >= 0, `${w}x${h} @ ${a.id}: negative origin`);
      assert.ok(r.x + r.w <= w, `${w}x${h} @ ${a.id}: overflows right`);
      assert.ok(r.y + r.h <= h, `${w}x${h} @ ${a.id}: overflows bottom`);
      assert.ok(r.w >= 1 && r.h >= 1, `${w}x${h} @ ${a.id}: empty crop`);
    }
  }
});

test('the crop is integral — a fractional rect would resample and soften the shot', () => {
  const r = cropRectFor(1001, 733, 16 / 9);
  for (const v of [r.x, r.y, r.w, r.h]) assert.equal(v, Math.round(v));
});

test('the resulting ratio is the one asked for', () => {
  for (const [w, h] of [[2880, 1800], [1170, 2532], [1440, 900]]) {
    for (const a of ASPECTS.filter(x => x.ratio)) {
      const r = cropRectFor(w, h, a.ratio);
      // Within a pixel of rounding on the shorter axis.
      assert.ok(Math.abs((r.w / r.h) - a.ratio) < 0.01,
        `${w}x${h} @ ${a.id}: got ${(r.w / r.h).toFixed(3)}, wanted ${a.ratio.toFixed(3)}`);
    }
  }
});

test('a matching frame is not cropped at all', () => {
  const r = cropRectFor(1080, 1920, 9 / 16);
  assert.deepEqual(r, { x: 0, y: 0, w: 1080, h: 1920 });
});

test('junk dimensions produce an empty rect rather than NaN', () => {
  for (const args of [[0, 0, 1], [NaN, NaN, 1], [null, null, null], [-5, -5, 2]]) {
    const r = cropRectFor(...args);
    for (const v of [r.x, r.y, r.w, r.h]) assert.ok(Number.isFinite(v), `NaN from ${JSON.stringify(args)}`);
  }
});
