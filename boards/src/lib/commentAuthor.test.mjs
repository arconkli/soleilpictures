// shownAuthor: the stored stand-ins 'You' and 'Someone' show in the viewer's
// language; anything else is the name as written. Run under scripts/linguiNode.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownAuthor } from './commentAuthor.js';

test('in English the stand-ins and names come back unchanged', () => {
  assert.equal(shownAuthor('You'), 'You');
  assert.equal(shownAuthor('Someone'), 'Someone');
  assert.equal(shownAuthor('Ana'), 'Ana');
  assert.equal(shownAuthor(''), '');
  assert.equal(shownAuthor(null), null);
  assert.equal(shownAuthor(undefined), undefined);
});
