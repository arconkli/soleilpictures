import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapMetaValue, jsonbToPlain, changeLine, revertedText, REVERTIBLE_FIELDS } from './versionFields.js';

test('unwrapMetaValue: { v } gives its value, everything else passes through', () => {
  assert.equal(unwrapMetaValue({ v: 'Night Shift' }), 'Night Shift');
  assert.equal(unwrapMetaValue({ v: null }), null);
  assert.equal(unwrapMetaValue('plain'), 'plain');
  assert.equal(unwrapMetaValue(null), null);
  const two = { v: 1, w: 2 };
  assert.equal(unwrapMetaValue(two), two);
  const arr = [1];
  assert.equal(unwrapMetaValue(arr), arr);
});

test('jsonbToPlain: what Revert hands renameBoard / updateBoardMeta is never { v }', () => {
  assert.equal(jsonbToPlain({ v: 'Old name' }), 'Old name');
  assert.equal(jsonbToPlain({ v: '#ff0000' }), '#ff0000');
  assert.equal(jsonbToPlain('Old name'), 'Old name');
  assert.equal(jsonbToPlain(null), null);
  assert.equal(jsonbToPlain(undefined), null);
  assert.equal(jsonbToPlain({ v: null }), null);
  assert.deepEqual(jsonbToPlain({ kind: 'image', id: 'a' }), { kind: 'image', id: 'a' });
});

test('changeLine: name and background show before → after; the rest only say changed', () => {
  assert.equal(changeLine({ field: 'name', before_value: { v: 'A' }, after_value: 'B' }), 'Name: “A” → “B”');
  assert.equal(changeLine({ field: 'name', before_value: null, after_value: { v: 'B' } }), 'Name: “—” → “B”');
  assert.equal(changeLine({ field: 'bg_color', before_value: { v: '#111' }, after_value: { v: '#222' } }), 'Background: #111 → #222');
  assert.equal(changeLine({ field: 'cover', before_value: { v: {} }, after_value: { v: {} } }), 'Cover changed');
  assert.equal(changeLine({ field: 'view' }), 'View changed');
  assert.equal(changeLine({ field: 'meta' }), 'Settings changed');
  assert.equal(changeLine({ field: 'parent_board_id', before_value: { v: 'x' } }), 'Moved');
  for (const f of ['scheduled_date', 'scheduled_end', 'day_label', 'sched_status', 'day_start', 'day_end', 'day_place', 'day_type']) {
    assert.equal(changeLine({ field: f }), 'Schedule changed');
  }
  assert.equal(changeLine({ field: 'mystery' }), 'mystery changed');
  assert.ok(!changeLine({ field: 'name', before_value: { v: 'A' }, after_value: { v: 'B' } }).includes('[object Object]'));
});

test('revertedText: one message per revertible field', () => {
  assert.deepEqual([...REVERTIBLE_FIELDS].map(revertedText), ['Name restored.', 'Background restored.', 'Cover restored.', 'View restored.']);
});
