// settingsToggle.test.mjs — clicking a Settings toggle's words flips it
// (ACCOUNT-13).
//
// The row was a <label> wrapping only spans, so it had no control to forward a
// click to: only the small switch responded, though the row is drawn (and
// cursor-styled) as one target. fields.jsx imports React, so read its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function toggleSource() {
  const src = read('../components/settings/fields.jsx');
  const m = src.match(/export function Toggle\([\s\S]*?\n}\n/);
  assert.ok(m, 'Toggle not found in settings/fields.jsx');
  return m[0];
}

test('the whole toggle row flips the switch, exactly once', () => {
  const src = toggleSource();
  assert.match(src, /<div className="settings-toggle" onClick=\{\(\) => onChange\(!value\)\}>/);
  assert.doesNotMatch(src, /<label className="settings-toggle"/, 'a label with no control forwards nothing');
  // One click handler only: a second on the switch would flip it back.
  assert.equal(src.match(/onClick=/g).length, 1);
});

test('the switch keeps the keyboard and is named by its label', () => {
  const src = toggleSource();
  assert.match(src, /role="switch"/);
  assert.match(src, /tabIndex=\{0\}/);
  assert.match(src, /onKeyDown=/);
  assert.match(src, /aria-labelledby=\{labelId\}/);
  assert.match(src, /id=\{labelId\}/);
});
