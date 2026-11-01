import test from 'node:test';
import assert from 'node:assert/strict';
import { shareMetaCopy, shareMetaName } from './shareMetaCopy.js';

test('view link names the sender and the card count', () => {
  const c = shareMetaCopy({ kind: 'view', sharerName: 'Andrew', name: 'Lost Time', cardCount: 24 });
  assert.equal(c.title, 'Andrew shared “Lost Time” with you');
  assert.equal(c.description, '24 cards on Clusters. Have a look, then join to follow along.');
  assert.equal(c.alt, '“Lost Time”, a cluster on Clusters');
});

test('kind defaults to view', () => {
  const c = shareMetaCopy({ sharerName: 'Andrew', name: 'Lost Time', cardCount: 3 });
  assert.equal(c.title, 'Andrew shared “Lost Time” with you');
});

test('one card is singular', () => {
  assert.match(shareMetaCopy({ sharerName: 'A', name: 'X', cardCount: 1 }).description, /^1 card on Clusters\./);
});

test('no card count falls back to a line without a number', () => {
  for (const cardCount of [0, undefined, null, NaN]) {
    assert.equal(
      shareMetaCopy({ sharerName: 'A', name: 'X', cardCount }).description,
      'Have a look on Clusters, then join to follow along.',
    );
  }
});

test('invite link asks to edit', () => {
  const c = shareMetaCopy({ kind: 'invite', sharerName: 'Andrew', name: 'Lost Time', cardCount: 24 });
  assert.equal(c.title, 'Andrew invited you to edit “Lost Time”');
  assert.equal(c.description, 'Join free to add your own cards, notes and ideas.');
});

test('no sharer name drops the sender from both kinds', () => {
  for (const kind of ['view', 'invite']) {
    for (const sharerName of [null, undefined, '', '   ']) {
      assert.equal(shareMetaCopy({ kind, sharerName, name: 'Lost Time' }).title, '“Lost Time” on Clusters');
    }
  }
  assert.equal(
    shareMetaCopy({ kind: 'invite', name: 'X' }).description,
    'Join free to add your own cards, notes and ideas.',
  );
  assert.equal(
    shareMetaCopy({ kind: 'view', name: 'X', cardCount: 5 }).description,
    '5 cards on Clusters. Have a look, then join to follow along.',
  );
});

test('name is trimmed, defaulted and cut at 60', () => {
  assert.equal(shareMetaName('  Lost Time  '), 'Lost Time');
  assert.equal(shareMetaName(''), 'Untitled cluster');
  assert.equal(shareMetaName('   '), 'Untitled cluster');
  assert.equal(shareMetaName(null), 'Untitled cluster');
  assert.equal(shareMetaName('a'.repeat(60)), 'a'.repeat(60));
  const cut = shareMetaName('a'.repeat(61));
  assert.equal(cut, `${'a'.repeat(59)}…`);
  assert.equal(Array.from(cut).length, 60);
  assert.equal(shareMetaCopy({ sharerName: 'A' }).title, 'A shared “Untitled cluster” with you');
});
