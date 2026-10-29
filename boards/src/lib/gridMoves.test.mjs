// The grid bar's even boxes / even out, the multi-file drop plan and arrow-key
// moves between boxes. All pure tree / rect math.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evenTree, evenOut, planCellFill, neighborCell, computeCellRects, readingOrder, BOXES_MAX,
} from './gridLayout.js';

const counter = () => { let i = 0; return () => 'k' + (++i); };
const BOX = { x: 0, y: 0, w: 400, h: 300 };

// ── evenTree ────────────────────────────────────────────────────────────────

test('evenTree 1x1 is a single leaf with frac 1', () => {
  assert.deepEqual(evenTree(1, 1, counter()), { type: 'leaf', id: 'k1', frac: 1 });
});

test('evenTree 3 columns x 1 row is a row of three thirds', () => {
  const t = evenTree(3, 1, counter());
  assert.equal(t.type, 'row');
  assert.equal(t.children.length, 3);
  t.children.forEach((c) => { assert.equal(c.type, 'leaf'); assert.equal(c.frac, 1 / 3); });
});

test('evenTree 1 column x 2 rows is a col of two halves', () => {
  const t = evenTree(1, 2, counter());
  assert.equal(t.type, 'col');
  assert.equal(t.children.length, 2);
  t.children.forEach((c) => { assert.equal(c.type, 'leaf'); assert.equal(c.frac, 1 / 2); });
});

test('evenTree 3x2 is a col of two rows of three', () => {
  const t = evenTree(3, 2, counter());
  assert.equal(t.type, 'col');
  assert.equal(t.children.length, 2);
  t.children.forEach((r) => {
    assert.equal(r.type, 'row');
    assert.equal(r.frac, 1 / 2);
    assert.equal(r.children.length, 3);
    r.children.forEach((c) => { assert.equal(c.type, 'leaf'); assert.equal(c.frac, 1 / 3); });
  });
});

test('evenTree mints ids in row-major order, once per box', () => {
  let calls = 0;
  const mk = () => 'k' + (++calls);
  const t = evenTree(3, 2, mk);
  assert.equal(calls, 6);
  assert.deepEqual(readingOrder(computeCellRects(t, BOX)), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
});

test('evenTree clamps 0 to 1 and 99 to BOXES_MAX', () => {
  assert.equal(BOXES_MAX, 12);
  assert.deepEqual(evenTree(0, 0, counter()), { type: 'leaf', id: 'k1', frac: 1 });
  const t = evenTree(99, 1, counter());
  assert.equal(t.type, 'row');
  assert.equal(t.children.length, 12);
  const big = evenTree(99, 99, counter());
  assert.equal(big.children.length, 12);
  assert.equal(big.children[0].children.length, 12);
});

// ── evenOut ─────────────────────────────────────────────────────────────────

test('evenOut gives every split equal shares, keeps leaf ids, leaves the input alone', () => {
  const uneven = {
    type: 'col',
    children: [
      { type: 'leaf', id: 'a', frac: 0.7 },
      {
        type: 'row', frac: 0.3,
        children: [
          { type: 'leaf', id: 'b', frac: 0.1 },
          { type: 'leaf', id: 'c', frac: 0.6 },
          { type: 'row', frac: 0.3, children: [{ type: 'leaf', id: 'd', frac: 0.9 }, { type: 'leaf', id: 'e', frac: 0.1 }] },
        ],
      },
    ],
  };
  const before = JSON.parse(JSON.stringify(uneven));
  const out = evenOut(uneven);
  assert.deepEqual(uneven, before);
  const [a, row] = out.children;
  assert.equal(a.id, 'a'); assert.equal(a.frac, 1 / 2);
  assert.equal(row.frac, 1 / 2);
  assert.deepEqual(row.children.map((c) => c.frac), [1 / 3, 1 / 3, 1 / 3]);
  const [d, e] = row.children[2].children;
  assert.deepEqual([d.id, d.frac, e.id, e.frac], ['d', 1 / 2, 'e', 1 / 2]);
  assert.deepEqual(row.children.slice(0, 2).map((c) => c.id), ['b', 'c']);
});

test('evenOut of nothing is nothing', () => {
  assert.equal(evenOut(null), null);
});

// ── planCellFill ────────────────────────────────────────────────────────────

// 3x2: k1 k2 k3 / k4 k5 k6. Empty: k1 (no record), k3 (image without src), k5.
const rects = computeCellRects(evenTree(3, 2, counter()), BOX);
const cells = {
  k2: { type: 'image', src: 'https://x/a.jpg' },
  k3: { type: 'image' },
  k4: { type: 'text', html: '<p>hi</p>' },
  k5: { type: 'empty' },
  k6: { type: 'image', src: 'https://x/b.jpg' },
};

test('planCellFill from an empty box: it, later empties, then earlier empties', () => {
  assert.deepEqual(planCellFill(rects, cells, 'k3', 9), ['k3', 'k5', 'k1']);
});

test('planCellFill from a filled box puts it first, then the empties', () => {
  assert.deepEqual(planCellFill(rects, cells, 'k2', 9), ['k2', 'k3', 'k5', 'k1']);
  assert.deepEqual(planCellFill(rects, cells, 'k4', 9), ['k4', 'k5', 'k1', 'k3']);
});

test('planCellFill caps the result at n', () => {
  assert.deepEqual(planCellFill(rects, cells, 'k5', 2), ['k5', 'k1']);
  assert.deepEqual(planCellFill(rects, cells, 'k2', 1), ['k2']);
  assert.deepEqual(planCellFill(rects, cells, 'k2', 0), []);
  assert.deepEqual(planCellFill(rects, cells, 'k2', 'x'), []);
});

test('planCellFill counts an image record without a src as empty', () => {
  const full = { k1: { type: 'text' }, k2: { type: 'text' }, k3: { type: 'image', src: '' }, k4: { type: 'text' }, k5: { type: 'text' }, k6: { type: 'text' } };
  assert.deepEqual(planCellFill(rects, full, 'k1', 9), ['k1', 'k3']);
});

test('planCellFill with an unknown start id fills empties from the top', () => {
  assert.deepEqual(planCellFill(rects, cells, 'nope', 9), ['k1', 'k3', 'k5']);
  assert.deepEqual(planCellFill(rects, null, undefined, 2), ['k1', 'k2']);
});

// ── neighborCell ────────────────────────────────────────────────────────────

test('neighborCell moves across a 2x2 grid and stops at the edges', () => {
  const r = computeCellRects(evenTree(2, 2, counter()), BOX);   // k1 k2 / k3 k4
  assert.equal(neighborCell(r, 'k1', 'right'), 'k2');
  assert.equal(neighborCell(r, 'k1', 'down'), 'k3');
  assert.equal(neighborCell(r, 'k4', 'left'), 'k3');
  assert.equal(neighborCell(r, 'k4', 'up'), 'k2');
  assert.equal(neighborCell(r, 'k1', 'left'), null);
  assert.equal(neighborCell(r, 'k1', 'up'), null);
  assert.equal(neighborCell(r, 'k4', 'right'), null);
  assert.equal(neighborCell(r, 'k4', 'down'), null);
  assert.equal(neighborCell(r, 'missing', 'right'), null);
});

test('neighborCell in the storyboard shape: down picks the left box on a tie, up returns the top', () => {
  const tree = {
    type: 'col',
    children: [
      { type: 'leaf', id: 'top', frac: 0.5 },
      { type: 'row', frac: 0.5, children: [{ type: 'leaf', id: 'bl', frac: 0.5 }, { type: 'leaf', id: 'br', frac: 0.5 }] },
    ],
  };
  const r = computeCellRects(tree, BOX);
  assert.equal(neighborCell(r, 'top', 'down'), 'bl');
  assert.equal(neighborCell(r, 'br', 'up'), 'top');
  assert.equal(neighborCell(r, 'bl', 'up'), 'top');
  assert.equal(neighborCell(r, 'bl', 'right'), 'br');
});
