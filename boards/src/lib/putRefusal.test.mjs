import test from 'node:test';
import assert from 'node:assert/strict';
import { PUT_FAILED_WORDS, putRefusal, putFailReason, putFailToast } from './putRefusal.js';

test('putRefusal keeps the message and sets the reason', () => {
  const e = putRefusal('gone', 'That cluster isn’t here any more.');
  assert.ok(e instanceof Error);
  assert.equal(e.message, 'That cluster isn’t here any more.');
  assert.equal(e.reason, 'gone');
});

test('putFailReason is "error" without a reason', () => {
  assert.equal(putFailReason(new Error('x')), 'error');
  assert.equal(putFailReason(undefined), 'error');
  assert.equal(putFailReason(null), 'error');
  assert.equal(putFailReason(putRefusal('capture', 'y')), 'capture');
});

test('putFailToast names each refusal by code with its own words', () => {
  for (const reason of ['gone', 'view_only', 'not_open', 'other_opened', 'capture']) {
    const words = `words for ${reason}`;
    assert.deepEqual(putFailToast(putRefusal(reason, words)), { type: 'error', code: `files_put_${reason}`, message: words });
  }
});

test('a replaced put is info, with no code', () => {
  const t = putFailToast(putRefusal('replaced', 'Another Put on board took its place.'));
  assert.equal(t.type, 'info');
  assert.equal(t.message, 'Another Put on board took its place.');
  assert.equal('code' in t, false);
});

test('a fault of ours says the plain sentence, not its own words', () => {
  assert.deepEqual(putFailToast(new TypeError('x is undefined')), { type: 'error', code: 'files_put_failed', message: PUT_FAILED_WORDS });
  assert.deepEqual(putFailToast(undefined), { type: 'error', code: 'files_put_failed', message: PUT_FAILED_WORDS });
});
