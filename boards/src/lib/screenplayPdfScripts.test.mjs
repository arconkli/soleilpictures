// The screenplay PDF in any script: Courier when it can, Cousine when the text
// is Greek, Cyrillic or extended Latin, and the browser's print path (signalled
// by ScreenplayNeedsHtml) for everything jsPDF can't typeset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScreenplayPdfBlob, ScreenplayNeedsHtml } from './screenplayPdf.js';
import { screenplayPrintHTML } from './screenplayPrint.js';

const FONT_B64 = readFileSync(new URL('../../public/fonts/Cousine-Regular.ttf', import.meta.url)).toString('base64');
const loadFont = async () => FONT_B64;
const noFont = async () => { throw new Error('the font must not be fetched for a WinAnsi script'); };

async function readBack(blob) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await blob.arrayBuffer());
  const raw = Buffer.from(data).toString('latin1'); // pdf.js takes the buffer it is given
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    for (const it of tc.items) if (it.str.trim()) lines.push(it.str.trim());
  }
  await doc.destroy();
  return { lines, raw };
}

test('WinAnsi script: Courier, no font fetched', async () => {
  const blob = await buildScreenplayPdfBlob(
    [{ element: 'action', text: 'She says “hello” — twice.' }], { loadFont: noFont },
  );
  const { lines } = await readBack(blob);
  assert.ok(lines.includes('She says “hello” — twice.'), JSON.stringify(lines));
});

test('Cyrillic, Greek and extended Latin: Cousine, embedded and readable', async () => {
  const blob = await buildScreenplayPdfBlob([
    { element: 'scene', text: 'int. квартира — ночь' },
    { element: 'action', text: 'Zażółć gęślą Καλημέρα' },
  ], { loadFont });
  const { lines, raw } = await readBack(blob);
  assert.ok(lines.includes('INT. КВАРТИРА — НОЧЬ'), JSON.stringify(lines));
  assert.ok(lines.includes('Zażółć gęślą Καλημέρα'), JSON.stringify(lines));
  assert.match(raw, /\/FontFile2/);
});

test('Japanese, Hebrew and Armenian go to the HTML path', async () => {
  for (const text of ['こんにちは', 'שלום עולם']) {
    await assert.rejects(
      buildScreenplayPdfBlob([{ element: 'action', text }], { loadFont: noFont }),
      (e) => e instanceof ScreenplayNeedsHtml,
      text,
    );
  }
  // Armenian passes the route check (Cousine is tried) and fails the glyph check.
  let asked = 0;
  await assert.rejects(
    buildScreenplayPdfBlob([{ element: 'action', text: 'Բարեւ' }], { loadFont: async () => { asked++; return FONT_B64; } }),
    (e) => e instanceof ScreenplayNeedsHtml,
  );
  assert.equal(asked, 1);
});

test('a font that fails to load falls back to the HTML path, not an error', async () => {
  await assert.rejects(
    buildScreenplayPdfBlob([{ element: 'action', text: 'Привет' }], { loadFont: async () => { throw new Error('offline'); } }),
    (e) => e instanceof ScreenplayNeedsHtml,
  );
});

test('the print page carries its direction', () => {
  const rtl = screenplayPrintHTML([{ element: 'dialogue', text: 'שלום עולם' }], { dir: 'rtl' });
  assert.ok(rtl.includes('<html dir="rtl">'));
  assert.ok(rtl.includes('שלום עולם'));
  const ltr = screenplayPrintHTML([{ element: 'dialogue', text: 'こんにちは' }]);
  assert.ok(ltr.includes('<html dir="ltr">'));
});

test('printed rows carry no dir; unicode-bidi plaintext lets each text pick its own, the boxes keep the document direction', () => {
  const html = screenplayPrintHTML([
    { element: 'dialogue', text: 'Hello there' },
    { element: 'dialogue', text: '\u{5E9}\u{5DC}\u{5D5}\u{5DD}' },
  ], { dir: 'rtl' });
  assert.ok(html.includes('<html dir="rtl">'));
  assert.ok(html.includes('<div class="sp-dialogue sp-page-first">Hello there</div>'));
  assert.ok(!/<div class="sp-[^>]* dir=/.test(html));
  assert.equal((html.match(/ dir=/g) || []).length, 1); // only <html dir>
  const rule = html.match(/([^{}]*)\{ unicode-bidi: plaintext; \}/);
  assert.ok(rule, 'plaintext rule present');
  for (const c of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered', 'shot', 'contd', 'more']) {
    assert.ok(rule[1].includes(`.sp-${c}`), c);
  }
  assert.ok(screenplayPrintHTML([{ element: 'dialogue', text: 'Hi' }]).includes('<html dir="ltr">'));
});

test('the print page uses logical properties, so rtl mirrors the indent columns', () => {
  const src = readFileSync(new URL('./screenplayPrint.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /margin-left:/);
  // A transition hugs the page's end side whatever language the line is in:
  // under unicode-bidi: plaintext, text-align: end would follow the line's text.
  const html = screenplayPrintHTML([{ element: 'transition', text: 'CUT TO:' }], { dir: 'rtl' });
  assert.match(html, /\.sp-transition \{[^}]*text-align: right;/);
  assert.match(html, /html\[dir="rtl"\] \.sp-transition \{ text-align: left; \}/);
});
