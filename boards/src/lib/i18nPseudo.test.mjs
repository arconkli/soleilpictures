// The development pseudo-locale (?lang=pseudo): accented, bracketed, with
// placeholders and Trans tags left whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupI18n } from '@lingui/core';
import { pseudoMessage, installPseudo } from './i18nPseudo.js';

test('letters are accented and the message is bracketed', () => {
  assert.deepEqual(pseudoMessage(['Delete ', ['n'], ' cards']), ['⟦', 'Délété ', ['n'], ' çárds', '⟧']);
  assert.deepEqual(pseudoMessage('Save'), ['⟦', 'Sávé', '⟧']);
});

test('tags and # stay as they are', () => {
  assert.deepEqual(pseudoMessage(['Open <0>one</0> or <1/>']), ['⟦', 'Ópéñ <0>óñé</0> ór <1/>', '⟧']);
  assert.deepEqual(pseudoMessage(['# cards']), ['⟦', '# çárds', '⟧']);
});

test('plural and select options are transformed in place', () => {
  const out = pseudoMessage(['Have ', ['n', 'plural', { offset: 0, one: ['one note'], other: ['# notes'] }]]);
  assert.deepEqual(out, ['⟦', 'Hávé ', ['n', 'plural', { offset: 0, one: ['óñé ñóté'], other: ['# ñótés'] }], '⟧']);
});

test('installPseudo changes _ and t once each, and nothing shared', () => {
  const a = setupI18n({ locale: 'en', messages: { en: {} } });
  const b = setupI18n({ locale: 'en', messages: { en: {} } });
  const orig = Object.getPrototypeOf(a)._;
  installPseudo(a);
  const d = { id: 'x1', message: ['Delete ', ['n'], ' cards'] };
  assert.equal(a._(d, { n: 3 }), '⟦Délété 3 çárds⟧');
  assert.equal(a.t(d, { n: 3 }), '⟦Délété 3 çárds⟧');
  assert.equal(a._('x2', {}, { message: ['Save'] }), '⟦Sávé⟧');
  assert.equal(b._(d, { n: 3 }), 'Delete 3 cards', 'another instance is untouched');
  assert.equal(Object.getPrototypeOf(a)._, orig);
});
