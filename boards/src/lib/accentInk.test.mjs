// accentInk.test.mjs — gold-filled buttons and badges stay readable whatever
// accent the user picks.
//
// --on-soleil was a fixed dark ink, but --soleil is user-overridable, so the
// 'ink' preset (#5b574e) put Send, .btn-primary, unread pills and VIEW ONLY at
// about 2.6:1. Both accent-override writers now emit --on-soleil too: App.jsx
// through onSoleilInk, and index.html's pre-React bootstrap through an inline
// copy that this file holds to the same answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onSoleilInk, ON_SOLEIL_DARK } from './accentInk.js';
import { contrastRatio, parseColor } from './readableColor.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// fields.jsx imports React, so read the preset list out of its source.
function accentPresets() {
  const src = read('../components/settings/fields.jsx');
  const block = src.match(/export const ACCENT_PRESETS = \[([\s\S]*?)\];/);
  assert.ok(block, 'ACCENT_PRESETS not found in settings/fields.jsx');
  const hexes = [...block[1].matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1]);
  assert.ok(hexes.length >= 6, 'ACCENT_PRESETS parsed to almost nothing');
  return hexes;
}

function inlineOnSoleilInk() {
  const html = read('../../index.html');
  const m = html.match(/\/\/ ON-SOLEIL-INK-BEGIN([\s\S]*?)\/\/ ON-SOLEIL-INK-END/);
  assert.ok(m, 'index.html no longer carries the ON-SOLEIL-INK block');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[1]}; return onSoleilInk;`)();
}

test('every accent preset gets ink at WCAG AA (4.5:1) or better', () => {
  for (const hex of accentPresets()) {
    const ink = onSoleilInk(hex);
    const ratio = contrastRatio(parseColor(hex), parseColor(ink));
    assert.ok(ratio >= 4.5, `${hex} with ${ink} is ${ratio.toFixed(2)}:1`);
  }
});

test('the default gold keeps the stylesheet dark ink; dark accents get white', () => {
  assert.equal(onSoleilInk('#ffa500'), ON_SOLEIL_DARK);
  assert.equal(onSoleilInk('#5b574e'), '#ffffff');
  assert.equal(onSoleilInk('#7c5cc9'), '#ffffff');
  assert.equal(onSoleilInk('not a colour'), ON_SOLEIL_DARK);
});

test('index.html bootstrap picks the same ink as App.jsx', () => {
  const inline = inlineOnSoleilInk();
  const sweep = [...accentPresets(), '#000000', '#0000ff', '#00ff00', '#ff0000', '#ffffff'];
  for (let v = 0; v < 256; v += 17) {
    const h = v.toString(16).padStart(2, '0');
    sweep.push(`#${h}${h}${h}`, `#${h}8000`, `#00${h}c0`);
  }
  for (const hex of sweep) assert.equal(inline(hex), onSoleilInk(hex), hex);
});

test('both accent writers emit --on-soleil next to --soleil', () => {
  assert.match(read('../../index.html'), /--on-soleil: " \+ onSoleilInk\(hex\)/);
  assert.match(read('../App.jsx'), /--on-soleil: \$\{onSoleilInk\(hex\)\}/);
});
