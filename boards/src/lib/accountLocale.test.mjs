// accountLocale: the language on this device and on the account
// (lib/accountLocale.js). Run under scripts/linguiNode.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLocale, reloadTarget, accountLocalePatch, followAccountLocale, syncAccountLocale } from './accountLocale.js';
import { readFileSync, readdirSync } from 'node:fs';
import { setBootLocale, signupLocale } from './uiLocale.js';
import { readLocaleChoice } from './i18n.js';

test('effectiveLocale resolves a choice against the browser languages', () => {
  assert.equal(effectiveLocale(null, ['ja-JP']), 'ja');
  assert.equal(effectiveLocale('fr', ['ja']), 'fr');
  assert.equal(effectiveLocale(null, ['de-DE']), 'en');
  assert.equal(effectiveLocale(null, ['pt-PT']), 'pt-BR');
});

test('reloadTarget reloads only into another language, once', () => {
  assert.equal(reloadTarget({ booted: null, want: 'fr', last: null }), null);
  assert.equal(reloadTarget({ booted: 'fr', want: 'fr', last: null }), null);
  assert.equal(reloadTarget({ booted: 'en', want: 'fr', last: 'fr' }), null);
  assert.equal(reloadTarget({ booted: 'en', want: 'fr', last: null }), 'fr');
  assert.equal(reloadTarget({ booted: 'en', want: 'fr', last: 'es' }), 'fr');
});

test('accountLocalePatch writes only a change', () => {
  assert.equal(accountLocalePatch(null, 'es'), null);
  assert.equal(accountLocalePatch({}, 'en'), null);
  assert.deepEqual(accountLocalePatch({}, 'es'), { locale: 'es' });
  assert.equal(accountLocalePatch({ user_metadata: { locale: 'es' } }, 'es'), null);
  assert.deepEqual(accountLocalePatch({ user_metadata: { locale: 'es' } }, 'en'), { locale: 'en' });
  assert.equal(accountLocalePatch({ user_metadata: { locale: 'xx' } }, 'en'), null);
});

// Stubs the browser globals followAccountLocale touches; returns a restore.
function stubBrowser({ ui = {}, failSet = false, languages = ['en-US'] } = {}) {
  const names = ['localStorage', 'sessionStorage', 'window', 'navigator'];
  const saved = names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]);
  const mem = (initial, fail) => {
    const m = new Map(Object.entries(initial));
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { if (fail) throw new Error('quota'); m.set(k, String(v)); },
    };
  };
  const local = mem({ 'soleil.ui': JSON.stringify(ui) }, false);
  if (failSet) local.setItem = () => { throw new Error('blocked'); };
  const session = mem({}, false);
  const state = { reloads: 0, local, session };
  const def = (n, value) => Object.defineProperty(globalThis, n, { value, configurable: true, writable: true });
  def('localStorage', local);
  def('sessionStorage', session);
  def('window', { location: { reload: () => { state.reloads += 1; } } });
  def('navigator', { languages, language: languages[0] });
  state.restore = () => {
    for (const [n, d] of saved) {
      if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n];
    }
    setBootLocale(null);
  };
  return state;
}

test('followAccountLocale saves the choice, reloads once, and keeps other keys', () => {
  const s = stubBrowser({ ui: { theme: 'dark' } });
  try {
    setBootLocale('en');
    followAccountLocale('fr');
    assert.deepEqual(JSON.parse(s.local.getItem('soleil.ui')), { theme: 'dark', lang: 'fr' });
    assert.equal(s.session.getItem('soleil.langReload'), 'fr');
    assert.equal(s.reloads, 1);
    followAccountLocale('fr');
    assert.equal(s.reloads, 1);
  } finally { s.restore(); }
});

test('followAccountLocale does nothing when the page is already in the language', () => {
  const s = stubBrowser();
  try {
    setBootLocale('fr');
    followAccountLocale('fr');
    assert.equal(s.reloads, 0);
  } finally { s.restore(); }
});

test('followAccountLocale does nothing where the boot did not choose', () => {
  const s = stubBrowser();
  try {
    setBootLocale(null);
    followAccountLocale('fr');
    assert.equal(s.reloads, 0);
  } finally { s.restore(); }
});

test('followAccountLocale does not reload when the choice cannot be saved', () => {
  const s = stubBrowser({ failSet: true });
  try {
    setBootLocale('en');
    followAccountLocale('fr');
    assert.equal(s.reloads, 0);
  } finally { s.restore(); }
});

function fakeAuth(user, { rejects = false } = {}) {
  const updates = [];
  return {
    updates,
    getSession: async () => { if (rejects) throw new Error('offline'); return { data: { session: user ? { user } : null } }; },
    updateUser: async (arg) => { updates.push(arg); return {}; },
  };
}

test('syncAccountLocale writes the locale only when the account differs', async () => {
  const s = stubBrowser();
  try {
    const differs = fakeAuth({ user_metadata: { locale: 'es' } });
    await syncAccountLocale(differs, 'fr');
    assert.deepEqual(differs.updates, [{ data: { locale: 'fr' } }]);

    const same = fakeAuth({ user_metadata: { locale: 'fr' } });
    await syncAccountLocale(same, 'fr');
    assert.deepEqual(same.updates, []);

    const english = fakeAuth({ user_metadata: {} });
    await syncAccountLocale(english, null);
    assert.deepEqual(english.updates, []);

    const none = fakeAuth(null);
    await syncAccountLocale(none, 'fr');
    assert.deepEqual(none.updates, []);
  } finally { s.restore(); }
});

test('syncAccountLocale never throws', async () => {
  const s = stubBrowser();
  try {
    await syncAccountLocale(fakeAuth(null, { rejects: true }), 'fr');
  } finally { s.restore(); }
});

test('signupLocale: a stored choice wins, otherwise the browser decides', () => {
  const run = (ui, languages) => {
    const s = stubBrowser({ ui, languages });
    try { return signupLocale(); } finally { s.restore(); }
  };
  assert.equal(run({ lang: 'fr' }, ['es-ES']), 'fr');
  assert.equal(run({ lang: 'auto' }, ['es-MX']), 'es');
  assert.equal(run({}, ['pt-PT']), 'pt-BR');
  assert.equal(run({}, ['de-DE', 'ja']), 'ja');
  assert.equal(run({}, ['de-DE']), 'en');
});

test('signupLocale: a localStorage that throws follows the browser; a missing navigator is English', () => {
  const s = stubBrowser({ languages: ['ko-KR'] });
  try {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); } };
    assert.equal(signupLocale(), 'ko');
    delete globalThis.navigator;
    assert.equal(signupLocale(), 'en');
  } finally { s.restore(); }
});

test('i18n.js still exports readLocaleChoice', () => {
  const s = stubBrowser({ ui: { lang: 'ru' } });
  try { assert.equal(readLocaleChoice(), 'ru'); } finally { s.restore(); }
});

test('every signInWithOtp call sits in a file that sends signupLocale()', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    return e.isDirectory() ? walk(p) : [p];
  });
  const files = walk(new URL('../', import.meta.url))
    .filter((u) => /\.(jsx?|mjs|tsx?)$/.test(u.pathname) && !/\.test\./.test(u.pathname) && !/\/local\//.test(u.pathname));
  const callers = files.filter((u) => /\.signInWithOtp\(/.test(readFileSync(u, 'utf8')));
  assert.ok(callers.length >= 4, 'AuthGate, SignupBox, KeepPage, MakePage');
  for (const u of callers) {
    assert.match(readFileSync(u, 'utf8'), /signupLocale\(\)/, u.pathname);
  }
});
