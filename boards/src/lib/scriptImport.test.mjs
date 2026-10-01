// scriptImport — a dropped .fountain parses the same way the doc menu's import
// does, names the card sensibly, and waits for exactly one editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScriptText, isEmptyScript, stashScriptImport, takeScriptImport, SCRIPT_FILE_RE } from './scriptImport.js';

const FOUNTAIN = [
  'Title: The Long Night',
  'Credit: written by',
  'Author: Someone',
  '',
  'INT. DINER - NIGHT',
  '',
  'Rain on the windows.',
  '',
  'MAYA',
  'We should go.',
  '',
].join('\n');

test('only screenplay extensions are claimed', () => {
  for (const n of ['a.fountain', 'B.FDX', 'draft v2.fountain']) assert.ok(SCRIPT_FILE_RE.test(n), n);
  for (const n of ['a.txt', 'a.fountain.zip', 'fdx.pdf', 'a.pur']) assert.ok(!SCRIPT_FILE_RE.test(n), n);
});

test('a fountain file parses into blocks and a title page', () => {
  const p = parseScriptText(FOUNTAIN, 'long-night.fountain');
  assert.equal(p.format, 'fountain');
  assert.ok(p.blocks.length >= 3, 'scene, action and dialogue all survive');
  assert.equal(p.titlePage?.title, 'The Long Night');
  assert.equal(p.title, 'The Long Night', 'the title page names the card');
  assert.equal(isEmptyScript(p), false);
});

test('without a title page the file name names the card', () => {
  const p = parseScriptText('INT. HOUSE - DAY\n\nQuiet.\n', 'My Short.fountain');
  assert.equal(p.titlePage, null);
  assert.equal(p.title, 'My Short');
});

test('an empty file is recognised as nothing to import', () => {
  assert.equal(isEmptyScript(parseScriptText('', 'empty.fountain')), true);
  assert.equal(isEmptyScript(null), true);
});

test('the waiting script is handed over exactly once', () => {
  const parsed = parseScriptText(FOUNTAIN, 'x.fountain');
  stashScriptImport('doc-1', parsed);
  assert.equal(takeScriptImport('doc-1'), parsed);
  assert.equal(takeScriptImport('doc-1'), null, 'a second editor must not re-import over edits');
  assert.equal(takeScriptImport(null), null);
});
