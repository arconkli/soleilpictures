// The closed doc card's preview keeps a heading, its paragraph and list numbers
// on separate lines; every other reader keeps the one-line text.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { preparePages, writePages, markdownToDoc, jsonToYNode } from './docWrite.js';
import { cardScope, readDocSummary, pageFragmentToText } from './docState.js';
import { jsonToMarkdown } from './docMarkdown.js';

const MD = `## The series

Six episodes, each set in a different rink.

### Episodes

2. The Rink Opens
3. Couples Night
4. Family Skate

- Snacks
- Skates
`;

function summaryFor(markdown, opts) {
  const ydoc = new Y.Doc();
  const ym = new Y.Map();
  ydoc.getMap('cards').set('d', ym);
  ym.set('kind', 'doc');
  writePages(ydoc, ym, preparePages([{ title: 'Series outline', markdown }]));
  return readDocSummary(ydoc, 600, cardScope(ym), opts).firstText;
}

// The list starts at 2 on purpose: it proves the numbers count from the list's
// own start attribute.
test('lines mode puts blocks on their own lines and keeps list numbers', () => {
  const text = summaryFor(MD, { lines: true });
  const lines = text.split('\n');
  assert.equal(lines[0], 'The series');
  assert.equal(lines[1], 'Six episodes, each set in a different rink.');
  assert.ok(lines.includes('2. The Rink Opens'));
  assert.ok(lines.includes('3. Couples Night'));
  assert.ok(lines.includes('4. Family Skate'));
  assert.ok(lines.includes('• Snacks'));
});

test('without lines the summary is the one-line text', () => {
  const text = summaryFor(MD);
  assert.ok(!text.includes('\n'));
  assert.match(text, /^The series Six episodes, each set in a different rink\. Episodes /);
  assert.equal(text, summaryFor(MD, {}));
});

function fragmentOf(doc) {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('page');
  frag.insert(0, doc.content.map(jsonToYNode));
  return frag;
}

test('an ordinary "1." list previews as 1, 2 (markdown-it sets no start attr)', () => {
  const doc = markdownToDoc('# Plan\n\n1. Scout the pier\n2. Book the boat');
  assert.equal(pageFragmentToText(fragmentOf(doc), 240, { lines: true }), 'Plan\n1. Scout the pier\n2. Book the boat');
});

test('a list stored with start 0 previews and exports as 1', () => {
  const doc = markdownToDoc('1. One\n2. Two');
  doc.content[0].attrs = { start: 0 };
  assert.equal(pageFragmentToText(fragmentOf(doc), 240, { lines: true }), '1. One\n2. Two');
  assert.equal(jsonToMarkdown(doc).trim(), '1. One\n2. Two');
});
