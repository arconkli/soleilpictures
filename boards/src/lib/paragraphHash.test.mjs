// Applied tag ranges are anchored to their paragraph by a hash of its trimmed
// text (pHash, from contentHash). Three readers find that paragraph again on
// every edit: the tag underlines (TagRangePlugin), their margin dots
// (DocTagGutter), and the boxes that keep the other dotted underlines —
// auto-links, suggested names — off them (DocPageEditor). The boxes hashed
// it their own way, without contentHash's zero padding, so about one
// paragraph in sixteen (a hash starting with 0) lost its box and drew both
// underlines at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { contentHash } from './clusterMath.js';
import { paragraphHash, rangeBoxes } from './paragraphHash.js';
import { makeTagRangePlugin, TAG_RANGE_KEY } from '../components/docExtensions/TagRangePlugin.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
  },
});
const P = (t) => schema.node('paragraph', null, t ? [schema.text(t)] : []);
const doc = (...blocks) => schema.node('doc', null, blocks);

// The first of a run of sentences whose hash starts with a 0.
const ZERO = Array.from({ length: 400 }, (_, i) => `The kettle whistles in room number ${i}.`)
  .find((t) => contentHash(t).startsWith('0'));

test('a range finds its paragraph whatever its hash starts with', () => {
  assert.ok(ZERO, 'a sentence whose hash starts with 0');
  const d = doc(P('A short line.'), P(ZERO));
  const at = d.child(0).nodeSize + 1; // where the second paragraph's text starts
  assert.deepEqual(rangeBoxes(d, [{ pHash: contentHash(ZERO), startOffset: 4, length: 6 }]),
    [{ from: at + 4, to: at + 10 }]);
});

test('every reader hashes a paragraph as its ranges were stored', () => {
  for (let i = 0; i < 200; i++) {
    const text = `  Line ${i} of a long and winding paragraph about rain.  `;
    assert.equal(paragraphHash(P(text)), contentHash(text.trim()));
  }
  // Too short to anchor a tag to.
  assert.equal(paragraphHash(P('Nineteen characters')), null);
});

test('a range in a quote is found, the first of two equal paragraphs wins, and one edited away has none', () => {
  const text = 'She writes another line, crosses it out, and begins again.';
  const range = { pHash: contentHash(text), startOffset: 0, length: 3 };
  const quoted = doc(P('Above the quote, a line of its own.'), schema.node('blockquote', null, [P(text)]), P(text));
  const first = quoted.child(0).nodeSize + 2; // into the quote, into its paragraph
  assert.deepEqual(rangeBoxes(quoted, [range]), [{ from: first, to: first + 3 }]);
  assert.deepEqual(rangeBoxes(doc(P(`${text} Then stops.`)), [range]), []);
});

test('the tag underline paints the word its range names, and no further than its paragraph', () => {
  const plain = 'She writes another line, crosses it out, and begins again.';
  const d = doc(P(ZERO), P(plain));
  const ranges = [
    { pHash: contentHash(ZERO), startOffset: 4, length: 6, tagId: 't1', tagName: 'Kettle', tagColor: '#c33' },
    { pHash: contentHash(plain), startOffset: 4, length: 200, tagId: 't2', tagName: 'Writing', tagColor: '#3a3' },
  ];
  const state = EditorState.create({ schema, doc: d, plugins: [makeTagRangePlugin({ getRanges: () => ranges })] });
  const words = TAG_RANGE_KEY.getState(state).find()
    .map((w) => [w.from, w.to, w.type.attrs['data-tag-id']])
    .sort((a, b) => a[0] - b[0]);
  const second = d.child(0).nodeSize + 1;
  assert.deepEqual(words, [[1 + 4, 1 + 10, 't1'], [second + 4, second + plain.length, 't2']]);
});
