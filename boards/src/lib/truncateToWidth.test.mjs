// truncateToWidth (the canvas ellipsis) with fake measures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateToWidth } from './truncateToWidth.js';
import { graphemes } from './graphemes.js';

const ELL = '\u{2026}';
const fam = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
const eAcute = 'e\u{301}';
const kshatriya = '\u{915}\u{94D}\u{937}\u{924}\u{94D}\u{930}\u{93F}\u{92F}';
const flag = '\u{1F1EF}\u{1F1F5}';

// 10 per grapheme; the ellipsis is one grapheme.
const narrow = (t) => graphemes(t).length * 10;
// Wide characters (Han, kana, emoji, regional indicators) count double.
const WIDE = /[\u{3040}-\u{30FF}\u{4E00}-\u{9FFF}\u{1F300}-\u{1FAFF}]/u;
const wide = (t) => graphemes(t).reduce((n, g) => n + (WIDE.test(g) ? 20 : 10), 0);

const wholeGraphemes = (text, out) => {
  const body = out.endsWith(ELL) ? out.slice(0, -1) : out;
  let acc = '';
  const prefixes = new Set(['']);
  for (const g of graphemes(text)) { acc += g; prefixes.add(acc); }
  return prefixes.has(body);
};

test('plain English: cut point and ellipsis', () => {
  assert.equal(truncateToWidth(narrow, 'hello world', 1000), 'hello world');
  assert.equal(truncateToWidth(narrow, 'hello world', 55), 'hell' + ELL);
  assert.equal(truncateToWidth(narrow, 'hello world', 5), ELL);
  assert.equal(truncateToWidth(narrow, '', 50), '');
});

test('returns the text unchanged when it fits', () => {
  assert.equal(truncateToWidth(narrow, 'abc', 30), 'abc');
  assert.equal(truncateToWidth(wide, '\u{65E5}\u{672C}', 40), '\u{65E5}\u{672C}');
  assert.equal(truncateToWidth(narrow, fam, 10), fam);
});

test('wide characters count double', () => {
  const t = '\u{65E5}\u{672C}\u{8A9E}\u{30C6}\u{30B9}\u{30C8}';
  assert.equal(truncateToWidth(wide, t, 55), '\u{65E5}\u{672C}' + ELL);
  assert.equal(truncateToWidth(wide, t, 5), ELL);
});

test('never cuts inside a grapheme', () => {
  const texts = ['ab' + fam.repeat(4), 'x' + eAcute.repeat(5), kshatriya + kshatriya, flag.repeat(4) + 'z'];
  for (const text of texts) {
    for (const measure of [narrow, wide]) {
      for (let w = 0; w <= measure(text) + 10; w += 5) {
        const out = truncateToWidth(measure, text, w);
        assert.ok(wholeGraphemes(text, out), `cut inside a grapheme: ${JSON.stringify(out)} at ${w}`);
      }
    }
  }
  assert.equal(truncateToWidth(narrow, 'ab' + fam + fam, 35), 'ab' + ELL);
  assert.equal(truncateToWidth(narrow, flag + flag, 15), ELL);
});
