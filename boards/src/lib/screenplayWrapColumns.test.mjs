// wrapLines counts display columns: a CJK glyph is WIDE (5/3) columns, marks are
// 0, and for text with neither it must behave exactly as it did when every
// UTF-16 unit was one column.
//
//   node --test src/lib/screenplayWrapColumns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapLines, colsOf, textCols, WIDE, EMOJI, paginate } from './screenplayPaginate.js';
import { graphemes } from './graphemes.js';
import { dualElementWidth, elementWidth, ELEMENT_METRICS, DUAL_WIDTH } from './screenplayMetrics.js';

const cols = (l) => textCols(l.text);
const contiguous = (s, lines) => {
  // Every non-space character of the text lies inside exactly one line.
  let covered = '';
  for (const l of lines) { assert.equal(s.slice(l.start, l.end), l.text); covered += l.text.replace(/\s+/g, ''); }
  assert.equal(covered, s.replace(/\s+/g, ''));
};

test('colsOf: wide, zero and ordinary code points', () => {
  assert.equal(colsOf(0x61), 1);
  assert.equal(colsOf(0x416), 1); // Cyrillic
  assert.equal(colsOf(0x65E5), WIDE); // Han
  assert.equal(colsOf(0x3042), WIDE); // Hiragana
  assert.equal(colsOf(0x30A2), WIDE); // Katakana
  assert.equal(colsOf(0xFF71), 1); // halfwidth katakana
  assert.equal(colsOf(0xAC00), WIDE); // Hangul syllable
  assert.equal(colsOf(0x1100), WIDE); // leading jamo
  assert.equal(colsOf(0x1161), 0); // medial jamo
  assert.equal(colsOf(0xD7CB), 0); // final jamo
  assert.equal(colsOf(0x3001), WIDE); // ideographic comma
  assert.equal(colsOf(0xFF21), WIDE); // fullwidth A
  assert.equal(colsOf(0x1F600), WIDE); // emoji
  assert.equal(colsOf(0x5B7), 0); // Hebrew point
  assert.equal(colsOf(0x200D), 0); // ZWJ
  assert.equal(textCols('\u{5E9}\u{5B8}\u{5DC}\u{5D5}\u{5DD}'), 4);
});

test('a 60-character Japanese dialogue line wraps within the dialogue width in columns', () => {
  const width = ELEMENT_METRICS.dialogue.width;
  const s = '\u{3042}\u{3044}\u{3046}\u{3048}\u{304A}'.repeat(12); // 60 chars
  const lines = wrapLines(s, width);
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(cols(l) <= width + 1e-9, `${cols(l)} > ${width}`);
  assert.equal(lines[0].text.length, 21); // 21 * 5/3 = 35
  let at = 0;
  for (const l of lines) { assert.equal(l.start, at); at = l.end; }
  assert.equal(at, s.length);
  assert.equal(lines.map((l) => l.text).join(''), s);
});

test('Korean with spaces fills each line, breaking between syllables as a browser does', () => {
  const word = '\u{C548}\u{B155}\u{D558}\u{C138}\u{C694}'; // 5 syllables, 8.33 columns
  const s = Array(6).fill(word).join(' ');
  const lines = wrapLines(s, 35);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(cols(l) <= 35 + 1e-9);
  assert.ok(cols(lines[0]) > 35 - WIDE, JSON.stringify(lines[0].text)); // full to within one syllable
  contiguous(s, lines);
});

test('an emoji pair, a flag and a ZWJ sequence are never split', () => {
  const flag = '\u{1F1EF}\u{1F1F5}';
  const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
  for (const unit of [flag, '\u{1F600}', family]) {
    const s = unit.repeat(10);
    const lines = wrapLines(s, 10);
    assert.equal(lines.map((l) => l.text).join(''), s);
    for (const l of lines) {
      assert.ok(l.text.length % unit.length === 0, `split inside ${JSON.stringify(unit)}: ${JSON.stringify(l.text)}`);
    }
  }
});

test('a long word is never split between a letter and its marks', () => {
  const pair = 'e\u{301}';
  const lines = wrapLines(pair.repeat(30), 7);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.text.startsWith(pair) && l.text.length % 2 === 0);
});

test('Hebrew with niqqud counts the marks as 0', () => {
  const word = '\u{5E9}\u{5B8}\u{5DC}\u{5D5}\u{5B9}\u{5DD}'; // 4 letters, 2 points
  assert.equal(textCols(word), 4);
  assert.equal(wrapLines(`${word} ${word}`, 9).length, 1); // 4 + 1 + 4
  assert.equal(wrapLines(`${word} ${word}`, 8).length, 2);
});

// HEAD's wrapLines, verbatim: one column per UTF-16 unit.
function wrapLinesUnits(text, width) {
  const s = String(text || '');
  const lines = [];
  const re = /\S+/g;
  let m;
  let cur = null;
  const flush = () => { if (cur) { lines.push({ text: s.slice(cur.start, cur.end), start: cur.start, end: cur.end }); cur = null; } };
  while ((m = re.exec(s)) !== null) {
    const word = m[0];
    const wStart = m.index;
    const wEnd = wStart + word.length;
    if (word.length > width) {
      flush();
      let off = wStart;
      let rest = word;
      while (rest.length > width) { lines.push({ text: rest.slice(0, width), start: off, end: off + width }); rest = rest.slice(width); off += width; }
      cur = { start: off, end: off + rest.length };
      continue;
    }
    if (!cur) { cur = { start: wStart, end: wEnd }; continue; }
    if ((wEnd - cur.start) <= width) cur.end = wEnd;
    else { flush(); cur = { start: wStart, end: wEnd }; }
  }
  flush();
  return lines.length ? lines : [{ text: '', start: 0, end: 0 }];
}

test('without wide or zero-width characters the result is the old one, at every width the module uses', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabets = [
    'abcdefghijklmnopqrstuvwxyzABCDEF.,;:!?\'"-()',
    '\u{430}\u{431}\u{432}\u{433}\u{434}\u{435}\u{436}\u{437}\u{418}\u{419}\u{41A}.,-',
    '\u{3B1}\u{3B2}\u{3B3}\u{3B4}\u{3B5}\u{3A9}\u{3A3}\u{3C2}\u{3AC}.,-',
  ];
  const widths = [
    ...Object.values(ELEMENT_METRICS).map((m) => m.width),
    ...Object.keys(ELEMENT_METRICS).map(dualElementWidth),
    ...Object.values(DUAL_WIDTH), 1, 2, 7,
  ];
  let n = 0;
  for (const width of [...new Set(widths)]) {
    for (let i = 0; i < 400; i++) {
      const al = alphabets[rnd(alphabets.length)];
      let s = '';
      const len = rnd(220);
      while (s.length < len) {
        const r = rnd(10);
        if (r < 2) s += ' '.repeat(1 + rnd(3));
        else if (r === 2 && rnd(4) === 0) s += rnd(2) ? '\t' : '\n';
        else s += al[rnd(al.length)].repeat(1 + rnd(r > 8 ? 60 : 4));
      }
      assert.deepEqual(wrapLines(s, width), wrapLinesUnits(s, width), JSON.stringify({ s, width }));
      n++;
    }
  }
  assert.ok(n > 3000, `${n} strings`);
});

// ---- emoji per grapheme, CJK break opportunities -----------------------------

const noStartOrEnd = (lines) => {
  for (const l of lines) {
    const first = Array.from(l.text)[0];
    const last = Array.from(l.text).pop();
    assert.ok(l.start === 0 || !'\u{3001}\u{3002}\u{300D}\u{3041}\u{30FC}\u{201D})],.!?:;'.includes(first), `line starts with ${JSON.stringify(first)}: ${JSON.stringify(l.text)}`);
    assert.ok(!'\u{300C}\u{FF08}\u{201C}([{'.includes(last), `line ends with ${JSON.stringify(last)}: ${JSON.stringify(l.text)}`);
  }
};

test('an emoji sequence, a flag and a skin-toned or variation-selector emoji count once', () => {
  assert.equal(textCols('\u{1F469}\u{200D}\u{1F469}\u{200D}\u{1F467}'), EMOJI);
  assert.equal(textCols('\u{1F1EF}\u{1F1F5}'), EMOJI);
  assert.equal(textCols('\u{1F44D}\u{1F3FD}'), EMOJI);
  assert.equal(textCols('\u{2764}\u{FE0F}'), EMOJI);
  assert.equal(textCols('a\u{1F600}b'), 2 + EMOJI);
  assert.equal(textCols('\u{65E5}\u{672C}'), 2 * WIDE);
  assert.ok(EMOJI > WIDE); // the emoji width was measured, not assumed equal to WIDE
});

test('a CJK line breaks between characters, filling the line first', () => {
  const s = 'INT. \u{6771}\u{4EAC}\u{306E}\u{99C5} - \u{591C}';
  const lines = wrapLines(s, 12);
  contiguous(s, lines);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(cols(l) <= 12 + 1e-9, JSON.stringify(l));
  assert.equal(lines[0].text, 'INT. \u{6771}\u{4EAC}\u{306E}\u{99C5}'); // 5 + 4 * 5/3 = 11.67; a fifth would not fit
  // A short word followed by a long CJK run: the run starts on the current line.
  const j = 'Hello ' + '\u{3042}\u{3044}\u{3046}\u{3048}\u{304A}'.repeat(4);
  const jl = wrapLines(j, 35);
  contiguous(j, jl);
  assert.ok(jl[0].text.startsWith('Hello \u{3042}'), JSON.stringify(jl[0].text));
  assert.equal(jl[0].text.length, 6 + 17); // 6 + 17 * 5/3 = 34.33
  for (const l of jl) assert.ok(cols(l) <= 35 + 1e-9);
});

test('no line starts with closing punctuation or small kana, none ends with an opening bracket', () => {
  const body = '\u{3042}\u{3044}\u{3046}\u{3048}\u{304A}';
  for (const w of [8, 9, 10, 11, 12, 13, 20, 35]) {
    for (const s of [
      `${body.repeat(6)}\u{3002}${body.repeat(3)}\u{300D}${body}`,
      `${body.repeat(3)}\u{300C}${body.repeat(5)}\u{3002}\u{300D}`,
      `${body.repeat(4)}\u{30FC}\u{3083}${body.repeat(4)}`,
      `${body.repeat(4)}(${body.repeat(4)}.`,
      `${body.repeat(3)}\u{FF1A}\u{201C}${body.repeat(4)}\u{3002}\u{201D}${body.repeat(2)}`,
    ]) {
      const lines = wrapLines(s, w);
      contiguous(s, lines);
      noStartOrEnd(lines);
      for (const l of lines) assert.ok(cols(l) <= w + 1e-9, `${cols(l)} > ${w}`);
    }
  }
});

test('Korean with spaces breaks between syllables when a word does not fit', () => {
  const word = '\u{C548}\u{B155}\u{D558}\u{C138}\u{C694}'.repeat(5); // 25 syllables, wider than 35 columns
  const s = `${word} \u{C548}\u{B155}`;
  const lines = wrapLines(s, 35);
  contiguous(s, lines);
  assert.equal(lines[0].text.length, 21); // 21 * 5/3 = 35
  for (const l of lines) assert.ok(cols(l) <= 35 + 1e-9);
});

test('an emoji sequence is never split between lines, and no line is wider than the width', () => {
  const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
  const flag = '\u{1F1EF}\u{1F1F5}';
  const s = `ab ${family}${flag}\u{2764}\u{FE0F}\u{1F44D}\u{1F3FD}${family}${flag} cd`;
  for (const w of [2, 3, 4, 5, 7, 10]) {
    const lines = wrapLines(s, w);
    contiguous(s, lines);
    for (const l of lines) {
      // One grapheme cannot be split, so a line of exactly one may exceed the width.
      assert.ok(cols(l) <= w + 1e-9 || graphemes(l.text).length === 1, `${cols(l)} > ${w}: ${JSON.stringify(l.text)}`);
      assert.ok(!/\u{200D}$/u.test(l.text) && !/^[\u{200D}\u{FE0F}\u{1F3FD}\u{1F1F5}]/u.test(l.text), JSON.stringify(l.text));
    }
  }
});

test('paginate on English blocks places the same line counts as the old wrap', () => {
  const words = 'the quick brown fox jumps over a lazy dog while it\u{2019}s raining \u{2014} hard'.split(' ');
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const els = ['scene', 'action', 'parenthetical', 'dialogue', 'transition'];
  const blocks = Array.from({ length: 120 }, () => ({
    element: els[rnd(els.length)],
    text: Array.from({ length: 1 + rnd(40) }, () => words[rnd(words.length)]).join(' '),
  }));
  const { pages } = paginate(blocks);
  let checked = 0;
  for (const page of pages) {
    for (const f of page) {
      if (f.more || f.contd || f.srcStart) continue;
      if (f.lines !== wrapLinesUnits(f.text, elementWidth(f.element)).length && blocks[f.index].text !== f.text) continue; // split fragment
      assert.equal(f.lines, wrapLinesUnits(f.text, elementWidth(f.element)).length);
      checked++;
    }
  }
  assert.ok(checked > 50, `${checked}`);
});
