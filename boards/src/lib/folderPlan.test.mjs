// folderPlan.test.mjs — a folder is priced in cards, cut to fit without empty
// clusters, and undone children-first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFolderImport, slicePlan, countPlan, postOrder } from './folderPlan.js';

const f = (name, type = 'image/jpeg', size = 1000) => ({ name, type, size });
const dir = (name, files = [], dirs = []) => ({ name, files, dirs });

test('a folder costs one card per file and one per cluster', () => {
  const root = dir(null, [f('loose.jpg')], [
    dir('Diner', [f('a.jpg'), f('b.jpg')], [dir('Day 2', [f('c.jpg')]), dir('Empty', [])]),
  ]);
  const plan = planFolderImport(root);
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.nodes[0].children.length, 1, 'an empty folder makes no cluster');
  assert.equal(plan.files, 3);
  assert.equal(plan.clusters, 2, 'clusters counts the nested one too');
  assert.equal(plan.cost, 5, '3 files + 2 clusters');
  assert.deepEqual(plan.loose.map((x) => x.name), ['loose.jpg'], 'loose files go the ordinary way');
  assert.deepEqual(plan.kinds, { image: 3 });
});

test('files the drop never takes are counted, not planned', () => {
  const root = dir(null, [], [dir('Mixed', [
    f('a.jpg'), f('draft.fountain', 'text/plain'), f('board.pur', ''), f('x.jpg.crdownload', ''),
    f('stems.zip', 'application/zip'),
  ])]);
  const free = planFolderImport(root, { canAttemptFiles: false });
  assert.equal(free.files, 1);
  assert.deepEqual(free.skipped, { partial: 1, pureref: 1, scripts: 1 });
  assert.deepEqual(free.blocked.map((x) => x.name), ['stems.zip'], 'a free owner\'s non-standard file is blocked');
  const paid = planFolderImport(root, { canAttemptFiles: true });
  assert.equal(paid.files, 3, 'on a paid plan the zip comes too, and the .pur as a file card');
  assert.equal(paid.skipped.pureref, 0);
});

test('slicing never leaves an empty cluster, and keeps the first folders whole', () => {
  const plan = planFolderImport(dir(null, [], [
    dir('A', [f('1.jpg'), f('2.jpg')], [dir('A1', [f('3.jpg')])]),
    dir('B', [f('4.jpg')]),
  ]));
  assert.equal(plan.cost, 7);
  const four = slicePlan(plan.nodes, 4);
  // A (1) + 1.jpg + 2.jpg = 3; A1 needs 2 more but only 1 is left → dropped.
  assert.deepEqual(countPlan(four), { clusters: 1, files: 2, cost: 3, kinds: { image: 2 }, depth: 1 });
  const one = slicePlan(plan.nodes, 1);
  assert.deepEqual(one, [], 'room for a cluster but nothing in it is not room at all');
  assert.equal(countPlan(slicePlan(plan.nodes, 99)).cost, 7);
  assert.equal(countPlan(slicePlan(plan.nodes, 0)).cost, 0);
});

test('a cluster with only subfolders still slices cleanly', () => {
  const plan = planFolderImport(dir(null, [], [dir('Top', [], [dir('Inner', [f('a.jpg')])])]));
  assert.equal(plan.cost, 3);
  assert.equal(countPlan(slicePlan(plan.nodes, 2)).cost, 0, 'Top + Inner + a.jpg needs 3');
  assert.equal(countPlan(slicePlan(plan.nodes, 3)).cost, 3);
});

test('undo order is children first', () => {
  const plan = planFolderImport(dir(null, [], [
    dir('A', [f('1.jpg')], [dir('A1', [f('2.jpg')], [dir('A1a', [f('3.jpg')])]), dir('A2', [f('4.jpg')])]),
  ]));
  assert.deepEqual(postOrder(plan.nodes, (n) => n.name), ['A1a', 'A1', 'A2', 'A']);
});
