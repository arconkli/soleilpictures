// autotagEngine — tokens and exact matches in any script.
// Run: node --test src/lib/autotagEngine.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, buildIndex, scoreContent } from './autotagEngine.js';

// STOP_WORDS is not exported: read the literal out of the source.
const src = readFileSync(new URL('./autotagEngine.js', import.meta.url), 'utf8');
const STOP = new Set([...src.match(/const STOP_WORDS = new Set\(\[([\s\S]*?)\]\);/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

// The tokenizer as it was before 0880 (ASCII only).
function legacyTokenize(input) {
  if (!input) return [];
  const text = String(input).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').toLowerCase();
  const raw = text.match(/[a-z0-9][a-z0-9_-]*/g) || [];
  const unigrams = [];
  for (const tok of raw) {
    if (tok.length < 2 && !/^\d+$/.test(tok)) continue;
    if (STOP.has(tok)) continue;
    unigrams.push(tok);
  }
  const bigrams = [];
  for (let i = 0; i + 1 < unigrams.length; i++) bigrams.push(unigrams[i] + ' ' + unigrams[i + 1]);
  return unigrams.concat(bigrams);
}

test('English tokens are unchanged', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = 'abcAB 1-_.<p>&amp;the of x\n';
  for (let n = 0; n < 30000; n++) {
    let t = '';
    for (let k = 0; k < 30; k++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    assert.deepEqual(tokenize(t), legacyTokenize(t), JSON.stringify(t));
  }
  for (const t of ['<p>Key light &amp; fill, 5600K HMI on the rough-cut.</p>', 'Q1 V2 a 7 the_end']) {
    assert.deepEqual(tokenize(t), legacyTokenize(t));
  }
});

test('unigrams in other scripts', () => {
  const uni = (t) => tokenize(t).filter(x => !x.includes(' '));
  assert.deepEqual(uni('서울에서 영화를 찍었습니다.'), ['서울에서', '영화를', '찍었습니다']);
  const zh = uni('我们在北京拍摄电影，导演很满意。');
  for (const w of ['北京', '电影', '导演']) assert.ok(zh.includes(w), w);
  const ja = uni('東京駅で映画を撮影しました。カメラはARRIです。');
  for (const w of ['東京', '映画', 'カメラ', 'arri']) assert.ok(ja.includes(w), w);
  assert.ok(!ja.includes('で'));
  assert.deepEqual(uni('Мы снимали кино в Москве, режиссёр доволен.'), ['мы', 'снимали', 'кино', 'москве', 'режиссёр', 'доволен']);
  assert.deepEqual(uni('हिन्दी फ़िल्म की शूटिंग'), ['हिन्दी', 'फ़िल्म', 'की', 'शूटिंग']);
  const th = uni('เราถ่ายทำภาพยนตร์ที่กรุงเทพ');
  for (const w of ['ภาพยนตร์', 'กรุงเทพ']) assert.ok(th.includes(w), w);
});

test('exact match in scoreContent', () => {
  const index = buildIndex([]);
  const score = (name, content) => {
    const r = scoreContent({ tags: [{ id: 't1', name, slug: name.toLowerCase() }], index, content });
    return r.length ? r[0].score : 0;
  };
  const yes = [['서울', '<p>서울에서 촬영</p>'], ['東京', '東京駅で撮影'], ['кино', 'Хорошее кино!'],
    ['القاهرة', 'صورنا في القاهرة.'], ['art', 'smart art.']];
  for (const [n, c] of yes) assert.ok(score(n, c) >= 0.95, `${n} in ${c}`);
  for (const [n, c] of [['кино', 'кинотеатр'], ['art', 'darts']]) assert.ok(score(n, c) < 0.95, `${n} in ${c}`);
});
