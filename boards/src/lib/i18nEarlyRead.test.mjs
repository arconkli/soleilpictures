// The development check for a message read before the language is chosen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupI18n } from '@lingui/core';
import { installEarlyRead } from './i18nEarlyRead.js';
import { installPseudo } from './i18nPseudo.js';

const fake = () => ({
  calls: [],
  _(id, values, options) { this.calls.push([id, values, options]); return 'out'; },
  t(...a) { return this._(...a); },
});

test('logs each early message once, with its English, and still returns the result', () => {
  const i18n = fake();
  const logs = [];
  installEarlyRead(i18n, (m) => logs.push(m));
  const d = { id: 'a', message: ['Delete ', ['n'], ' cards'] };
  assert.equal(i18n._(d, { n: 2 }), 'out');
  i18n.t(d, { n: 3 });
  i18n._('b', {}, { message: ['Save'] });
  assert.equal(logs.length, 2);
  assert.equal(logs[0], '[i18n] read before the language was chosen: "Delete {n} cards". Read it inside a function or a getter that runs later.');
  assert.match(logs[1], /"Save"/);
  assert.equal(i18n.calls.length, 3);
});

test('is silent once the language is decided', () => {
  const i18n = fake();
  const logs = [];
  const { markLocaleDecided } = installEarlyRead(i18n, (m) => logs.push(m));
  markLocaleDecided();
  i18n._({ id: 'a', message: ['Save'] });
  i18n.t('x', {}, { message: ['Open'] });
  assert.deepEqual(logs, []);
});

test('composes with installPseudo', () => {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const logs = [];
  const { markLocaleDecided } = installEarlyRead(i18n, (m) => logs.push(m));
  const d = { id: 'a', message: ['Save'] };
  assert.equal(i18n._(d), 'Save');
  assert.equal(logs.length, 1);
  markLocaleDecided();
  installPseudo(i18n);
  assert.equal(i18n._(d), '⟦Sávé⟧');
  assert.equal(logs.length, 1);
});
