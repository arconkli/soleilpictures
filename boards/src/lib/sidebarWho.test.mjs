import test from 'node:test';
import assert from 'node:assert/strict';
import { firstName, hereText, whoLine } from './sidebarWho.js';

test('firstName: a name, an address, nothing', () => {
  assert.equal(firstName('Maya Ortiz'), 'Maya');
  assert.equal(firstName('  Jon  '), 'Jon');
  assert.equal(firstName('maya@lostfilms.co'), 'maya');
  assert.equal(firstName(''), '');
  assert.equal(firstName(null), '');
});

test('hereText: one, two, three, more', () => {
  assert.equal(hereText([]), '');
  assert.equal(hereText(['Maya']), 'Maya is here');
  assert.equal(hereText(['Maya', 'Jon']), 'Maya and Jon are here');
  assert.equal(hereText(['Maya', 'Jon', 'Sam']), 'Maya, Jon and Sam are here');
  assert.equal(hereText(['Maya', 'Jon', 'Sam', 'Lena', 'Priya']), 'Maya, Jon and 3 others are here');
});

test('whoLine: your own workspace, nobody here, says nothing', () => {
  assert.equal(whoLine({ others: [], mine: true }), null);
  assert.equal(whoLine(), null);
});

test('whoLine: who is here wins, faces capped at three, people counted once', () => {
  const line = whoLine({
    mine: true,
    others: [{ id: 'm', name: 'Maya Ortiz' }, { id: 'j', name: 'jon@lostfilms.co' }, { id: 'm', name: 'Maya Ortiz' },
      { id: 's', name: 'Sam Okafor' }, { id: 'l', name: 'Lena Fischer' }],
  });
  assert.equal(line.kind, 'here');
  assert.equal(line.text, 'Maya, jon and 2 others are here');
  assert.deepEqual(line.faces, [{ id: 'm', initial: 'M' }, { id: 'j', initial: 'J' }, { id: 's', initial: 'S' }]);
});

test('whoLine: someone else\'s workspace with nobody here says whose it is', () => {
  assert.deepEqual(whoLine({ mine: false, sharedBy: 'Maya Ortiz' }), { kind: 'shared', text: 'Shared by Maya Ortiz' });
  assert.deepEqual(whoLine({ mine: false, sharedBy: 'Maya Ortiz', coowner: true }), { kind: 'shared', text: 'Co-owner · shared by Maya Ortiz' });
  assert.deepEqual(whoLine({ mine: false }), { kind: 'shared', text: 'Shared by someone' });
  // People in it come first even when it isn't yours.
  assert.equal(whoLine({ mine: false, sharedBy: 'Maya', others: [{ id: 'j', name: 'Jon' }] }).text, 'Jon is here');
});

test('whoLine: a nameless person still counts', () => {
  assert.equal(whoLine({ others: [{ id: 'x', name: '' }] }).text, 'Someone is here');
});
