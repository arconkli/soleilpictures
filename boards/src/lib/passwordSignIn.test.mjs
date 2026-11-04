import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_SIGN_IN, usesPassword } from './passwordSignIn.js';

test('the allowlist is the one review address', () => {
  assert.deepEqual(PASSWORD_SIGN_IN, ['review@soleilpictures.com']);
});

test('matches the address regardless of case and padding', () => {
  assert.equal(usesPassword('review@soleilpictures.com'), true);
  assert.equal(usesPassword(' Review@SoleilPictures.com '), true);
});

test('exact match only', () => {
  for (const v of ['review@soleilpictures.com.evil', 'xreview@soleilpictures.com', 'review@soleilpictures.co', '', null, undefined, 42]) {
    assert.equal(usesPassword(v), false, String(v));
  }
});
