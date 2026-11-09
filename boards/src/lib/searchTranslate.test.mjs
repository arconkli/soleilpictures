// Picture search from any language: which language a query is written in, the
// English words kept for the picture search, and the Postgres word pattern.
//
// Run: node --test src/lib/searchTranslate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { queryLanguage, pictureWords, pictureWordPattern, M2M100_LANGS } from './searchTranslate.js';

test('queryLanguage: scripts', () => {
  assert.equal(queryLanguage('자동차', []), 'ko');
  assert.equal(queryLanguage('メガネ', []), 'ja');
  assert.equal(queryLanguage('眼鏡', ['ja', 'en']), 'ja');
  assert.equal(queryLanguage('眼鏡', ['zh-CN']), 'zh');
  assert.equal(queryLanguage('眼鏡', ['en-US']), 'zh');
  assert.equal(queryLanguage('очки', []), 'ru');
  assert.equal(queryLanguage('очки', ['uk-UA', 'en']), 'uk');
  assert.equal(queryLanguage('نظارات', []), 'ar');
  assert.equal(queryLanguage('نظارات', ['fa-IR']), 'fa');
  assert.equal(queryLanguage('משקפיים', []), 'he');
  assert.equal(queryLanguage('แว่นตา', []), 'th');
  assert.equal(queryLanguage('γυαλιά', []), 'el');
  assert.equal(queryLanguage('चश्मा', []), 'hi');
  assert.equal(queryLanguage('iPhone чехол', []), 'ru');
});

test('queryLanguage: Latin script follows the first language of the person', () => {
  assert.equal(queryLanguage('coche', ['es-ES', 'en']), 'es');
  assert.equal(queryLanguage('coche', ['en-US', 'es']), null);
  assert.equal(queryLanguage('voiture', ['fr']), 'fr');
  assert.equal(queryLanguage('óculos', ['pt-BR']), 'pt');
  assert.equal(queryLanguage('car', ['en-GB']), null);
  assert.equal(queryLanguage('', ['es']), null);
  assert.equal(queryLanguage('123', ['es']), null);
});

test('pictureWords', () => {
  assert.deepEqual(pictureWords('The glasses.'), ['glasses']);
  assert.deepEqual(pictureWords('The man who smokes.'), ['man', 'smokes']);
  assert.deepEqual(pictureWords('Go to'), ['go']);
  assert.deepEqual(pictureWords('a b c'), []);
  assert.equal(pictureWords('one two three four five six seven eight').length, 6);
});

test('pictureWordPattern', () => {
  assert.equal(pictureWordPattern('car'), '[[:<:]]car(s|es)?[[:>:]]');
  assert.equal(pictureWordPattern('c;r'), null);
  assert.ok(!M2M100_LANGS.has('en') && M2M100_LANGS.has('ko'));
});

test('queryLanguage: no model call until the query is long enough', () => {
  assert.equal(queryLanguage('m', ['fr']), null);
  assert.equal(queryLanguage('mo', ['fr']), null);
  assert.equal(queryLanguage('mer', ['fr']), 'fr');
  assert.equal(queryLanguage('\u6D77', ['zh-CN']), 'zh');
  assert.equal(queryLanguage('\ubc14\ub2e4', ['en']), 'ko');
});
