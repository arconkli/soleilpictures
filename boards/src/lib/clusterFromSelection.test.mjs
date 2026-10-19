// clusterFromSelection.test.mjs — "New cluster from N cards" moves what a drag
// would move, refuses what a drag can't, lands where the cards were, and
// suggests a name only when there is a real one to suggest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planClusterFromSelection, suggestClusterName, sharedStem } from './clusterFromSelection.js';

const card = (id, extra = {}) => ({ id, kind: 'image', x: 0, y: 0, w: 100, h: 100, src: 'r2:' + id, ...extra });

test('a group travels whole, the way a drag takes it', () => {
  const cards = [
    card('a', { groupId: 'g1' }), card('b', { groupId: 'g1' }), card('c', { groupId: 'g1' }),
    card('d'), card('solo', { groupId: 'g2' }),
  ];
  const plan = planClusterFromSelection({ cards, ids: ['a', 'd'] });
  assert.deepEqual(plan.ids.sort(), ['a', 'b', 'c', 'd']);
  assert.equal(plan.groupId, null, 'two sources, no single group');
  const lone = planClusterFromSelection({ cards, ids: ['solo'] });
  assert.deepEqual(lone.ids, ['solo'], 'a group of one is just a card');
  const one = planClusterFromSelection({ cards, ids: ['b'] });
  assert.equal(one.groupId, 'g1', 'the whole selection is one group');
  assert.deepEqual(planClusterFromSelection({ cards, ids: ['a', 'd'], wholeGroups: false }).ids, ['a', 'd'], 'the list view moves exactly what is selected');
});

test('a selection holding a cluster is refused, a sweep leaves the cluster where it is', () => {
  const cards = [card('a'), card('k', { kind: 'board' }), card('l', { kind: 'boardlink', target: 'x' })];
  const refused = planClusterFromSelection({ cards, ids: ['a', 'k'] });
  assert.equal(refused.refused, 'cluster');
  assert.deepEqual(refused.ids, []);
  const sweep = planClusterFromSelection({ cards, ids: ['a', 'k', 'l'], clusters: 'skip' });
  assert.deepEqual(sweep.ids, ['a']);
  assert.equal(sweep.refused, null);
});

test('a card still uploading stays put and is counted as held', () => {
  const cards = [card('a'), card('up', { src: null, pending: true })];
  const plan = planClusterFromSelection({ cards, ids: ['a', 'up'] });
  assert.deepEqual(plan.ids, ['a']);
  assert.deepEqual(plan.held.map((c) => c.id), ['up']);
  const only = planClusterFromSelection({ cards, ids: ['up'] });
  assert.deepEqual(only.ids, [], 'nothing left to move means no cluster');
});

test('seeds are skipped only when asked', () => {
  const cards = [card('a'), card('onb-1', { kind: 'note' }), card('s', { seed: true })];
  assert.equal(planClusterFromSelection({ cards, ids: ['a', 'onb-1', 's'] }).ids.length, 3);
  assert.deepEqual(planClusterFromSelection({ cards, ids: ['a', 'onb-1', 's'], skipSeeds: true }).ids, ['a']);
});

test('the new cluster lands at the centre of the placed cards', () => {
  const cards = [
    card('a', { x: 100, y: 100, w: 200, h: 100 }),
    card('b', { x: 500, y: 300, w: 100, h: 100 }),
    card('f', { x: 9000, y: 9000, unplaced: true }),
  ];
  assert.deepEqual(planClusterFromSelection({ cards, ids: ['a', 'b', 'f'] }).center, { x: 350, y: 250 });
  assert.equal(planClusterFromSelection({ cards, ids: ['f'] }).center, null, 'a card waiting in Files has no place');
  assert.deepEqual(planClusterFromSelection({ cards, ids: ['missing'] }).ids, []);
});

test('a name: the group first, then what the files share, then the first note', () => {
  const files = [card('a', { fileName: 'kitchen-ref_01.jpg' }), card('b', { fileName: 'kitchen-ref_02.jpg' })];
  assert.equal(suggestClusterName({ groupName: 'Diner exteriors', cards: files }), 'Diner exteriors');
  assert.equal(suggestClusterName({ groupName: 'Group', cards: files }), 'Kitchen ref', 'a default group name is no name');
  const note = { id: 'n', kind: 'note', html: '<p>Lost Time · act 2</p><p>Moe finds the clock.</p>' };
  assert.equal(suggestClusterName({ cards: [card('x', { fileName: 'IMG_2034.HEIC' }), note] }), 'Lost Time · act 2');
  assert.equal(suggestClusterName({ cards: [card('x')] }), null);
  const long = { id: 'n2', kind: 'note', html: 'Moe finds the clock and the chase starts in the market and ends up on the roof at night' };
  const got = suggestClusterName({ cards: [long] });
  assert.ok(got.length <= 60 && !got.endsWith(' '), got);
});

test('a shared stem is whole words, never a camera prefix', () => {
  assert.equal(sharedStem(['kitchen_01.jpg', 'kitchen_02.jpg']), 'Kitchen');
  assert.equal(sharedStem(['kitchen.jpg', 'kitten.jpg']), null, 'half a word is not a name');
  assert.equal(sharedStem(['Lost Time poster.png', 'Lost Time still.webp']), 'Lost Time');
  assert.equal(sharedStem(['IMG_2034.HEIC', 'IMG_2035.HEIC']), null);
  assert.equal(sharedStem(['Screenshot 2026-10-18 at 10.32.11.png', 'Screenshot 2026-10-18 at 10.40.02.png']), null);
  assert.equal(sharedStem(['mood-board-final.pdf']), 'Mood board final', 'one name works too');
  assert.equal(sharedStem(['a1.jpg', 'a2.jpg']), null, 'too short');
  assert.equal(sharedStem([]), null);
});
