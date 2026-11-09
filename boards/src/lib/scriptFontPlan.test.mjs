import test from 'node:test';
import assert from 'node:assert/strict';
import { isWinAnsi, screenplayPdfRoute, screenplayDirection, screenplayTexts, missingGlyphs } from './scriptFontPlan.js';

test('isWinAnsi: Latin-1 and the cp1252 extras only', () => {
  assert.equal(isWinAnsi('CAFÉ — “q” Ñandú ½ €'), true);
  assert.equal(isWinAnsi('Zażółć'), false);
  assert.equal(isWinAnsi('Привет'), false);
});

test('route: courier, font or html by what is drawn', () => {
  assert.equal(screenplayPdfRoute(['INT. HOUSE - DAY', 'She says “hi” — twice.']), 'courier');
  for (const t of ['Привет', 'Καλημέρα', 'Zażółć gęślą jaźń', 'Tiếng Việt', 'Բարեւ']) {
    assert.equal(screenplayPdfRoute(['INT. HOUSE', t]), 'font', t);
  }
  for (const t of ['שלום', 'مرحبا', 'こんにちは', '안녕', 'สวัสดี', 'नमस्ते', '🎬 FADE IN']) {
    assert.equal(screenplayPdfRoute(['INT. HOUSE', t]), 'html', t);
  }
});

test('screenplayTexts: blocks as written and upper-cased, title page only when enabled', () => {
  const blocks = [{ text: 'straße' }];
  assert.deepEqual(screenplayTexts(blocks, null), ['straße', 'STRASSE']);
  assert.deepEqual(screenplayTexts(blocks, { enabled: true, title: 'T', notes: 'N' }), ['straße', 'STRASSE', 'T', 'N']);
  assert.deepEqual(screenplayTexts(blocks, { enabled: false, title: 'T' }), ['straße', 'STRASSE']);
});

test('missingGlyphs: distinct code points the font lacks', () => {
  assert.deepEqual(missingGlyphs(['abab', ' x\n'], (cp) => cp !== 0x62), [0x62]);
});

test('screenplayDirection: the first block with a strong letter', () => {
  assert.equal(screenplayDirection([{ text: 'שלום' }, { text: 'Hi' }]), 'rtl');
  assert.equal(screenplayDirection([{ text: '123' }, { text: 'Hi' }]), 'ltr');
  assert.equal(screenplayDirection([]), 'ltr');
});
