// Plain-text paste keeps blank lines; a pasted bare <span> leaves no mark.
// lib/notePaste.js, wired as NoteTiptapSurface's clipboardTextParser and
// transformPasted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { noteExtensions } from '../components/noteExtensions/noteExtensions.js';
import { noteTextSlice, dropEmptyTextStyle } from './notePaste.js';

const schema = getSchema(noteExtensions);
const paras = (slice) => {
  const out = [];
  slice.content.forEach((n) => out.push([n.type.name, n.textContent]));
  return out;
};

test('a blank line between two lines stays an empty paragraph', () => {
  assert.deepEqual(paras(noteTextSlice('a\n\nb', schema)),
    [['paragraph', 'a'], ['paragraph', ''], ['paragraph', 'b']]);
});

test('\\r\\n and a lone \\r are line breaks too', () => {
  assert.deepEqual(paras(noteTextSlice('a\r\n\r\nb\rc', schema)),
    [['paragraph', 'a'], ['paragraph', ''], ['paragraph', 'b'], ['paragraph', 'c']]);
});

test('a trailing newline is a line break after the text', () => {
  assert.deepEqual(paras(noteTextSlice('a\n', schema)), [['paragraph', 'a'], ['paragraph', '']]);
});

test('a single line is one paragraph, open at both ends so it pastes inline', () => {
  const s = noteTextSlice('hello', schema);
  assert.deepEqual(paras(s), [['paragraph', 'hello']]);
  assert.equal(s.openStart, 1);
  assert.equal(s.openEnd, 1);
});

test('the marks at the caret carry onto the pasted text', () => {
  const s = noteTextSlice('x', schema, [schema.marks.bold.create()]);
  assert.ok(s.content.firstChild.firstChild.marks.some((m) => m.type.name === 'bold'));
});

test('an empty textStyle mark is dropped from a paste; a coloured one stays', () => {
  const empty = schema.marks.textStyle.create();
  const red = schema.marks.textStyle.create({ color: '#cc0000' });
  const p = schema.nodes.paragraph.create(null, [
    schema.text('plain ', [empty]), schema.text('more'), schema.text('red', [red]),
  ]);
  const out = dropEmptyTextStyle(new Slice(Fragment.from(p), 1, 1));
  const para = out.content.firstChild;
  assert.equal(para.childCount, 2, 'the unmarked runs join into one');
  assert.equal(para.child(0).text, 'plain more');
  assert.equal(para.child(0).marks.length, 0);
  assert.equal(para.child(1).marks[0].attrs.color, '#cc0000');
  assert.equal(out.openStart, 1);
  assert.equal(out.openEnd, 1);
});

test('a paste with nothing to drop comes back as the same slice', () => {
  const s = noteTextSlice('a\n\nb', schema);
  assert.equal(dropEmptyTextStyle(s), s);
});
