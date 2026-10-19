// importPlan.test.mjs — what fits now, what waits, and the clusters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBulk, CLUSTER_FILE_CEILING } from './importPlan.js';
import { MEDIA_SLACK_BYTES } from './importPreflight.js';

const jpg = (name, size = 100) => ({ name, size, type: 'image/jpeg' });
const dir = (name, parent, files = [], dirs = []) => ({ name, relPath: parent ? `${parent}/${name}` : name, files, dirs });
const root = (...dirs) => ({ name: null, relPath: '', files: [], dirs });
const keys = (p) => p.clusters.map((c) => c.key);
const fitNames = (p) => p.fit.map((i) => i.file.name);
const waitNames = (p) => p.waiting.map((i) => i.file.name);

test('clusters come out pre-order with keys, parents and depths; loose files are ignored', () => {
  const r = root(
    dir('A', '', [jpg('a1.jpg')], [dir('B', 'A', [jpg('b1.jpg')], [dir('C', 'A/B', [jpg('c1.jpg')])]), dir('D', 'A', [jpg('d1.jpg')])]),
    dir('E', '', [jpg('e1.jpg')]),
  );
  r.files = [jpg('loose.jpg')];
  const p = planBulk(r);
  assert.deepEqual(keys(p), ['A', 'A/B', 'A/B/C', 'A/D', 'E']);
  assert.deepEqual(p.clusters.map((c) => c.parentKey), [null, 'A', 'A/B', 'A', null]);
  assert.deepEqual(p.clusters.map((c) => c.depth), [1, 2, 3, 2, 1]);
  assert.deepEqual(p.clusters.map((c) => c.part), [null, null, null, null, null]);
  assert.deepEqual(p.clusters.map((c) => c.files), [1, 1, 1, 1, 1]);
  assert.deepEqual(fitNames(p), ['a1.jpg', 'b1.jpg', 'c1.jpg', 'd1.jpg', 'e1.jpg']);
  assert.deepEqual(p.totals, { files: 5, bytes: 500, clusters: 5 });
  assert.equal(p.stoppedBy, null);
  const it = p.fit[0];
  assert.deepEqual([it.clusterKey, it.kind, it.route, it.bytes], ['A', 'image', 'image', 100]);
  assert.ok(it.w > 0 && it.h > 0);
});

test('clusterCost 0 vs 1 with a card stop, each cluster charged once', () => {
  const r = root(dir('A', '', [jpg('a1.jpg'), jpg('a2.jpg')], [dir('B', 'A', [jpg('b1.jpg'), jpg('b2.jpg')])]));
  // Free clusters: 3 cards = 3 files.
  const free = planBulk(r, { clusterCost: 0, cardsLeft: 3 });
  assert.deepEqual(fitNames(free), ['a1.jpg', 'a2.jpg', 'b1.jpg']);
  assert.deepEqual(waitNames(free), ['b2.jpg']);
  assert.equal(free.stoppedBy, 'cards');
  assert.equal(free.fitTotals.clustersNow, 2);
  // 1 per cluster: a1 = 1+1(A) = 2, a2 = 1, b1 = 1+1(B) = 2 -> 5 cards; 4 stops before b1.
  const paid = planBulk(r, { clusterCost: 1, cardsLeft: 4 });
  assert.deepEqual(fitNames(paid), ['a1.jpg', 'a2.jpg']);
  assert.deepEqual(waitNames(paid), ['b1.jpg', 'b2.jpg']);
  assert.equal(paid.fitTotals.clustersNow, 1);
  const all = planBulk(r, { clusterCost: 1, cardsLeft: 6 });
  assert.equal(all.fit.length, 4);
  assert.equal(all.stoppedBy, null);
  assert.equal(all.fitTotals.clustersNow, 2);
  // A nested first file pays for its whole unpaid ancestry: B under A under top.
  const deep = root(dir('A', '', [], [dir('B', 'A', [jpg('b1.jpg')])]));
  assert.equal(planBulk(deep, { clusterCost: 1, cardsLeft: 2 }).fit.length, 0);
  assert.equal(planBulk(deep, { clusterCost: 1, cardsLeft: 3 }).fitTotals.clustersNow, 2);
  assert.equal(planBulk(deep, { clusterCost: 0, cardsLeft: 0 }).fitTotals.clustersNow, 2);
});

test('a byte stop counts video slack and reports storage', () => {
  const vid = { name: 'v.mp4', size: 1000, type: 'video/mp4' };
  const r = root(dir('A', '', [vid, jpg('a.jpg', 50)]));
  const tight = planBulk(r, { bytesLeft: 1000 + MEDIA_SLACK_BYTES - 1 });
  assert.equal(tight.fit.length, 0);
  assert.equal(tight.stoppedBy, 'storage');
  const ok = planBulk(r, { bytesLeft: 1000 + MEDIA_SLACK_BYTES });
  assert.deepEqual(fitNames(ok), ['v.mp4']);
  assert.deepEqual(waitNames(ok), ['a.jpg']);
  assert.equal(ok.fitTotals.bytes, 1000);
  assert.equal(ok.totals.bytes, 1050);
  // Cards are checked first.
  assert.equal(planBulk(r, { cardsLeft: 0, bytesLeft: 0 }).stoppedBy, 'cards');
});

test('unknown budgets are unlimited, negatives clamp to zero', () => {
  const r = root(dir('A', '', [jpg('a.jpg'), jpg('b.jpg')]));
  for (const v of [null, undefined, Infinity, NaN, 'x']) {
    const p = planBulk(r, { cardsLeft: v, bytesLeft: v });
    assert.equal(p.fit.length, 2);
    assert.equal(p.stoppedBy, null);
  }
  const neg = planBulk(r, { cardsLeft: -5 });
  assert.equal(neg.fit.length, 0);
  assert.equal(neg.stoppedBy, 'cards');
});

test('the ceiling splits 4,516 files into 1,506 / 1,505 / 1,505 before the subfolders', () => {
  assert.equal(CLUSTER_FILE_CEILING, 2000);
  const many = Array.from({ length: 4516 }, (_, i) => jpg(`f${i}.jpg`, 1));
  const r = root(dir('Big', '', many, [dir('Sub', 'Big', [jpg('s.jpg')])]));
  const p = planBulk(r, { clusterCost: 0 });
  assert.deepEqual(keys(p), ['Big', 'Big#1', 'Big#2', 'Big#3', 'Big/Sub']);
  assert.equal(p.clusters[0].files, 0);
  assert.deepEqual(p.clusters.slice(1, 4).map((c) => c.files), [1506, 1505, 1505]);
  assert.deepEqual(p.clusters.slice(1, 4).map((c) => c.name), ['Big · 1 of 3', 'Big · 2 of 3', 'Big · 3 of 3']);
  assert.deepEqual(p.clusters[2].part, { index: 2, of: 3 });
  assert.deepEqual(p.clusters.slice(1, 4).map((c) => [c.parentKey, c.depth]), [['Big', 2], ['Big', 2], ['Big', 2]]);
  assert.deepEqual([p.clusters[4].parentKey, p.clusters[4].depth], ['Big', 2]);
  assert.equal(p.fit[0].clusterKey, 'Big#1');
  assert.equal(p.fit[1506].clusterKey, 'Big#2');
  assert.equal(p.fit[4515].clusterKey, 'Big#3');
  assert.equal(p.fit[4516].clusterKey, 'Big/Sub');
  assert.equal(p.fit[1506].file.name, 'f1506.jpg');
  assert.equal(p.fit[1505].clusterKey, 'Big#1');
  // Exactly at the ceiling does not split.
  const even = root(dir('E', '', Array.from({ length: 2000 }, (_, i) => jpg(`e${i}.jpg`))));
  assert.deepEqual(keys(planBulk(even)), ['E']);
  // Charging a part pays the folder too, once.
  const small = planBulk(root(dir('X', '', [jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg')])), { ceiling: 2, cardsLeft: 1000 });
  assert.deepEqual(keys(small), ['X', 'X#1', 'X#2']);
  assert.deepEqual(small.clusters.map((c) => c.files), [0, 2, 1]);
  assert.equal(small.fitTotals.clustersNow, 3);
});

test('skipped and blocked routes, and a folder emptied by skipping makes no cluster', () => {
  const routes = { 'p.crdownload': 'partial', 'r.pur': 'pureref', 's.fdx': 'screenplay', 'bad.x': 'blocked' };
  const classify = (f) => {
    const route = routes[f.name];
    return route ? { route, kind: 'file', w: 1, h: 1 } : { route: 'file', kind: 'file', w: 2, h: 3 };
  };
  const bad = { name: 'bad.x', size: 1, type: '' };
  const r = root(
    dir('Gone', '', [{ name: 'p.crdownload', size: 1 }, { name: 'r.pur', size: 1 }], [dir('AlsoGone', 'Gone', [{ name: 's.fdx', size: 1 }, bad])]),
    dir('Stay', '', [{ name: 'ok.bin', size: 7 }]),
    dir('Empty', ''),
  );
  const p = planBulk(r, { classify });
  assert.deepEqual(keys(p), ['Stay']);
  assert.deepEqual(p.skipped, { partial: 1, pureref: 1, scripts: 1 });
  assert.deepEqual(p.blocked, [bad]);
  assert.deepEqual(fitNames(p), ['ok.bin']);
  assert.equal(p.fit[0].w, 2);
  // A parent with no files of its own survives when a child has some.
  const q = planBulk(root(dir('P', '', [], [dir('K', 'P', [jpg('k.jpg')])])));
  assert.deepEqual(keys(q), ['P', 'P/K']);
  assert.equal(q.clusters[0].files, 0);
});

test('the fit/waiting boundary stays in strict reading order, never skipping ahead', () => {
  const r = root(
    dir('A', '', [jpg('a1.jpg', 10), jpg('a2.jpg', 500), jpg('a3.jpg', 10)], [dir('B', 'A', [jpg('b1.jpg', 10)])]),
    dir('C', '', [jpg('c1.jpg', 10)]),
  );
  const p = planBulk(r, { clusterCost: 0, bytesLeft: 100 });
  assert.deepEqual(fitNames(p), ['a1.jpg']);
  assert.deepEqual(waitNames(p), ['a2.jpg', 'a3.jpg', 'b1.jpg', 'c1.jpg']);
  assert.equal(p.stoppedBy, 'storage');
  assert.deepEqual(p.fit.concat(p.waiting).map((i) => i.file.name), ['a1.jpg', 'a2.jpg', 'a3.jpg', 'b1.jpg', 'c1.jpg']);
  assert.equal(p.totals.files, 5);
  assert.equal(p.fitTotals.files, 1);
});
