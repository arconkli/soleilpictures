import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUiLocale } from './uiLocale.js';
import { fmtBytes } from './storageLabel.js';

const nb = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
const inLocale = (l, fn) => { setUiLocale(l); try { return fn(); } finally { setUiLocale('en'); } };
test('fmtBytes: English as ever; fr and ru write the same numbers their way', () => {
  assert.equal(fmtBytes(null), '—');
  assert.equal(fmtBytes(512), '1 KB');
  assert.equal(fmtBytes(1.2 * 1024 ** 3), '1.2 GB');
  assert.equal(fmtBytes(212 * 1024 ** 3), '212 GB');
  assert.equal(fmtBytes(1024 ** 4), '1 TB');
  assert.equal(fmtBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(nb(inLocale('fr', () => fmtBytes(1.2 * 1024 ** 3))), '1,2 Go');
  assert.equal(nb(inLocale('ru', () => fmtBytes(212 * 1024 ** 3))), '212 ГБ');
  assert.equal(nb(inLocale('ru', () => fmtBytes(5 * 1024 ** 2))), '5,0 МБ');
});
