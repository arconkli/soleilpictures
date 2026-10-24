import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { docCounts } from './docCounts.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
  },
});
const p = (...kids) => schema.node('paragraph', null, kids.map((k) => (typeof k === 'string' ? schema.text(k) : k)));
const doc = (...ps) => schema.node('doc', null, ps);

test('a paragraph\'s last word and the next one\'s first are two words', () => {
  assert.deepEqual(docCounts(doc(p('Three long takes.'), p('The motel'))), { words: 5, chars: 26 });
});

test('a line break ends a word too', () => {
  assert.deepEqual(docCounts(doc(p('INT. MOTEL', schema.node('hardBreak'), 'NIGHT'))).words, 3);
});

test('an empty doc, and none, count nothing', () => {
  assert.deepEqual(docCounts(doc(p())), { words: 0, chars: 0 });
  assert.deepEqual(docCounts(null), { words: 0, chars: 0 });
});
