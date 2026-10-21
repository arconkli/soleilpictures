// The Universe's grid repulsion is d3's many-body force, without the tree.
//
// d3-force-3d's forceManyBody with theta 0 never approximates: it visits every
// node in reach and applies its law pair by pair. That is exactly what
// forceGridCharge claims to compute, so the two must agree to rounding on any
// layout, including the cases a grid gets wrong first: pairs across a cell
// boundary, negative coordinates, pairs just inside and just past the reach,
// pairs closer than 1, and cells whose hashes collide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forceManyBody } from 'd3-force-3d';
import { forceGridCharge } from './universeCharge.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function layout(n, span, seed) {
  const r = lcg(seed);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ index: i, x: (r() - 0.5) * span, y: (r() - 0.5) * span * 0.2, z: (r() - 0.5) * span, vx: 0, vy: 0, vz: 0 });
  }
  return nodes;
}

const strengthOf = (node) => -20 - 130 * ((node.index * 2654435761 >>> 0) / 4294967296);

function run(force, nodes, alpha) {
  const copy = nodes.map((d) => ({ ...d }));
  force.initialize(copy, Math.random, 3);
  force(alpha);
  return copy;
}

function assertSame(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (const k of ['vx', 'vy', 'vz']) {
      const tol = 1e-9 * (1 + Math.abs(b[i][k]));
      assert.ok(Math.abs(a[i][k] - b[i][k]) <= tol, `node ${i} ${k}: grid ${a[i][k]} vs d3 ${b[i][k]}`);
    }
  }
}

test('matches d3 pair for pair on a spread-out disk', () => {
  const nodes = layout(900, 2400, 7);
  const grid = run(forceGridCharge().strength(strengthOf).distanceMax(90), nodes, 0.7);
  const d3 = run(forceManyBody().theta(0).strength(strengthOf).distanceMax(90), nodes, 0.7);
  assertSame(grid, d3);
  assert.ok(grid.some((d) => d.vx !== 0), 'the layout actually has pairs in reach');
});

test('matches d3 when everything is crowded into a few cells', () => {
  const nodes = layout(400, 160, 11);
  const grid = run(forceGridCharge().strength(strengthOf).distanceMax(90), nodes, 0.3);
  const d3 = run(forceManyBody().theta(0).strength(strengthOf).distanceMax(90), nodes, 0.3);
  assertSame(grid, d3);
});

test('the edges: cell boundaries, the reach, and pairs closer than 1', () => {
  // No pair shares a coordinate exactly: d3 replaces an exactly-zero component
  // with a random jiggle, which no deterministic force can match, and which the
  // seeded layout never produces short of two nodes on top of each other.
  const at = (index, x, y, z) => ({ index, x, y, z, vx: 0, vy: 0, vz: 0 });
  const nodes = [
    at(0, 89.9, 0.3, 0.2), at(1, 90.1, -0.2, 0.7),          // either side of a cell wall
    at(2, -0.4, -0.45, -0.35), at(3, 0.2, 0.1, 0.05),       // across the origin, under 1 apart
    at(4, -300, 5, -300.5), at(5, -300 + 89.9, 5.2, -300.1), // just inside the reach
    at(6, 500, 1, 500), at(7, 590, 1.5, 500.25),            // past the reach: no force
    at(8, 1e4, 0.5, -1e4), at(9, 1e4 + 30, 20, -1e4 - 40),
  ];
  const grid = run(forceGridCharge().strength(-50).distanceMax(90), nodes, 1);
  const d3 = run(forceManyBody().theta(0).strength(-50).distanceMax(90), nodes, 1);
  assertSame(grid, d3);
  assert.equal(grid[6].vx, 0, 'a pair past distanceMax does not interact');
  assert.ok(grid[0].vx < 0 && grid[1].vx > 0, 'a pair across a cell wall repels');
});

test('a tiny hash table still counts each pair once', () => {
  // Two nodes and 2*2 buckets: neighbouring cells collide in the table, and a
  // collision that slipped through would double this pair's force.
  const nodes = [{ index: 0, x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, { index: 1, x: 40, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }];
  const grid = run(forceGridCharge().strength(-30).distanceMax(20), nodes, 1);
  assert.equal(grid[0].vx, 0, '30 apart with a reach of 20');
  const near = run(forceGridCharge().strength(-30).distanceMax(90), nodes, 1);
  assert.ok(Math.abs(near[0].vx - (30 * -30 / 900)) < 1e-12, 'one pair, counted once');
});

test('nodes on top of each other are pushed apart, and the same way every time', () => {
  const nodes = [{ index: 0, x: 3, y: 3, z: 3, vx: 0, vy: 0, vz: 0 }, { index: 1, x: 3, y: 3, z: 3, vx: 0, vy: 0, vz: 0 }];
  const a = run(forceGridCharge().strength(-30).distanceMax(90), nodes, 1);
  const b = run(forceGridCharge().strength(-30).distanceMax(90), nodes, 1);
  assert.ok(a[0].vx < 0 && a[1].vx > 0);
  assert.deepEqual(a, b);
});
