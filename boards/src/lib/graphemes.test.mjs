import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  graphemes, graphemeCount, exceedsGraphemes, firstGrapheme, cutGraphemes, dropLastGrapheme, truncate, initialOf, initialsOf,
} from './graphemes.js';

// Every non-ASCII character below is built from code points.
const cp = (...c) => String.fromCodePoint(...c);
const ELL = cp(0x2026);
const fam = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
const flag = cp(0x1f1ef, 0x1f1f5);
const conjunct = cp(0x0915, 0x094d, 0x0937);
const nfd = cp(0x65, 0x301); // e + combining acute
const loneHigh = /[\ud800-\udbff]$/;

// Indic conjuncts stay one grapheme only on newer ICU (78+). Assert the conjunct
// when this runtime keeps it, otherwise only that nothing is cut inside a code point.
const keepsConjunct = (() => {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(conjunct)].length === 1;
  } catch { return false; }
})();

test('initialOf', () => {
  const rows = [
    ['maya ortiz', 'M'], ['  jon', 'J'], ['', '?'], [null, '?'],
    [cp(0xe9) + 'lodie', cp(0xc9)], [nfd + 'lodie', cp(0x45, 0x301)],
    [cp(0x41c, 0x430, 0x440, 0x438, 0x44f), cp(0x41c)],
    [cp(0x3b5, 0x3bb, 0x3ad, 0x3bd, 0x3b7), cp(0x395)],
    [cp(0x5c71, 0x7530, 0x592a, 0x90ce), cp(0x5c71)],
    [cp(0xae40, 0xbbfc, 0xc900), cp(0xae40)],
    [cp(0x645, 0x62d, 0x645, 0x62f), cp(0x645)],
    [cp(0x5d3, 0x5d5, 0x5d3), cp(0x5d3)],
    [fam + ' Family', fam], [flag + ' Tokyo', flag], [cp(0xdf) + 'tudio', cp(0xdf)],
    [cp(0x1f3ac) + ' Studio', cp(0x1f3ac)], [cp(0x1d400) + 'bc', cp(0x1d400)],
    [cp(0x1112, 0x1161, 0x11ab), cp(0x1112, 0x1161, 0x11ab)],
  ];
  for (const [name, want] of rows) assert.equal(initialOf(name), want, JSON.stringify(name));
  assert.equal(initialOf('', 'M'), 'M');
  assert.equal(initialOf('abc', '?', { upper: false }), 'a');
});

test('initialOf on a Hindi conjunct', () => {
  const got = initialOf(conjunct + cp(0x0924, 0x094d, 0x0930, 0x093f));
  if (keepsConjunct) assert.equal(got, conjunct);
  else {
    // Older ICU: only assert nothing is cut inside a code point.
    assert.ok(got.length > 0 && conjunct.startsWith(got));
    assert.equal([...got].join(''), got);
  }
});

test('initialsOf (first two words, like the Avatar did)', () => {
  const rows = [
    ['Maya Ortiz', 'MO'], ['maya', 'M'], ['Maya de la Cruz', 'MD'],
    [cp(0x41c, 0x430, 0x440, 0x438, 0x44f) + ' ' + cp(0x418, 0x432, 0x430, 0x43d, 0x43e, 0x432, 0x430), cp(0x41c, 0x418)],
    [cp(0x5c71, 0x7530) + ' ' + cp(0x592a, 0x90ce), cp(0x5c71)],
    [cp(0xae40) + ' ' + cp(0xbbfc, 0xc900), cp(0xae40)],
    [cp(0x645, 0x62d, 0x645, 0x62f) + ' ' + cp(0x639, 0x644, 0x64a), cp(0x645)],
    [fam + ' Family', fam], ['', '?'],
  ];
  for (const [name, want] of rows) assert.equal(initialsOf(name), want, name);
  assert.equal(initialsOf('', ''), '');
});

test('truncate never splits a grapheme', () => {
  assert.equal(truncate('hello world', 8), 'hello w' + ELL);
  assert.equal(truncate('short', 8), 'short');
  assert.equal(truncate('ab' + fam + 'cdef', 4), 'ab' + fam + ELL);
  assert.ok(!loneHigh.test(truncate('x'.repeat(5) + cp(0x1f600).repeat(5), 7).slice(0, -1)));
  assert.equal(truncate(nfd.repeat(4), 3), nfd.repeat(2) + ELL);
  assert.equal(graphemes('abc').length, 3);
  assert.equal(firstGrapheme(flag + 'x'), flag);
  assert.equal(graphemeCount('a' + fam + flag), 3);
  assert.equal(cutGraphemes('a' + fam + 'bc', 2), 'a' + fam);
  assert.equal(dropLastGrapheme('a' + fam), 'a');
  assert.equal(dropLastGrapheme(''), '');
});

test('cuts never leave a lone surrogate or a split conjunct', () => {
  const s = conjunct.repeat(3) + cp(0x1f600).repeat(3);
  for (let n = 0; n <= 8; n++) {
    const c = cutGraphemes(s, n);
    assert.ok(!loneHigh.test(c) && !/^[\udc00-\udfff]/.test(c));
    if (keepsConjunct && n <= 3) assert.equal(c, conjunct.repeat(n));
  }
});

// ---- plain ASCII must match the old expressions exactly ----
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'";
function word(r) {
  let w = '';
  const n = 1 + Math.floor(r() * 9);
  for (let i = 0; i < n; i++) w += ALPHA[Math.floor(r() * ALPHA.length)];
  return w;
}
function words(r, min, span) {
  const n = min + Math.floor(r() * span);
  const ws = [];
  for (let i = 0; i < n; i++) ws.push(word(r));
  return ws.join(' ');
}

test('ASCII input gives what the old expressions gave', () => {
  const r = rng(12345);
  for (let i = 0; i < 400; i++) {
    const n = words(r, 1, 4);
    // Initials skip a word's leading punctuation (tested on its own below).
    if (!/(^|\s)[^A-Za-z0-9\s]/.test(n)) {
      assert.equal(initialOf(n), n.trim().charAt(0).toUpperCase(), n);
      assert.equal(initialOf(n, '?', { upper: false }), n.charAt(0), n);
      assert.equal(initialsOf(n, ''), n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), n);
    }
    const t = words(r, 0, 12);
    const max = 1 + Math.floor(r() * 40);
    assert.equal(truncate(t, max), t.length > max ? t.slice(0, max - 1) + ELL : t, t);
    assert.equal(cutGraphemes(t, max), t.slice(0, max), t);
    assert.equal(dropLastGrapheme(t), t.slice(0, -1), t);
    assert.equal(graphemeCount(t), t.length);
  }
});

test('exceedsGraphemes at n-1, n and n+1', () => {
  const kinds = {
    ascii: 'a',
    accent: nfd,
    family: fam,
    flags: flag,
    jamo: cp(0x1112, 0x1161, 0x11ab),
  };
  for (const [name, unit] of Object.entries(kinds)) {
    const s = unit.repeat(5);
    assert.equal(graphemeCount(s), 5, name);
    assert.equal(exceedsGraphemes(s, 4), true, `${name} n-1`);
    assert.equal(exceedsGraphemes(s, 5), false, `${name} n`);
    assert.equal(exceedsGraphemes(s, 6), false, `${name} n+1`);
  }
  assert.equal(exceedsGraphemes('', 0), false);
  assert.equal(exceedsGraphemes(null, 0), false);
});

test('a CR LF pair is one grapheme', () => {
  assert.equal(graphemeCount('a\r\nb'), 3);
  assert.equal(exceedsGraphemes('a\r\nb', 3), false);
  assert.equal(exceedsGraphemes('a\r\nb', 2), true);
  assert.equal(cutGraphemes('a\r\nb', 2), 'a\r\n');
});

test('tab and line feed give the same results on the fast path as through the segmenter', () => {
  const t = 'ab\tcd\nef\tg';
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const want = Array.from(seg.segment(t), (x) => x.segment);
  assert.deepEqual(graphemes(t), want);
  assert.equal(graphemeCount(t), want.length);
  for (let n = 0; n <= want.length + 1; n++) {
    assert.equal(cutGraphemes(t, n), want.slice(0, n).join(''), `cut ${n}`);
    assert.equal(exceedsGraphemes(t, n), want.length > n, `exceeds ${n}`);
    assert.equal(truncate(t, n), want.length <= n ? t : want.slice(0, Math.max(0, n - 1)).join('') + ELL, `truncate ${n}`);
  }
});

test('cutting a very long non-ASCII string is quick', () => {
  const big = cp(0x3042).repeat(1_000_000);
  let t0 = performance.now();
  assert.equal(cutGraphemes(big, 80), cp(0x3042).repeat(80));
  assert.ok(performance.now() - t0 < 100, 'cutGraphemes');
  t0 = performance.now();
  assert.equal(truncate(big, 80), cp(0x3042).repeat(79) + ELL);
  assert.ok(performance.now() - t0 < 100, 'truncate');
  t0 = performance.now();
  assert.equal(exceedsGraphemes(big, 80), true);
  assert.ok(performance.now() - t0 < 100, 'exceedsGraphemes');
});

test('initials skip leading punctuation, marks and invisible characters', () => {
  const rows = [
    ['"Bob"', 'B', 'B'], [cp(0x200f) + 'Maria', 'M', 'M'], ['(Studio) Nine', 'S', 'SN'],
    [cp(0xab, 0x41c, 0x430, 0x440, 0x438, 0x44f, 0xbb) + ' ' + cp(0x418, 0x432, 0x430, 0x43d, 0x43e, 0x432, 0x430), cp(0x41c), cp(0x41c, 0x418)],
    ['Jean - Luc', 'J', 'JL'], ['...', '?', '?'], [cp(0x301) + 'abc', 'A', 'A'],
    [cp(0x5c71, 0x7530) + ' ' + cp(0x592a, 0x90ce), cp(0x5c71), cp(0x5c71)],
  ];
  for (const [name, one, two] of rows) {
      assert.equal(initialOf(name), one, name);
      assert.equal(initialsOf(name), two, name);
  }
});
