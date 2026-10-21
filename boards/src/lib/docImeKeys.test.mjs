// A doc's own fields leave a key alone while an input method is composing
// (lib/composerKeys.js isComposingKey, the message fields' rule): Chrome sends
// Enter mid-syllable as a keydown with isComposing before the IME commits the
// syllable, and acting on it closed a rename, a title or the find bar's jump one
// key early, leaving the Enter that follows to whatever had focus next.
// tests/doc-ime.spec.js drives each of these with Chromium's IME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(resolve(SRC, f), 'utf8');

// Each field's key handler, from its start to the first key it acts on.
const FIELDS = [
  ['components/DocFindReplace.jsx', 'const onKey = (e) => {', "e.key === 'Escape'"],
  ['components/DocPageTree.jsx', 'onKeyDown={(e) => {', "e.key === 'Enter'"],
  ['components/EditableText.jsx', 'const onKey = (e) => {', "e.key === 'Enter'"],
  ['components/ScreenplayTitlePage.jsx', 'onKeyDown={(e) => {', "e.key === 'Escape'"],
];

for (const [file, start, firstKey] of FIELDS) {
  test(`${file} leaves a key alone while the IME is composing`, () => {
    const src = read(file);
    assert.match(src, /import \{[^}]*\bisComposingKey\b[^}]*\} from '\.\.?\/(\.\.\/)?lib\/composerKeys\.js';/, 'imports the shared rule');
    const at = src.indexOf(start);
    assert.ok(at >= 0, `${file} has its key handler`);
    const handler = src.slice(at, src.indexOf(firstKey, at));
    assert.match(handler, /if \(isComposingKey\(e\)\) return;/, 'asks before acting on any key');
  });
}
