import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWords } from './searchWords.js';

const en = ['new', 'add', 'create', 'cluster'];

test('English: the array comes back unchanged', () => {
  assert.equal(searchWords(en, 'new, add, create, cluster'), en);
});

test('a translated list adds its words after the English ones', () => {
  assert.deepEqual(searchWords(en, 'Nuevo, añadir ,crear; cluster, '), ['new', 'add', 'create', 'cluster', 'nuevo', 'añadir', 'crear']);
});

test('Japanese 、 and full-width commas split', () => {
  assert.deepEqual(searchWords(['note'], 'ノート、メモ，付箋'), ['note', 'ノート', 'メモ', '付箋']);
});
