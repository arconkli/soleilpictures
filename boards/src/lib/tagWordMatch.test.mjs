// tagWordMatch — the JS twin of migration 0880's tag matcher.
// Run: node --test src/lib/tagWordMatch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  slugWordRegex, longEnoughToSpread, isWordChar, isNoSpaceChar, isHangulChar, isCompactScriptName,
} from './tagWordMatch.js';

const sql = readFileSync(new URL('../../../supabase/migrations/0880_tags_any_script.sql', import.meta.url), 'utf8');
const between = (a, b) => {
  const i = sql.indexOf(a), j = sql.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `markers ${a} / ${b}`);
  return sql.slice(i, j);
};

test('SQL parity: every fixture of 0880 proof block', () => {
  const block = between('-- The word regex, fixture by fixture.', '-- English unchanged');
  const rows = [...block.matchAll(/\('([^']*)',\s*'([^']*)',\s*(true|false)\)/g)];
  assert.ok(rows.length >= 22, `rows: ${rows.length}`);
  for (const [, slug, txt, expected] of rows) {
    assert.equal(slugWordRegex(slug).test(txt.toLowerCase()), expected === 'true', `${slug} on ${txt}`);
  }
});

test('spreadable parity with 0880', () => {
  const block = between('-- Which tags spread.', '-- Candidate patterns');
  const rows = [...block.matchAll(/\('([^']*)',\s*'(active|deleted)',\s*(true|false)\)/g)];
  assert.ok(rows.length >= 8);
  for (const [, slug, status, expected] of rows) {
    if (status !== 'active') continue;
    // The SQL also refuses stop words; the JS twin is only the length half.
    if (slug === 'the') continue;
    assert.equal(longEnoughToSpread(slug), expected === 'true', `${slug}`);
  }
});

test('English parity against the old [^a-z0-9] rule', () => {
  const legacy = (slug, text) => new RegExp('(^|[^a-z0-9])' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i').test(text);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = 'artsc+q&4kpov x-y_.,\n';
  const slugs = ['art', 'rough cut', 'c++', 'q&a', '4k', 'pov', 'x-ray', 'a'];
  const res = slugs.map(slugWordRegex);
  let mismatches = 0;
  for (let n = 0; n < 20000; n++) {
    let t = '';
    for (let k = 0; k < 24; k++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    slugs.forEach((s, i) => {
      if (res[i].test(t.toLowerCase()) !== legacy(s, t.toLowerCase())) mismatches++;
    });
  }
  assert.equal(mismatches, 0);
});

test('helpers', () => {
  assert.equal(isWordChar('ि'), true);
  assert.equal(isWordChar('_'), false);
  assert.ok(isNoSpaceChar('東'));
  assert.ok(isNoSpaceChar('ก'));
  assert.ok(isNoSpaceChar('𠮷'));
  assert.ok(isHangulChar('서'));
  assert.equal(isCompactScriptName('東京'), true);
  assert.equal(isCompactScriptName('서울'), true);
  assert.equal(isCompactScriptName('Tokyo東京'), false);
  assert.equal(isCompactScriptName(''), false);
  assert.equal(longEnoughToSpread('これ'), false);
  assert.equal(longEnoughToSpread('猫'), false);
  assert.equal(longEnoughToSpread('кино'), true);
});
