// The display font stack must not send Cyrillic, Greek or Latin Extended letters
// into Impact: brandon-grotesque -> soleil-impact (Impact limited to the
// characters Brandon's kit also serves) -> sans-serif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const thumb = readFileSync(new URL('./renderThumbnail.js', import.meta.url), 'utf8');

const RANGE = 'U+0020-007E, U+00A0-00FF, U+0152-0153, U+0178, U+02DC, U+2013-2014, U+2018-2019, U+201C-201E, U+2022, U+2026, U+2039-203A, U+20AC, U+2122';
const STACK = 'brandon-grotesque, soleil-impact, sans-serif';

test("@font-face 'soleil-impact' exposes local Impact for the Brandon character set only", () => {
  const m = css.match(/@font-face\s*\{[^}]*font-family:\s*'soleil-impact'[^}]*\}/);
  assert.ok(m, "no @font-face for 'soleil-impact'");
  assert.match(m[0], /src:\s*local\('Impact'\)\s*;/);
  assert.ok(m[0].includes(`unicode-range: ${RANGE};`), 'unicode-range changed');
  assert.ok(!/font-weight/.test(m[0]), 'no font-weight descriptor: bold stays synthesized');
});

test('--font-display and the thumbnail renderer use the same stack', () => {
  assert.match(css, new RegExp(`--font-display:\\s*${STACK.replace(/[-]/g, '\\-')};`));
  assert.match(thumb, new RegExp(`const FONT_DISPLAY = '${STACK}';`));
});

test('nothing else names Impact in a font stack', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
  assert.ok(!/Impact\s*,/.test(strip(css)), 'styles.css still names Impact in a stack');
  assert.ok(!/Impact\s*,/.test(strip(thumb)), 'renderThumbnail.js still names Impact in a stack');
});

test('the thumbnail renderer loads the alias face before drawing', () => {
  assert.equal((thumb.match(/document\.fonts\.load\('700 10px soleil-impact', 'A'\)/g) || []).length, 2);
});
