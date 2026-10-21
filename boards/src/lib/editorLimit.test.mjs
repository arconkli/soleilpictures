import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT,
  editorLimitRefusal, normalizeEditorCapacity,
} from './editorLimit.js';

test('a refusal is read from its hint, the way supabase-js hands it over', () => {
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_HINT, code: '42501' }), { ask: false });
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_ASK_HINT, code: '42501' }), { ask: true });
});

test('a wrapper that kept only the message is still understood', () => {
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows')), { ask: false });
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: this account already has 10 people who can edit')), { ask: true });
});

test('anything else is not the editor limit', () => {
  assert.equal(editorLimitRefusal(new Error('invite limit reached: try tomorrow')), null);
  assert.equal(editorLimitRefusal({ message: 'this account is suspended', hint: 'sending_on_hold' }), null);
  assert.equal(editorLimitRefusal(null), null);
  assert.equal(editorLimitRefusal(undefined), null);
});

test('the numbers come back in one shape, array or row', () => {
  const row = { enforced: true, editor_limit: 10, used: 9, pending: 1, is_full: true, i_am_account_owner: false, subject: 'account' };
  const want = { enforced: true, limit: 10, used: 9, pending: 1, taken: 10, left: 0, full: true, isAccountOwner: false, subject: 'account' };
  assert.deepEqual(normalizeEditorCapacity(row), want);
  assert.deepEqual(normalizeEditorCapacity([row]), want);
  assert.equal(normalizeEditorCapacity([]), null);
  assert.equal(normalizeEditorCapacity(null), null);
});

test('a missing limit falls back to the app\'s number, and left never goes below 0', () => {
  const c = normalizeEditorCapacity({ enforced: true, used: 12, pending: 0, is_full: true });
  assert.equal(c.limit, EDITOR_LIMIT);
  assert.equal(c.left, 0);
  assert.equal(c.subject, 'account');
});
