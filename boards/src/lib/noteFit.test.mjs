// noteFit.test.mjs — the note-height estimator.
//
//   node --test src/lib/noteFit.test.mjs
//
// Pure-model tests. How close the model is to a real browser is measured by
// tests/note-fit.spec.js (Playwright, local only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_FIT, noteContentHeight, fitNoteSize, parseNoteHtml } from './noteFit.js';
import { NOTE_EM } from './noteFitMetrics.js';

const MARTY = '<h2>MARTY SUPREME (2025)</h2><p>9.75 / 10</p><p></p><p>One of your highest-rated films.</p><p></p><p>NOTES</p><ul><li><p>What makes the lead performance electric?</p></li><li><p>How does the film build momentum?</p></li><li><p>Favorite scene / sequence:</p></li></ul>';

const text = (node) => node.children.map((c) => (c.text ?? (c.br ? '|' : text(c)))).join('');
const LINE = 22.5;

test('metrics table has the documented shape', () => {
  assert.ok(NOTE_EM.regular['a'] > 0.3 && NOTE_EM.regular['a'] < 0.8);
  assert.ok(NOTE_EM.bold['W'] > NOTE_EM.bold['i']);
  assert.ok(NOTE_EM.unknownRegular >= NOTE_EM.regular['W']);
  assert.ok(NOTE_EM.unknownBold >= NOTE_EM.bold['W']);
  assert.equal(NOTE_EM.wide, 1);
});

test('tokenizer: entities decode', () => {
  const root = parseNoteHtml('<p>a &amp; b &lt;c&gt; &quot;d&quot; it&#39;s&nbsp;e &#8212; &#x2014;</p>');
  assert.equal(text(root.children[0]), 'a & b <c> "d" it\'s e — —');
});

test('tokenizer: nested inline tags stay in one paragraph, strong is bold', () => {
  const root = parseNoteHtml('<p>one <strong>two <em>three</em></strong> <a href="x">four</a> <span>five</span></p>');
  assert.equal(root.children.length, 1);
  const p = root.children[0];
  assert.equal(text(p), 'one two three four five');
  assert.deepEqual(p.children.filter((c) => c.bold).map((c) => c.text), ['two ', 'three']);
});

test('tokenizer: br is a break, not text', () => {
  const root = parseNoteHtml('<p>a<br>b<br/>c</p>');
  assert.equal(text(root.children[0]), 'a|b|c');
});

test('tokenizer: checklist structure', () => {
  const root = parseNoteHtml('<ul class="note-checklist"><li class="ck"><span class="ck-box" role="checkbox"></span><div class="ck-text"><p>do it</p></div></li></ul>');
  const ul = root.children[0];
  assert.equal(ul.tag, 'ul');
  const li = ul.children[0];
  assert.equal(li.tag, 'li');
  assert.ok(li.cls.includes(' ck '));
  assert.equal(li.children.length, 1); // the empty ck-box span is dropped
  assert.equal(li.children[0].tag, 'div');
});

test('tokenizer: unknown block tags act as paragraphs', () => {
  const root = parseNoteHtml('<blockquote>quoted</blockquote><section>sec</section>');
  assert.equal(root.children.length, 2);
  const one = noteContentHeight('<blockquote>quoted</blockquote>', 280);
  assert.equal(one, noteContentHeight('<p>quoted</p>', 280));
});

test('tokenizer: text outside blocks, and a block closes an open paragraph', () => {
  assert.equal(noteContentHeight('loose text', 280), noteContentHeight('<p>loose text</p>', 280));
  assert.equal(noteContentHeight('<p>a<p>b', 280), 30 + 2 * LINE);
});

test('plain text without tags splits on newlines', () => {
  assert.equal(noteContentHeight('one\ntwo\nthree', 280), 30 + 3 * LINE);
  assert.equal(noteContentHeight('one\n\nthree', 280), 30 + 3 * LINE); // blank line keeps its line
});

test('basic heights: one paragraph, empty paragraph, br', () => {
  assert.equal(noteContentHeight('<p>hi</p>', 280), 30 + LINE);
  assert.equal(noteContentHeight('<p></p>', 280), 30 + LINE);
  assert.equal(noteContentHeight('<p>a<br>b</p>', 280), 30 + 2 * LINE);
  assert.equal(noteContentHeight('<p>a<br></p>', 280), 30 + LINE); // trailing br adds nothing
  assert.equal(noteContentHeight('<p>a<br><br></p>', 280), 30 + 2 * LINE);
});

test('heading: bold size, own margins, no top margin when first', () => {
  const first = noteContentHeight('<h1>Title</h1>', 280);
  const size = 15 * 1.35;
  assert.ok(Math.abs(first - (30 + size * 1.25 + size * 0.2)) < 1e-9);
  const second = noteContentHeight('<p>x</p><h1>Title</h1>', 280);
  assert.ok(Math.abs(second - (30 + LINE + size * 0.5 + size * 1.25 + size * 0.2)) < 1e-9);
});

test('list margins collapse with the list and between items', () => {
  const ul = noteContentHeight('<ul><li><p>a</p></li><li><p>b</p></li></ul>', 280);
  assert.equal(ul, 30 + 6 + 2 * LINE + 2 + 6);
  const ck = noteContentHeight('<ul class="note-checklist"><li class="ck"><span class="ck-box"></span><div class="ck-text"><p>a</p></div></li></ul>', 280);
  assert.equal(ck, 30 + 6 + (LINE + 4) + 6);
});

test('monotonic: more text is taller', () => {
  let prev = 0;
  for (const n of [1, 5, 20, 60, 150, 400]) {
    const hgt = noteContentHeight(`<p>${'word '.repeat(n)}</p>`, 280);
    assert.ok(hgt >= prev, `${n} words`);
    prev = hgt;
  }
  assert.ok(noteContentHeight(`<p>${'word '.repeat(400)}</p>`, 280) > noteContentHeight('<p>word</p>', 280));
  assert.ok(noteContentHeight(MARTY + MARTY, 280) > noteContentHeight(MARTY, 280));
});

test('monotonic: a wider card is never taller', () => {
  const samples = [MARTY, `<p>${'lorem ipsum dolor sit amet '.repeat(30)}</p>`, `<ul>${'<li><p>some bullet text here</p></li>'.repeat(8)}</ul>`];
  for (const html of samples) {
    let prev = Infinity;
    for (const w of [200, 240, 280, 320, 400, 520]) {
      const hgt = noteContentHeight(html, w);
      assert.ok(hgt <= prev + 1e-9, `w=${w}`);
      prev = hgt;
    }
  }
});

test('bold text is not narrower than regular', () => {
  const body = 'wide enough words to wrap across several lines '.repeat(12);
  assert.ok(noteContentHeight(`<p><strong>${body}</strong></p>`, 280) >= noteContentHeight(`<p>${body}</p>`, 280));
});

test('a long unbreakable URL wraps instead of overflowing', () => {
  const url = 'https://example.com/' + 'a-very-long-path-segment/'.repeat(8) + '?q=1';
  const hgt = noteContentHeight(`<p>${url}</p>`, 280);
  assert.ok(hgt > 30 + 3 * LINE, `url took ${hgt}`);
  assert.ok(hgt < 30 + 12 * LINE);
});

test('CJK and emoji use the wide advance', () => {
  // 20 CJK chars at 15px * 1.0 * 1.03 = ~309px on a 250px line: 2 lines.
  const hgt = noteContentHeight(`<p>${'日'.repeat(20)}</p>`, 280);
  assert.equal(hgt, 30 + 2 * LINE);
  // Same count of Latin 'i' stays on one line.
  assert.equal(noteContentHeight(`<p>${'i'.repeat(20)}</p>`, 280), 30 + LINE);
  assert.ok(noteContentHeight(`<p>${'😀'.repeat(40)}</p>`, 280) > 30 + 2 * LINE);
});

test('multiple spaces count (pre-wrap)', () => {
  assert.ok(noteContentHeight(`<p>a${' '.repeat(200)}b</p>`, 280) > noteContentHeight('<p>a b</p>', 280));
});

test('MARTY SUPREME sanity at w 280', () => {
  const hgt = noteContentHeight(MARTY, 280);
  assert.ok(hgt > 270 && hgt < 340, `got ${hgt}`);
});

test('fitNoteSize: clamps', () => {
  const tiny = fitNoteSize({ html: '<p>hi</p>', w: 280 });
  assert.deepEqual(tiny, { w: 280, h: NOTE_FIT.minH, overflow: false });
  const huge = fitNoteSize({ html: `<p>${'lorem ipsum '.repeat(2000)}</p>`, w: 280 });
  assert.equal(huge.h, NOTE_FIT.maxH);
  assert.equal(huge.overflow, true);
  const mid = fitNoteSize({ html: MARTY, w: 280 });
  assert.equal(mid.h, Math.ceil(noteContentHeight(MARTY, 280) + NOTE_FIT.safety));
  assert.equal(mid.overflow, false);
});

test('fitNoteSize: a given h passes through untouched', () => {
  assert.deepEqual(fitNoteSize({ html: MARTY, w: 300, h: 123.4 }), { w: 300, h: 123, overflow: false });
  assert.deepEqual(fitNoteSize({ html: MARTY, h: 5000 }), { w: 280, h: 5000, overflow: false });
  assert.deepEqual(fitNoteSize({ html: MARTY, w: 'x', h: 90 }), { w: 280, h: 90, overflow: false });
});

test('fitNoteSize: without w, 280 normally and 320 when 280 overflows', () => {
  assert.equal(fitNoteSize({ html: MARTY }).w, 280);
  // Find a body that overflows at 280 but not at 320.
  let found = null;
  for (let n = 100; n < 600 && !found; n += 5) {
    const html = `<p>${'lorem ipsum dolor '.repeat(n / 5)}</p>`;
    if (noteContentHeight(html, 280) > NOTE_FIT.maxH && noteContentHeight(html, 320) <= NOTE_FIT.maxH) found = html;
  }
  assert.ok(found, 'a body that overflows only at 280 exists');
  const r = fitNoteSize({ html: found });
  assert.equal(r.w, 320);
  assert.equal(r.overflow, false);
  // Overflowing even at 320 -> 320, overflow true.
  const both = fitNoteSize({ html: `<p>${'lorem ipsum '.repeat(3000)}</p>` });
  assert.equal(both.w, 320);
  assert.equal(both.h, NOTE_FIT.maxH);
  assert.equal(both.overflow, true);
});

test('fitNoteSize: empty or blank html', () => {
  assert.deepEqual(fitNoteSize({ html: '' }), { w: 280, h: 72, overflow: false });
  assert.deepEqual(fitNoteSize({ html: '   ', w: 300 }), { w: 300, h: 72, overflow: false });
  assert.deepEqual(fitNoteSize({}), { w: 280, h: 72, overflow: false });
  assert.deepEqual(fitNoteSize(), { w: 280, h: 72, overflow: false });
});
