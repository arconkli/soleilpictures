// pageExcerpt.test.mjs — a doc page's excerpt centres on the match, accents or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageExcerpt, PAGE_EXCERPT_MAX } from './pageExcerpt.js';

const filler = 'lorem ipsum dolor sit amet '.repeat(30);

test('a match the fold makes is quoted, not the page opening', () => {
  const page = `${filler}Straße ${'x '.repeat(20)}`;
  assert.ok(page.length > PAGE_EXCERPT_MAX);
  const out = pageExcerpt(page, 'strasse');
  assert.ok(out.includes('Straße'), out);
  assert.ok(out.startsWith('…'), out);
});

test('an exact match still centres on it', () => {
  const out = pageExcerpt(`${filler}needle ${filler}`, 'needle');
  assert.ok(out.includes('needle'), out);
  assert.ok(out.startsWith('…'), out);
});

test('no match gives the page opening', () => {
  const out = pageExcerpt(`${filler}end`, 'zzzz');
  assert.ok(out.startsWith('lorem ipsum'), out);
  assert.ok(!out.startsWith('…'), out);
});
