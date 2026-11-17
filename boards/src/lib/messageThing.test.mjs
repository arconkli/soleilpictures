import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thingLine, thingOf, sharedUnits, unitAttachments, storageKey, kindWord, unitMeta } from './messageThing.js';

const card = { kind: 'card', title: 'Alley, neon', count: 1 };
const cards = { kind: 'card', title: 'Alley, neon', count: 3 };
const cluster = { kind: 'board', title: 'Night shoot', count: 0 };

test('thingLine: not mine, no who', () => {
  assert.equal(thingLine(card), 'Sent a card: Alley, neon');
  assert.equal(thingLine(cards), 'Sent 3 cards');
  assert.equal(thingLine(cluster), 'Sent Night shoot');
  assert.equal(thingLine({ kind: 'card', title: '', count: 1 }), 'Sent a card');
  assert.equal(thingLine({ kind: 'board', title: '', count: 0 }), 'Sent a cluster');
});

test('thingLine: mine', () => {
  assert.equal(thingLine(card, { mine: true }), 'You sent a card: Alley, neon');
  assert.equal(thingLine(cards, { mine: true }), 'You sent 3 cards');
  assert.equal(thingLine(cluster, { mine: true }), 'You sent Night shoot');
  assert.equal(thingLine({ kind: 'card', title: '' }, { mine: true }), 'You sent a card');
  assert.equal(thingLine({ kind: 'board', title: '' }, { mine: true }), 'You sent a cluster');
});

test('thingLine: who', () => {
  assert.equal(thingLine(card, { who: 'Andrew' }), 'Andrew sent a card: Alley, neon');
  assert.equal(thingLine(cards, { who: 'Andrew' }), 'Andrew sent 3 cards');
  assert.equal(thingLine(cluster, { who: 'Andrew' }), 'Andrew sent Night shoot');
  assert.equal(thingLine({ kind: 'card', title: '' }, { who: 'Andrew' }), 'Andrew sent a card');
  assert.equal(thingLine({ kind: 'board', title: '' }, { who: 'Andrew' }), 'Andrew sent a cluster');
});

test('thingLine: nothing', () => {
  assert.equal(thingLine(null), '');
  assert.equal(thingLine(undefined, { mine: true }), '');
});

test('thingOf mirrors message_thing', () => {
  assert.equal(thingOf([]), null);
  assert.equal(thingOf(null), null);
  assert.equal(thingOf([{ kind: 'image' }, { kind: 'file' }]), null);
  assert.deepEqual(thingOf([{ kind: 'card', title: ' A ' }, { kind: 'card', title: 'B' }, { kind: 'card' }]), { kind: 'card', title: 'A', count: 3 });
  assert.deepEqual(thingOf([{ kind: 'image' }, { kind: 'board', title: 'Night shoot' }]), { kind: 'board', title: 'Night shoot', count: 0 });
  assert.deepEqual(thingOf([{ kind: 'board', title: 'X' }, { kind: 'card', title: 'Y' }]), { kind: 'board', title: 'X', count: 1 });
  assert.equal(thingOf([{ kind: 'card', title: 'x'.repeat(100) }]).title.length, 80);
});

test('sharedUnits groups cards by cluster and keeps old refs out', () => {
  const snap = { v: 1, k: 'image' };
  const a = { kind: 'card', boardId: 'b1', cardId: '1', snap };
  const b = { kind: 'card', boardId: 'b1', cardId: '2', snap };
  const c = { kind: 'card', boardId: 'b1', cardId: '3' };
  const d = { kind: 'card', boardId: 'b2', cardId: '4', snap };
  const e = { kind: 'card', boardId: 'b2', cardId: '5' };
  const cl = { kind: 'board', id: 'b9', boardId: 'b9', snap: { v: 1, k: 'cluster' } };
  const oldCl = { kind: 'board', id: 'b8' };
  const oldCard = { kind: 'card', boardId: 'b1', cardId: '6' };
  const units = sharedUnits([oldCard, a, b, c, d, e, cl, oldCl, { kind: 'image' }]);
  assert.equal(units.length, 3);
  assert.deepEqual(units[0].cards, [a, b, c]);
  assert.equal(units[0].boardId, 'b1');
  assert.deepEqual(units[1].cards, [d, e]);
  assert.equal(units[2].type, 'cluster');
  assert.equal(units[2].boardId, 'b9');
  assert.deepEqual(unitAttachments(units[2]), [cl]);
});

test('sharedUnits: a snap-less card from another cluster starts nothing', () => {
  const snap = { v: 1, k: 'note' };
  const a = { kind: 'card', boardId: 'b1', cardId: '1', snap };
  const x = { kind: 'card', boardId: 'b2', cardId: '2' };
  const u = sharedUnits([a, x]);
  assert.equal(u.length, 1);
  assert.deepEqual(u[0].cards, [a]);
});

test('storageKey: bare keys only', () => {
  assert.equal(storageKey('r2:a/b.jpg'), 'a/b.jpg');
  assert.equal(storageKey('a/b.jpg'), 'a/b.jpg');
  assert.equal(storageKey('https://x.test/a.png'), null);
  assert.equal(storageKey('data:image/png;base64,xx'), null);
  assert.equal(storageKey('blob:abc'), null);
  assert.equal(storageKey('//x.test/a'), null);
  assert.equal(storageKey('a b'), null);
  assert.equal(storageKey(''), null);
  assert.equal(storageKey(42), null);
});

test('kindWord: one name for a card kind', () => {
  assert.equal(kindWord('note'), 'Note');
  assert.equal(kindWord('text'), 'Note');
  assert.equal(kindWord('image'), 'Picture');
  assert.equal(kindWord('palette'), 'Palette');
  assert.equal(kindWord('pdf'), 'Card');
});

test('unitMeta: the line under a preview', () => {
  assert.equal(unitMeta({ cluster: true, snap: { ws: 'Studio' } }), 'Cluster in Studio');
  assert.equal(unitMeta({ cluster: true, snap: {} }), 'Cluster');
  assert.equal(unitMeta({ kind: 'note', count: 1, boardTitle: 'Test Studio' }), 'Note · Test Studio');
  assert.equal(unitMeta({ kind: 'pdf', count: 1, boardTitle: 'Test Studio' }), 'Card · Test Studio');
  assert.equal(unitMeta({ kind: 'link', snap: { host: 'a.com' } }), 'Link · a.com');
  assert.equal(unitMeta({ several: true, count: 3, boardTitle: 'N' }), '3 cards · N');
});
