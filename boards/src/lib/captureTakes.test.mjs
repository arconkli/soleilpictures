// captureTakes.test.mjs — the move vocabulary and the named sequences.
//
// The recorder derives when to stop from takeDuration(), so a take whose
// arithmetic is wrong doesn't misbehave visibly — it produces a clip that cuts
// off mid-move, or sits on a dead frame for two seconds at the end. That is the
// kind of bug you find in the edit, not in the app, so the timings are pinned
// here rather than eyeballed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKES, MOVE_TYPES, DEFAULT_MOVE_MS,
  isMove, normalizeMove, normalizeMoves, takeDuration, takeFor, resolveTake,
} from './captureTakes.js';
import { EASINGS, easingFor, DEFAULT_EASE } from './captureCamera.js';

// ── Moves ──────────────────────────────────────────────────────────────────

test('a move needs a known type', () => {
  assert.equal(isMove({ type: 'fit' }), true);
  assert.equal(isMove({ type: 'nope' }), false);
  assert.equal(isMove(null), false);
  assert.equal(isMove({}), false);
});

test('normalizeMove fills a duration and an easing', () => {
  const m = normalizeMove({ type: 'fit' });
  assert.equal(m.ms, DEFAULT_MOVE_MS);
  assert.equal(m.ease, DEFAULT_EASE);
});

test('a zero duration is preserved — it means CUT, not "use the default"', () => {
  // Takes open with `{ ms: 0 }` to set a starting pose before the first tween.
  // Coercing that to 900ms would make every take begin with a slow drift from
  // wherever the camera happened to be.
  assert.equal(normalizeMove({ type: 'zoom', by: 2, ms: 0 }).ms, 0);
});

test('junk durations fall back rather than poisoning the timeline', () => {
  assert.equal(normalizeMove({ type: 'fit', ms: -5 }).ms, DEFAULT_MOVE_MS);
  assert.equal(normalizeMove({ type: 'fit', ms: NaN }).ms, DEFAULT_MOVE_MS);
  assert.equal(normalizeMove({ type: 'fit', ms: 'slow' }).ms, DEFAULT_MOVE_MS);
  // A take that ran for an hour would look like a hang.
  assert.equal(normalizeMove({ type: 'fit', ms: 1e9 }).ms, 20000);
});

test('move-specific fields survive normalisation', () => {
  assert.equal(normalizeMove({ type: 'zoom', by: 2.4 }).by, 2.4);
  assert.equal(normalizeMove({ type: 'pan', dx: 160, dy: -60 }).dy, -60);
  assert.equal(normalizeMove({ type: 'card', id: 'c1' }).id, 'c1');
});

test('normalizeMoves drops what is not a move instead of throwing', () => {
  const out = normalizeMoves([{ type: 'fit' }, null, { type: 'bogus' }, 'x', { type: 'hold', ms: 10 }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(m => m.type), ['fit', 'hold']);
  assert.deepEqual(normalizeMoves(null), []);
});

// ── Duration ───────────────────────────────────────────────────────────────

test('takeDuration is the sum of the moves', () => {
  assert.equal(takeDuration([{ type: 'fit', ms: 1000 }, { type: 'hold', ms: 500 }]), 1500);
  assert.equal(takeDuration([]), 0);
  assert.equal(takeDuration(null), 0);
});

test('every shipped take reports a duration the recorder can use', () => {
  for (const t of TAKES) {
    const ms = takeDuration(t.moves);
    assert.ok(ms > 1000, `"${t.id}" is ${ms}ms — too short to be a clip`);
    assert.ok(ms < 20000, `"${t.id}" is ${ms}ms — too long for a social cut`);
  }
});

// ── The shipped takes ──────────────────────────────────────────────────────

test('every take is complete and uses only real moves and easings', () => {
  assert.ok(TAKES.length >= 4);
  for (const t of TAKES) {
    assert.ok(t.id && t.label && t.blurb, `"${t.id}" is missing its copy`);
    assert.ok(t.moves.length >= 2, `"${t.id}" is not a sequence`);
    for (const m of t.moves) {
      assert.ok(MOVE_TYPES.includes(m.type), `"${t.id}" uses unknown move "${m.type}"`);
      if (m.ease) assert.ok(m.ease in EASINGS, `"${t.id}" uses unknown easing "${m.ease}"`);
    }
  }
});

test('take ids are unique — they are what the HUD and the shot list address', () => {
  assert.equal(new Set(TAKES.map(t => t.id)).size, TAKES.length);
});

test('a narrative take ends on a hold; a looping one returns to its start', () => {
  // Two different endings, for two different jobs. A clip that stops on the
  // last frame of a move looks cut off, so the narrative takes end on a beat.
  // A loop must not have that beat — it would stutter at the splice — and must
  // instead land exactly where it began.
  for (const t of TAKES) {
    if (!t.loop) {
      assert.equal(t.moves[t.moves.length - 1].type, 'hold',
        `"${t.id}" ends mid-move — the clip will look truncated`);
      continue;
    }
    const net = t.moves.filter(m => m.type === 'pan')
      .reduce((a, m) => ({ x: a.x + (m.dx || 0), y: a.y + (m.dy || 0) }), { x: 0, y: 0 });
    assert.deepEqual(net, { x: 0, y: 0 },
      `"${t.id}" is marked loop but drifts by ${net.x},${net.y} — the seam will jump`);
    assert.equal(t.moves.some(m => m.type === 'fit' || m.type === 'zoom'), true,
      `"${t.id}" never establishes a pose, so its loop starts from wherever you were`);
  }
});

test('takeFor and resolveTake handle an unknown id', () => {
  assert.equal(takeFor('nope'), null);
  assert.deepEqual(resolveTake('nope'), []);
  assert.deepEqual(resolveTake(null), []);
  assert.ok(resolveTake('establish').length > 0);
});

test('resolveTake returns normalised moves, ready to play', () => {
  for (const m of resolveTake('establish')) {
    assert.ok(Number.isFinite(m.ms));
    assert.ok(m.ease in EASINGS);
  }
});

// ── Easings ────────────────────────────────────────────────────────────────

test('every easing pins both ends and stays in range', () => {
  for (const [name, fn] of Object.entries(EASINGS)) {
    assert.ok(Math.abs(fn(0)) < 1e-9, `${name} does not start at 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name} does not end at 1`);
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const v = fn(i / 50);
      assert.ok(v >= prev - 1e-12, `${name} reverses at t=${i / 50}`);
      assert.ok(v >= 0 && v <= 1, `${name} leaves the unit range at t=${i / 50}`);
      prev = v;
    }
  }
});

test('the easings are genuinely different curves', () => {
  // Otherwise there is no point offering a choice.
  const mid = Object.entries(EASINGS).map(([n, f]) => [n, Math.round(f(0.25) * 1000)]);
  assert.equal(new Set(mid.map(m => m[1])).size, mid.length,
    `two easings agree at t=0.25: ${JSON.stringify(mid)}`);
});

test('settle leads and lead trails, at the quarter mark', () => {
  // Names have to mean something: `settle` leaves fast and lands gently,
  // `lead` starts gently and arrives fast.
  assert.ok(EASINGS.settle(0.25) > EASINGS.smooth(0.25));
  assert.ok(EASINGS.lead(0.25) < EASINGS.smooth(0.25));
});

test('an unknown easing name falls back rather than throwing', () => {
  assert.equal(easingFor('made-up'), EASINGS[DEFAULT_EASE]);
  assert.equal(easingFor(undefined), EASINGS[DEFAULT_EASE]);
});
