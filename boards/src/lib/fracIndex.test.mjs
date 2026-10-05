// Fractional index keys.
//
// The property that matters is not "produces a key" — it is that the key is
// STRICTLY between its neighbours, every time, no matter how many times you
// insert in the same place. A rundown row whose key ties with its neighbour has
// no defined order, which shows up as a row that jumps somewhere else after a
// reload and is essentially impossible to reproduce on purpose.

import test from 'node:test';
import assert from 'node:assert/strict';
import { between, sequence, isFracKey } from './fracIndex.js';

test('an empty list, a prepend and an append all produce ordered keys', () => {
  const first = between(null, null);
  assert.ok(isFracKey(first));
  assert.ok(between(null, first) < first, 'prepend sorts before');
  assert.ok(between(first, null) > first, 'append sorts after');
});

test('a key lands strictly between its neighbours', () => {
  const a = between(null, null);
  const c = between(a, null);
  const b = between(a, c);
  assert.ok(a < b && b < c, `${a} < ${b} < ${c}`);
});

test('inserting in the same gap 500 times never ties', () => {
  // The float-midpoint approach dies at about 50. This is the whole reason the
  // keys are strings.
  let lo = between(null, null);
  const hi = between(lo, null);
  const seen = new Set([lo, hi]);
  for (let i = 0; i < 500; i++) {
    const k = between(lo, hi);
    assert.ok(lo < k && k < hi, `iteration ${i}: ${lo} < ${k} < ${hi}`);
    assert.ok(!seen.has(k), `iteration ${i}: duplicate key ${k}`);
    seen.add(k);
    lo = k;                       // keep closing the gap from below
  }
});

test('repeated prepending stays ordered and never collides', () => {
  let head = between(null, null);
  const seen = new Set([head]);
  for (let i = 0; i < 200; i++) {
    const k = between(null, head);
    assert.ok(k < head, `iteration ${i}: ${k} < ${head}`);
    assert.ok(!seen.has(k));
    seen.add(k);
    head = k;
  }
});

test('repeated appending stays ordered and never collides', () => {
  let tail = between(null, null);
  const seen = new Set([tail]);
  for (let i = 0; i < 200; i++) {
    const k = between(tail, null);
    assert.ok(k > tail, `iteration ${i}: ${k} > ${tail}`);
    assert.ok(!seen.has(k));
    seen.add(k);
    tail = k;
  }
});

test('a list built by repeated insertion sorts back into insertion order', () => {
  // Build [a, …, z] by always inserting into the middle of the current list,
  // then confirm a plain string sort reproduces the intended order.
  const list = [between(null, null)];
  const order = [...list];
  for (let i = 0; i < 120; i++) {
    const at = (i * 7 + 3) % (list.length + 1);        // deterministic scatter
    const lo = at === 0 ? null : list[at - 1];
    const hi = at === list.length ? null : list[at];
    const k = between(lo, hi);
    list.splice(at, 0, k);
    order.splice(at, 0, k);
  }
  const sorted = [...list].sort();
  assert.deepEqual(sorted, order, 'string sort must equal intended order');
  assert.equal(new Set(list).size, list.length, 'all keys distinct');
});

test('out-of-order bounds throw rather than inventing a key', () => {
  const a = between(null, null);
  const b = between(a, null);
  assert.throws(() => between(b, a), /out of order/);
  assert.throws(() => between(a, a), /out of order/);
});

test('junk bounds are treated as open ends, not crashes', () => {
  for (const junk of [undefined, '', null, 42, {}, 'has space', '!!']) {
    const k = between(junk, null);
    assert.ok(isFracKey(k), String(junk));
  }
});

test('sequence gives n distinct keys already in order', () => {
  for (const n of [0, 1, 2, 5, 40, 200]) {
    const s = sequence(n);
    assert.equal(s.length, n, `n=${n}`);
    assert.equal(new Set(s).size, n, `n=${n}: distinct`);
    assert.deepEqual([...s].sort(), s, `n=${n}: already sorted`);
  }
});

test('you can still insert around a seeded sequence', () => {
  const s = sequence(8);
  assert.ok(between(null, s[0]) < s[0], 'before the first');
  assert.ok(between(s[7], null) > s[7], 'after the last');
  const mid = between(s[3], s[4]);
  assert.ok(s[3] < mid && mid < s[4], 'between two seeded keys');
});
