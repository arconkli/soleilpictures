// A search result is a line of text around the match, not a whole message
// with its buttons inside another button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snippetParts } from './messageSearchSnippet.js';

const join = (parts) => parts.map((p) => (p.match ? `[${p.text}]` : p.text)).join('');

test('every match is marked, matching case-insensitively like the search', () => {
  assert.equal(join(snippetParts('Casting call at noon. casting notes after.', 'casting')), '[Casting] call at noon. [casting] notes after.');
});

test('a long message shows the words around the first match, clipped at word boundaries', () => {
  const body = `${'early words here '.repeat(10)}the needle sits here ${'later words follow '.repeat(10)}`;
  const s = join(snippetParts(body, 'needle', { radius: 20 }));
  assert.match(s, /^…/);
  assert.match(s, /…$/);
  assert.match(s, /\[needle\]/);
  const whole = new Set(body.split(/\s+/));
  for (const w of s.replace(/^…|…$/g, '').replace(/[[\]]/g, '').split(' ')) assert.ok(whole.has(w), `"${w}" is a whole word`);
});

test('whitespace folds to single spaces; no match shows the start; no body shows nothing', () => {
  assert.equal(join(snippetParts('line one\n\nline   two', 'one line')), 'line [one line] two');
  assert.equal(join(snippetParts('nothing here', 'zzz')), 'nothing here');
  assert.deepEqual(snippetParts('', 'x'), []);
});

test('search results are plain rows: one button each, no message bubble inside', () => {
  const thread = readFileSync(new URL('../components/MessageThread.jsx', import.meta.url), 'utf8');
  const rows = thread.slice(thread.indexOf('{searchResults.map('), thread.indexOf(') : isEmpty && loadFailed ? ('));
  assert.match(rows, /className="msg-search-result"/);
  // The jump also ends the search as one that found what it was for (msg_search).
  assert.match(rows, /onClick=\{\(\) => \{ endSearch\(true\); jumpTo\(m\.id\); \}\}/);
  assert.doesNotMatch(rows, /<MessageBubble/);
  assert.match(rows, /snippetParts\(m\.body, searchQuery\)/);
});
