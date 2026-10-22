import test from 'node:test';
import assert from 'node:assert/strict';
import { hereNow } from './homeRail.js';

test('hereNow: one row a person, not you, not a tab in the background, where they are', () => {
  const boards = { film: { id: 'film', name: 'Feature film' }, x: { id: 'x', name: '  ' } };
  const peers = [
    { user: { id: 'me' }, location: { boardId: 'film' } },
    { user: { id: 'maya', name: 'Maya Ortiz' }, location: { boardId: 'film', isActive: true } },
    { user: { id: 'maya', name: 'Maya Ortiz' }, location: { boardId: 'x' } },
    { user: { id: 'jon', name: 'Jon Park' }, location: { boardId: 'x' } },
    { user: { id: 'lena', name: 'Lena' }, location: { boardId: 'film', isActive: false } },
    { user: { id: 'sam' }, location: null },
  ];
  const rows = hereNow(peers, boards, { selfId: 'me', nameOf: (p) => p.user.name || '' });
  assert.deepEqual(rows.map(r => [r.id, r.name, r.where]), [
    ['maya', 'Maya Ortiz', 'In Feature film'],
    ['jon', 'Jon Park', 'In Untitled cluster'],
    ['sam', 'Someone', 'Here now'],
  ]);
  assert.deepEqual(rows[0].loc, { boardId: 'film', isActive: true });
  assert.equal(rows[2].initial, 'S');
});
