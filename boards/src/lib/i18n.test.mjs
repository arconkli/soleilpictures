// The language rules (uiLocale.js, i18n.js) and the transform that makes the
// code's English messages the compiled form the runtime reads
// (scripts/linguiTransform.mjs, loaded into node by scripts/linguiNode.mjs).
// Run: node --import ./scripts/linguiNode.mjs --test src/lib/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';
import { LOCALES, pickLocale, englishOnlyPath, uiLocale } from './uiLocale.js';
import { activateCatalog, resolveLocale, i18n } from './i18n.js';
import { linguiTransform, needsLingui } from '../../scripts/linguiTransform.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('pickLocale: a regional tag finds its language, Portuguese finds pt-BR', () => {
  const cases = {
    'es-MX': 'es', 'es-419': 'es', 'pt-PT': 'pt-BR', pt: 'pt-BR', 'fr-CA': 'fr', 'EN-us': 'en',
    'ja-JP': 'ja', 'ko-KR': 'ko', 'ru-RU': 'ru', pt_BR: 'pt-BR', 'PT-br': 'pt-BR', es_ES: 'es',
  };
  for (const [tag, want] of Object.entries(cases)) assert.equal(pickLocale(tag, [], LOCALES), want, tag);
});

test('pickLocale: what we do not have, and what is not a tag, gives no match (English)', () => {
  for (const tag of ['zh-CN', 'ar', 'auto', '', null, 123, undefined]) {
    assert.equal(pickLocale(tag, [], LOCALES), 'en', String(tag));
    assert.equal(pickLocale(null, [tag], LOCALES), 'en', String(tag));
  }
});

test('resolveLocale: the choice first, then the browser in order', () => {
  assert.equal(resolveLocale('auto', ['zh-CN', 'ko-KR']), 'ko');
  assert.equal(resolveLocale('fr', ['ja']), 'fr');
  assert.equal(resolveLocale(null, []), 'en');
  assert.equal(resolveLocale(null, undefined), 'en');
  assert.equal(resolveLocale('en', ['es']), 'en', 'English chosen on purpose beats the browser');
});

test('englishOnlyPath: the public site is English, the app and the pages it serves are not', () => {
  const english = [
    '/legal/privacy', '/legal', '/scout', '/tools/x', '/vs/pureref', '/use-cases', '/use-cases/film', '/templates', '/templates/x',
    '/best/moodboard-apps', '/docs', '/docs/api', '/docs/', '/changelog', '/pricing/talk-to-us', '/explore', '/c/some-cluster', '/Docs/API',
  ];
  for (const p of english) assert.equal(englishOnlyPath(p, false), true, p);
  assert.equal(englishOnlyPath('/pricing', false), true);
  assert.equal(englishOnlyPath('/pricing/', false), true);
  const translated = ['/', '', '/share/0a2b', '/f/abc', '/t/abc', '/keep/abc', '/make', '/resume', '/oauth/authorize', '/admin', '/welcome', '/waitlist', '/pricing/success'];
  for (const p of translated) assert.equal(englishOnlyPath(p, false), false, p);
  assert.equal(englishOnlyPath('/pricing', true), false, 'signed in, /pricing is the account page');
  assert.equal(englishOnlyPath('/docs', true), true);
});

test('Lingui macros in a source file become English-in-code, with no warnings and no catalog', async () => {
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => { warns.push(a); };
  try {
    const { words, toast, LATER } = await import('../../scripts/fixtures/i18nSample.mjs');
    assert.deepEqual(words(1), ['Save', 'Delete 1 cards', '1 card']);
    assert.equal(words(5)[2], '5 cards');
    assert.deepEqual(toast, { id: 'toast-1', message: 'Saved {n}' }, 'a hand-written descriptor is not touched');
    assert.equal(i18n._(LATER), 'Later thing');
    assert.equal(uiLocale(), 'en');

    activateCatalog('es', { [generateMessageId('Save')]: compileMessage('Guardar') });
    assert.equal(uiLocale(), 'es', 'the UI locale follows activation');
    assert.equal(words(5)[0], 'Guardar');
    assert.equal(words(5)[1], 'Delete 5 cards', 'a message the catalog lacks falls back to the English in the code');
    activateCatalog('en', {});
    assert.equal(uiLocale(), 'en');
    assert.equal(words(5)[0], 'Save');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warns, []);
});

test('needsLingui looks only for an import of a macro', () => {
  assert.equal(needsLingui("import { t } from '@lingui/core/macro';"), true);
  assert.equal(needsLingui('import {Trans} from "@lingui/react/macro"'), true);
  assert.equal(needsLingui("import { i18n } from '@lingui/core';"), false);
  assert.equal(needsLingui('const a = 1; // @lingui/core/macro'), false);
  assert.equal(needsLingui('plain'), false);
});

const TRANS = `import { Trans } from '@lingui/react/macro';
export const View = ({ n }) => <Trans>Hello <strong>world</strong> and {n}</Trans>;
`;

test('<Trans> becomes a compiled message with numbered tags', async () => {
  const out = await linguiTransform(TRANS, join(HERE, 'transSample.jsx'));
  assert.ok(out.code.includes('message: ["Hello <0>world</0> and ", ["n"]]'), out.code);
  assert.ok(!out.code.includes('@lingui/react/macro'));
  assert.ok(out.map);
});

test('the compiled <Trans> renders, tags and all', async () => {
  const { transform } = await import('esbuild');
  const { code } = await linguiTransform(TRANS, join(HERE, 'transSample.jsx'));
  const js = (await transform(code, { loader: 'jsx', jsx: 'automatic', format: 'esm' })).code;
  const dir = join(HERE, '../../node_modules/.cache/i18n-test');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `trans-${process.pid}.mjs`);
  writeFileSync(file, js);
  const { View } = await import(pathToFileURL(file).href);
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { I18nProvider } = await import('@lingui/react');
  const html = renderToString(createElement(I18nProvider, { i18n }, createElement(View, { n: 7 })));
  assert.ok(html.includes('Hello <strong>world</strong> and 7'), html);
});
