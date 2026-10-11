import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPastedStyle, isChromatic, isInternalPaste, parseColor } from './pasteScrub.js';

test('Google Docs span style loses its typography and default black', () => {
  const gdocs = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
  assert.equal(cleanPastedStyle(gdocs),
    'font-weight: 400; font-style: normal; text-decoration: none; vertical-align: baseline');
});

test('Word paragraph style keeps only alignment', () => {
  const word = "margin:0in;line-height:115%;font-size:12.0pt;font-family:'Calibri',sans-serif;text-align:center;mso-ansi-language:EN-US";
  assert.equal(cleanPastedStyle(word), 'text-align: center');
});

test('a real colour survives, greys and white do not', () => {
  assert.equal(cleanPastedStyle('color: rgb(204, 0, 0)'), 'color: rgb(204, 0, 0)');
  assert.equal(cleanPastedStyle('color:#1155cc'), 'color: #1155cc');
  assert.equal(cleanPastedStyle('color: rgb(34, 34, 34)'), '');
  assert.equal(cleanPastedStyle('color:#fff'), '');
  assert.equal(cleanPastedStyle('color: gray'), '');
});

test('backgrounds are always dropped', () => {
  assert.equal(cleanPastedStyle('background-color: rgb(255, 242, 204); font-weight: 700'), 'font-weight: 700');
  assert.equal(cleanPastedStyle('background: yellow'), '');
});

test('parseColor / isChromatic edge cases', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204]);
  assert.equal(parseColor('rgba(255, 0, 0, 0)'), null);
  assert.equal(parseColor('#ff000000'), null);
  assert.equal(parseColor('var(--x)'), null);
  assert.equal(isChromatic('red'), true);
  assert.equal(isChromatic('#000'), false);
  assert.equal(isChromatic('nonsense'), false);
});

test('pastes copied from our own editors are recognised', () => {
  assert.equal(isInternalPaste('<p data-pm-slice="1 1 []">x</p>'), true);
  assert.equal(isInternalPaste('<meta charset="utf-8"><b id="docs-internal-guid-1">x</b>'), false);
});
