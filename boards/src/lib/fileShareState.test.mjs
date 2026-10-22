// The rule behind the viewers' "Share / Shared" button (hooks/useFileShareState.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileShareStateOf } from '../hooks/useFileShareState.js';

test('shared = exists and (a link or people)', () => {
  assert.equal(fileShareStateOf({ exists: true, link_access: 'view', people: [] }).shared, true);
  assert.equal(fileShareStateOf({ exists: true, link_access: 'none', people: [{ email: 'a@b.co' }] }).shared, true);
  assert.equal(fileShareStateOf({ exists: true, link_access: 'none', people: [] }).shared, false);
  assert.equal(fileShareStateOf({ exists: false, link_access: 'view', people: [{}] }).shared, false);
  assert.equal(fileShareStateOf({ exists: false }).shared, false);
});

test('no row read (an error) is unknown, not "not shared"', () => {
  assert.equal(fileShareStateOf(null).shared, null);
  assert.equal(fileShareStateOf(undefined).shared, null);
});

test('counts come from the row', () => {
  const s = fileShareStateOf({ exists: true, link_access: 'comment', people: [{}, {}], comment_count: 4 });
  assert.deepEqual(s, { shared: true, linkAccess: 'comment', peopleCount: 2, commentCount: 4 });
});
